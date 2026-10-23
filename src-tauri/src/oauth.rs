use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri_plugin_opener::OpenerExt;
use crate::credentials::save_oauth_tokens;

/// Plazo máximo que el servidor local de callback espera la redirección.
const CALLBACK_DEADLINE: Duration = Duration::from_secs(600);
const CALLBACK_OK: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>e-Meil</title></head><body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0\"><p>✔ Autorización recibida. Puedes cerrar esta ventana y volver a e-Meil.</p></body></html>";
const CALLBACK_SKIP: &str = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n";

/// Permisos que pide e-Meil: leer y organizar correo, enviarlo y mantener la
/// sesión con un refresh token.
const MS_SCOPES: &str = "openid profile email offline_access Mail.ReadWrite Mail.Send";
/// Redirección del flujo clásico con navegador externo y servidor local.
const MS_LOOPBACK_REDIRECT: &str = "http://127.0.0.1:43821/oauth/callback";
/// Redirección nativa que Microsoft devuelve a la ventana embebida. La ventana
/// intercepta la navegación antes de que la página de error llegue a cargarse.
const MS_NATIVE_REDIRECT: &str = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const MS_NATIVE_REDIRECT_ENCODED: &str = "https%3A%2F%2Flogin.microsoftonline.com%2Fcommon%2Foauth2%2Fnativeclient";
const MS_LOGIN_LABEL: &str = "ms-login";

#[derive(Default)]
pub(crate) struct OAuthState(pub(crate) Arc<Mutex<HashMap<String, PendingOAuth>>>);

pub(crate) struct PendingOAuth { verifier: String, code: Option<String>, redirect_uri: String, error: Option<String> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStart { pub authorization_url: String, pub state: String, pub redirect_uri: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthPoll { pub status: String, pub email: Option<String>, pub message: String }

#[derive(Debug, Deserialize)] struct TokenResponse { access_token: Option<String>, refresh_token: Option<String>, #[allow(dead_code)] id_token: Option<String>, error: Option<String>, error_description: Option<String> }

#[tauri::command]
pub async fn start_microsoft_oauth(app: tauri::AppHandle, state: tauri::State<'_, OAuthState>, client_id: String, tenant: String) -> Result<OAuthStart, String> {
    let client_id = client_id.trim(); if client_id.is_empty() { return Err("Configura el Client ID de Microsoft Entra ID primero".into()); }
    let tenant = if tenant.trim().is_empty() { "common" } else { tenant.trim() };
    let verifier: String = rand::thread_rng().sample_iter(&Alphanumeric).take(64).map(char::from).collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let oauth_state: String = rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect();
    state.0.lock().map_err(|_| "No se pudo preparar OAuth".to_string())?.insert(oauth_state.clone(), PendingOAuth { verifier, code: None, redirect_uri: MS_LOOPBACK_REDIRECT.into(), error: None });
    let redirect_uri = MS_LOOPBACK_REDIRECT;
    let authorization_url = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?client_id={client_id}&response_type=code&redirect_uri={redirect_uri}&response_mode=query&scope={scope}&state={oauth_state}&code_challenge={challenge}&code_challenge_method=S256", scope = MS_SCOPES.replace(' ', "%20"));
    let listener = TcpListener::bind("127.0.0.1:43821").map_err(|e| format!("No se pudo iniciar callback OAuth local: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| format!("Callback OAuth local no acepta conexiones: {e}"))?;
    let shared = state.0.clone();
    std::thread::spawn(move || serve_callback(listener, shared));
    app.opener().open_url(authorization_url.clone(), None::<String>).map_err(|e| format!("No se pudo abrir el navegador externo: {e}"))?;
    Ok(OAuthStart { authorization_url, state: oauth_state, redirect_uri: redirect_uri.into() })
}

/// Inicia sesión con Microsoft en una ventana propia de e-Meil.
///
/// Es el flujo que usa la interfaz: no pide Client ID, no abre el navegador
/// externo y no necesita un puerto local. La ventana intercepta la redirección
/// nativa, guarda el `code` con su `state` y se cierra sola; el sondeo de
/// `poll_microsoft_oauth` completa el canje con PKCE.
#[tauri::command]
pub async fn start_microsoft_oauth_window(app: tauri::AppHandle, state: tauri::State<'_, OAuthState>, client_id: String, tenant: String) -> Result<OAuthStart, String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let client_id = client_id.trim().to_string();
    if client_id.is_empty() { return Err("No hay una identidad OAuth de Microsoft configurada.".into()); }
    let tenant = if tenant.trim().is_empty() { "common".to_string() } else { tenant.trim().to_string() };
    let verifier: String = rand::thread_rng().sample_iter(&Alphanumeric).take(64).map(char::from).collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let oauth_state: String = rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect();
    state.0.lock().map_err(|_| "No se pudo preparar OAuth".to_string())?.insert(oauth_state.clone(), PendingOAuth { verifier, code: None, redirect_uri: MS_NATIVE_REDIRECT.into(), error: None });
    let authorization_url = format!(
        "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?client_id={client_id}&response_type=code&redirect_uri={MS_NATIVE_REDIRECT_ENCODED}&response_mode=query&scope={scope}&state={oauth_state}&code_challenge={challenge}&code_challenge_method=S256&prompt=select_account",
        scope = MS_SCOPES.replace(' ', "%20")
    );
    if let Some(existing) = app.get_webview_window(MS_LOGIN_LABEL) { let _ = existing.close(); }
    let shared = state.0.clone();
    let close_guard = state.0.clone();
    let close_state = oauth_state.clone();
    let app_handle = app.clone();
    let url = tauri::Url::parse(&authorization_url).map_err(|e| format!("URL de autorización inválida: {e}"))?;
    let window = WebviewWindowBuilder::new(&app, MS_LOGIN_LABEL, WebviewUrl::External(url))
        .title("Microsoft")
        .inner_size(520.0, 720.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .resizable(true)
        .on_navigation(move |navigation| {
            if navigation.as_str().starts_with(MS_NATIVE_REDIRECT) {
                store_native_redirect(navigation, &shared);
                if let Some(window) = app_handle.get_webview_window(MS_LOGIN_LABEL) { let _ = window.close(); }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("No se pudo abrir la ventana de inicio de sesión de Microsoft: {e}"))?;
    // Si la persona cierra la ventana sin terminar, el sondeo no espera cinco
    // minutos: se marca el intento como cancelado y la interfaz lo informa.
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut pending) = close_guard.lock() {
                if let Some(item) = pending.get_mut(&close_state) {
                    if item.code.is_none() && item.error.is_none() {
                        item.error = Some("Se cerró la ventana de Microsoft antes de completar el inicio de sesión.".into());
                    }
                }
            }
        }
    });
    let _ = window.set_focus();
    Ok(OAuthStart { authorization_url, state: oauth_state, redirect_uri: MS_NATIVE_REDIRECT.into() })
}

/// Guarda el resultado de la redirección nativa (código o error) en el intento
/// cuyo `state` coincide. La descripción del error se conserva para mostrarla.
fn store_native_redirect(url: &tauri::Url, shared: &Arc<Mutex<HashMap<String, PendingOAuth>>>) {
    let values: HashMap<_, _> = url.query().unwrap_or("").split('&').filter_map(|pair| pair.split_once('=')).collect();
    let Some(received_state) = values.get("state") else { return; };
    let Ok(mut pending) = shared.lock() else { return; };
    let Some(item) = pending.get_mut(*received_state) else { return; };
    if let Some(error) = values.get("error") {
        item.error = Some(format!("Microsoft rechazó el inicio de sesión: {error}"));
        return;
    }
    if item.code.is_none() {
        if let Some(code) = values.get("code") { item.code = Some((*code).to_string()); }
    }
}

/// Acepta conexiones del navegador hasta recibir un `code` cuyo `state`
/// coincida con un intento pendiente. Las solicitudes previas (favicon,
/// precargas) reciben 404 sin consumir el intento.
fn serve_callback(listener: TcpListener, shared: Arc<Mutex<HashMap<String, PendingOAuth>>>) {
    let deadline = Instant::now() + CALLBACK_DEADLINE;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut request = String::new();
                let mut buffer = [0; 4096];
                if let Ok(size) = stream.read(&mut buffer) {
                    request.push_str(&String::from_utf8_lossy(&buffer[..size]));
                }
                if store_callback_code(&request, &shared) {
                    let _ = stream.write_all(CALLBACK_OK.as_bytes());
                    return;
                }
                let _ = stream.write_all(CALLBACK_SKIP.as_bytes());
            }
            Err(ref error) if error.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(_) => return,
        }
    }
}

/// Guarda el `code` de la redirección si su `state` pertenece a un intento
/// pendiente. Retorna true cuando el intento quedó completo.
fn store_callback_code(request: &str, shared: &Arc<Mutex<HashMap<String, PendingOAuth>>>) -> bool {
    let Some(path) = request.lines().next().and_then(|line| line.split_whitespace().nth(1)) else { return false; };
    let query = path.split('?').nth(1).unwrap_or("");
    let values: HashMap<_, _> = query.split('&').filter_map(|pair| pair.split_once('=')).collect();
    let (Some(received_state), Some(code)) = (values.get("state"), values.get("code")) else { return false; };
    let Ok(mut pending) = shared.lock() else { return false; };
    match pending.get_mut(*received_state) {
        // Primero gana: una segunda redirección del mismo intento se ignora.
        Some(item) if item.code.is_none() => { item.code = Some(code.to_string()); true }
        _ => false,
    }
}

#[tauri::command]
pub async fn poll_microsoft_oauth(state: tauri::State<'_, OAuthState>, client_id: String, tenant: String, oauth_state: String) -> Result<OAuthPoll, String> {
    let shared = state.0.clone();
    let client_id = client_id.trim().to_string();
    let tenant = if tenant.trim().is_empty() { "common".into() } else { tenant.trim().to_string() };
    // El canje de tokens y la consulta del perfil son llamadas de red bloqueantes:
    // se ejecutan fuera del hilo principal para no congelar la interfaz.
    tauri::async_runtime::spawn_blocking(move || -> Result<OAuthPoll, String> {
        let entry = shared.lock().map_err(|_| "No se pudo leer OAuth".to_string())?.get(&oauth_state).map(|item| (item.verifier.clone(), item.code.clone(), item.redirect_uri.clone(), item.error.clone()));
        let Some((verifier, code, redirect_uri, error)) = entry else {
            return Ok(OAuthPoll { status: "pending".into(), email: None, message: "Esperando la autorización de Microsoft…".into() });
        };
        if let Some(error) = error {
            shared.lock().ok().map(|mut map| map.remove(&oauth_state));
            return Ok(OAuthPoll { status: "error".into(), email: None, message: error });
        }
        let Some(code) = code else {
            return Ok(OAuthPoll { status: "pending".into(), email: None, message: "Esperando la autorización de Microsoft…".into() });
        };
        let endpoint = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token");
        let response = reqwest::blocking::Client::new().post(&endpoint).form(&[("client_id", client_id.as_str()), ("grant_type", "authorization_code"), ("code", code.as_str()), ("redirect_uri", redirect_uri.as_str()), ("code_verifier", verifier.as_str()), ("scope", MS_SCOPES)]).send().map_err(|e| format!("No se pudo completar OAuth: {e}"))?;
        let token: TokenResponse = response.json().map_err(|e| format!("Respuesta OAuth inválida: {e}"))?;
        if let Some(error) = token.error {
            // El código fue rechazado o ya canjeado: se descarta el intento para
            // que el sondeo termine con un error claro en vez de reintentar.
            shared.lock().ok().map(|mut map| map.remove(&oauth_state));
            return Ok(OAuthPoll { status: "error".into(), email: None, message: format!("Microsoft rechazó la autorización: {}", token.error_description.unwrap_or(error)) });
        }
        let access_token = token.access_token.ok_or_else(|| "Microsoft no devolvió un token de acceso".to_string())?;
        // El código es de un solo uso: se retira el pendiente aunque el perfil
        // falle después, para no reintentar con un código muerto.
        shared.lock().ok().map(|mut map| map.remove(&oauth_state));
        let account_id = format!("microsoft:{}", client_id);
        save_oauth_tokens(&account_id, &access_token, token.refresh_token.as_deref())?;
        let profile: serde_json::Value = reqwest::blocking::Client::new().get("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName").bearer_auth(&access_token).send().map_err(|e| format!("No se pudo consultar el perfil Microsoft: {e}"))?.json().map_err(|e| format!("Perfil Microsoft inválido: {e}"))?;
        let email = profile.get("mail").and_then(|value| value.as_str()).or_else(|| profile.get("userPrincipalName").and_then(|value| value.as_str())).map(str::to_string);
        Ok(OAuthPoll { status: "authorized".into(), email, message: "Microsoft autorizó la cuenta y el token quedó protegido en el keyring.".into() })
    })
    .await
    .map_err(|e| format!("No se pudo ejecutar el sondeo OAuth: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_guarda_codigo_solo_para_estado_pendiente() {
        let mut map = HashMap::new();
        map.insert("estado-activo".to_string(), PendingOAuth { verifier: "v".into(), code: None, redirect_uri: MS_LOOPBACK_REDIRECT.into(), error: None });
        let shared = Arc::new(Mutex::new(map));
        let request = "GET /oauth/callback?code=ABC123&state=estado-activo HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert!(store_callback_code(request, &shared));
        assert_eq!(shared.lock().unwrap().get("estado-activo").and_then(|item| item.code.clone()).as_deref(), Some("ABC123"));

        // Un state desconocido o una solicitud sin código no completan el intento.
        assert!(!store_callback_code("GET /oauth/callback?code=OTRO&state=desconocido HTTP/1.1\r\n\r\n", &shared));
        assert!(!store_callback_code("GET /favicon.ico HTTP/1.1\r\n\r\n", &shared));
        assert!(!store_callback_code("", &shared));
    }

    #[test]
    fn callback_no_repite_codigo_ya_almacenado() {
        let mut map = HashMap::new();
        map.insert("estado".to_string(), PendingOAuth { verifier: "v".into(), code: Some("primero".into()), redirect_uri: MS_LOOPBACK_REDIRECT.into(), error: None });
        let shared = Arc::new(Mutex::new(map));
        // La segunda redirección con el mismo estado no sobreescribe el código
        // que ya se almacenó: el primer intento ganó.
        let request = "GET /oauth/callback?code=segundo&state=estado HTTP/1.1\r\n\r\n";
        assert!(!store_callback_code(request, &shared));
        assert_eq!(shared.lock().unwrap().get("estado").and_then(|item| item.code.clone()).as_deref(), Some("primero"));
    }

    #[test]
    fn redireccion_nativa_guarda_codigo_y_error() {
        let mut map = HashMap::new();
        map.insert("estado".to_string(), PendingOAuth { verifier: "v".into(), code: None, redirect_uri: MS_NATIVE_REDIRECT.into(), error: None });
        let shared = Arc::new(Mutex::new(map));

        let autorizado = tauri::Url::parse("https://login.microsoftonline.com/common/oauth2/nativeclient?code=ABC123&state=estado").unwrap();
        store_native_redirect(&autorizado, &shared);
        assert_eq!(shared.lock().unwrap().get("estado").and_then(|item| item.code.clone()).as_deref(), Some("ABC123"));

        let cancelado = tauri::Url::parse("https://login.microsoftonline.com/common/oauth2/nativeclient?error=access_denied&state=estado").unwrap();
        store_native_redirect(&cancelado, &shared);
        let message = shared.lock().unwrap().get("estado").and_then(|item| item.error.clone());
        assert!(message.unwrap_or_default().contains("access_denied"));

        // Una redirección de otro intento no toca el estado ajeno.
        store_native_redirect(&autorizado, &shared);
        assert!(shared.lock().unwrap().get("estado").and_then(|item| item.code.clone()).is_some());
    }
}
