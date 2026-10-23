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
use crate::credentials::{save_oauth_tokens, with_oauth_refresh_token};

/// Plazo máximo que el servidor local de callback espera la redirección.
const CALLBACK_DEADLINE: Duration = Duration::from_secs(600);
const CALLBACK_OK: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>e-Meil</title></head><body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0\"><p>✔ Autorización recibida. Puedes cerrar esta ventana y volver a e-Meil.</p></body></html>";
const CALLBACK_SKIP: &str = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n";

/// Permisos que pide e-Meil: leer y organizar correo, enviarlo y mantener la
/// sesión con un refresh token.
const MS_SCOPES: &str = "openid profile email offline_access Mail.ReadWrite Mail.Send";
/// Redirección del flujo clásico con navegador externo y servidor local.
const MS_LOOPBACK_REDIRECT: &str = "http://localhost:43821/oauth/callback";
const MS_LOOPBACK_REDIRECT_ENCODED: &str = "http%3A%2F%2Flocalhost%3A43821%2Foauth%2Fcallback";
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

#[derive(Debug, Deserialize)] struct TokenResponse { access_token: Option<String>, refresh_token: Option<String>, id_token: Option<String>, error: Option<String>, error_description: Option<String> }

/// ===== Gmail (Google OAuth 2.0 + XOAUTH2) =====
///
/// Google bloquea las ventanas embebidas de OAuth, así que Gmail usa el flujo
/// clásico con navegador externo y servidor local. La identidad OAuth es la
/// aplicación de escritorio de Thunderbird, pública y documentada en el código
/// fuente de comm-central: mismo precedente que Microsoft con DavMail, para no
/// pedirle un Client ID a la persona.
///
/// El consentimiento de Google mostrará el nombre "Thunderbird" porque esa es
/// la identidad registrada; el asistente lo explica con franqueza.
const GOOGLE_CLIENT_ID: &str = "406964657835-aq8lmia8j95dhl1a2bvharmfk3t1hgqj.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET: &str = "kSmqreRr0qwBWJgbf5Y-PjSU";
const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
/// Alcance total de Gmail: IMAP y SMTP sobre XOAUTH2, más perfil OIDC para
/// leer el correo de la cuenta desde el id_token.
const GOOGLE_SCOPES: &str = "https://mail.google.com/ openid profile email";
/// Redirect de loopback registrado por Thunderbird: `http://localhost` con
/// cualquier puerto. e-Meil usa un puerto propio para no chocar con Microsoft
/// (que está en el 43821).
const GOOGLE_LOOPBACK_REDIRECT: &str = "http://localhost:43822/";
const GOOGLE_LOOPBACK_REDIRECT_ENCODED: &str = "http%3A%2F%2Flocalhost%3A43822%2F";

/// Identidad OAuth de Google: acepta un reemplazo por entorno para pruebas sin
/// recopilar nada del binario (`EMEIL_GOOGLE_CLIENT_ID`).
fn google_client_id() -> String {
    static OVERRIDE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let env = std::env::var("EMEIL_GOOGLE_CLIENT_ID").ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    OVERRIDE.get_or_init(|| env).clone().unwrap_or_else(|| GOOGLE_CLIENT_ID.into())
}

/// Secreto emparejado de la identidad de escritorio (`EMEIL_GOOGLE_CLIENT_SECRET`).
fn google_client_secret() -> String {
    static OVERRIDE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let env = std::env::var("EMEIL_GOOGLE_CLIENT_SECRET").ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    OVERRIDE.get_or_init(|| env).clone().unwrap_or_else(|| GOOGLE_CLIENT_SECRET.into())
}

/// Abre la sesión de Google en el navegador externo y queda a la escucha del
/// código de autorización en el puerto local 43822.
#[tauri::command]
pub async fn start_google_oauth(app: tauri::AppHandle, state: tauri::State<'_, OAuthState>) -> Result<OAuthStart, String> {
    let verifier: String = rand::thread_rng().sample_iter(&Alphanumeric).take(64).map(char::from).collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let oauth_state: String = rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect();
    state.0.lock().map_err(|_| "No se pudo preparar OAuth".to_string())?.insert(oauth_state.clone(), PendingOAuth { verifier, code: None, redirect_uri: GOOGLE_LOOPBACK_REDIRECT.into(), error: None });
    let scope = GOOGLE_SCOPES.replace(':', "%3A").replace('/', "%2F").replace(' ', "%20");
    let authorization_url = format!("{GOOGLE_AUTH_ENDPOINT}?client_id={}&response_type=code&redirect_uri={GOOGLE_LOOPBACK_REDIRECT_ENCODED}&scope={scope}&state={oauth_state}&code_challenge={challenge}&code_challenge_method=S256&access_type=offline&prompt=select_account", google_client_id());
    // Reintenta el bind por si el puerto está en TIME_WAIT
    let listener = (0..5).find_map(|i| {
        match TcpListener::bind(("127.0.0.1", 43822)) {
            Ok(l) => Some(l),
            Err(_) if i < 4 => { std::thread::sleep(Duration::from_millis(200)); None },
            Err(_) => None,
        }
    }).ok_or_else(|| "No se pudo iniciar el servidor local de Google: el puerto 43822 está en uso".to_string())?;
    listener.set_nonblocking(true).map_err(|e| format!("Callback OAuth local no acepta conexiones: {e}"))?;
    let shared = state.0.clone();
    std::thread::spawn(move || serve_callback(listener, shared));
    app.opener().open_url(authorization_url.clone(), None::<String>).map_err(|e| format!("No se pudo abrir el navegador: {e}"))?;
    Ok(OAuthStart { authorization_url, state: oauth_state, redirect_uri: GOOGLE_LOOPBACK_REDIRECT.into() })
}

/// Canjea el código de Google por tokens bajo PKCE y guarda el resultado
/// (`google:{correo}:oauth:access/refresh`) en el keyring del sistema.
#[tauri::command]
pub async fn poll_google_oauth(state: tauri::State<'_, OAuthState>, oauth_state: String) -> Result<OAuthPoll, String> {
    let shared = state.0.clone();
    let client_id = google_client_id();
    let client_secret = google_client_secret();
    tauri::async_runtime::spawn_blocking(move || -> Result<OAuthPoll, String> {
        let entry = shared.lock().map_err(|_| "No se pudo leer OAuth".to_string())?.get(&oauth_state).map(|item| (item.verifier.clone(), item.code.clone(), item.redirect_uri.clone(), item.error.clone()));
        let Some((verifier, code, redirect_uri, error)) = entry else {
            return Ok(OAuthPoll { status: "pending".into(), email: None, message: "Esperando la autorización de Google…".into() });
        };
        if let Some(error) = error {
            shared.lock().ok().map(|mut map| map.remove(&oauth_state));
            return Ok(OAuthPoll { status: "error".into(), email: None, message: error });
        }
        let Some(code) = code else {
            return Ok(OAuthPoll { status: "pending".into(), email: None, message: "Esperando la autorización de Google…".into() });
        };
        let response = reqwest::blocking::Client::new().post(GOOGLE_TOKEN_ENDPOINT).form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
        ]).send().map_err(|e| format!("No se pudo completar OAuth: {e}"))?;
        let token: TokenResponse = response.json().map_err(|e| format!("Respuesta OAuth inválida: {e}"))?;
        if let Some(error) = token.error {
            shared.lock().ok().map(|mut map| map.remove(&oauth_state));
            return Ok(OAuthPoll { status: "error".into(), email: None, message: format!("Google rechazó la autorización: {}", token.error_description.unwrap_or(error)) });
        }
        let access_token = token.access_token.ok_or_else(|| "Google no devolvió un token de acceso".to_string())?;
        let id_token = token.id_token.ok_or_else(|| "Google no devolvió el perfil de la cuenta".to_string())?;
        let email = email_from_id_token(&id_token).ok_or_else(|| "No se pudo leer el correo de la cuenta desde la sesión de Google".to_string())?;
        // El código es de un solo uso: se retira el pendiente antes de persistir.
        shared.lock().ok().map(|mut map| map.remove(&oauth_state));
        let account_id = format!("google:{email}");
        save_oauth_tokens(&account_id, &access_token, token.refresh_token.as_deref())?;
        Ok(OAuthPoll { status: "authorized".into(), email: Some(email), message: "Google autorizó la cuenta y los tokens quedaron protegidos en el keyring.".into() })
    })
    .await
    .map_err(|e| format!("No se pudo ejecutar el sondeo OAuth: {e}"))?
}

/// Extrae el correo del payload del id_token (JWT con segmentos base64url).
fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    json.get("email")?.as_str()?.trim().to_string().non_empty()
}

trait NonEmptyString { fn non_empty(self) -> Option<String>; }
impl NonEmptyString for String {
    fn non_empty(self) -> Option<String> { if self.is_empty() { None } else { Some(self) } }
}

/// Copia en RAM de los access tokens vigentes: evita golpear a Google en cada
/// conexión IMAP/SMTP. La caducidad que declara Google (~1 h) se corta a 55 min.
fn token_cache() -> &'static std::sync::Mutex<HashMap<String, (String, Instant)>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, (String, Instant)>>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

/// Token de acceso vigente para una cuenta `google:`; refresca y persiste si
/// venció (o si la copia en RAM aún no existe).
pub(crate) fn valid_access_token(email: &str) -> Result<String, String> {
    let account_id = format!("google:{email}");
    if let Ok(cache) = token_cache().lock() {
        if let Some((access, until)) = cache.get(&account_id) {
            if *until > Instant::now() { return Ok(access.clone()); }
        }
    }
    let client_id = google_client_id();
    let client_secret = google_client_secret();
    let access = with_oauth_refresh_token(&account_id, |refresh_token| {
        let response = reqwest::blocking::Client::new().post(GOOGLE_TOKEN_ENDPOINT).form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ]).send().map_err(|e| format!("No se pudo renovar la sesión de Google: {e}"))?;
        let token: TokenResponse = response.json().map_err(|e| format!("Respuesta OAuth inválida al renovar: {e}"))?;
        if let Some(error) = token.error {
            return Err(format!("La sesión de Google no se pudo renovar ({}). Vuelve a conectar la cuenta en Ajustes.", token.error_description.unwrap_or(error)));
        }
        let access = token.access_token.ok_or_else(|| "Google no devolvió un token de acceso al renovar".to_string())?;
        // Google conserva el refresh token; si devuelve otro, se reemplaza.
        save_oauth_tokens(&account_id, &access, token.refresh_token.as_deref().or(Some(refresh_token)))?;
        Ok(access)
    })?;
    if let Ok(mut cache) = token_cache().lock() {
        cache.insert(account_id, (access.clone(), Instant::now() + Duration::from_secs(55 * 60)));
    }
    Ok(access)
}

/// Respuesta inicial del mecanismo SASL XOAUTH2; el crate imap la envuelve con
/// base64 al enviarla.
pub(crate) fn xoauth2_initial_response(email: &str, token: &str) -> Vec<u8> {
    format!("user={email}\u{1}auth=Bearer {token}\u{1}").into_bytes()
}

#[tauri::command]
pub async fn start_microsoft_oauth(app: tauri::AppHandle, state: tauri::State<'_, OAuthState>, client_id: String, tenant: String) -> Result<OAuthStart, String> {
    let client_id = client_id.trim(); if client_id.is_empty() { return Err("Configura el Client ID de Microsoft Entra ID primero".into()); }
    let tenant = if tenant.trim().is_empty() { "common" } else { tenant.trim() };
    let verifier: String = rand::thread_rng().sample_iter(&Alphanumeric).take(64).map(char::from).collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let oauth_state: String = rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect();
    state.0.lock().map_err(|_| "No se pudo preparar OAuth".to_string())?.insert(oauth_state.clone(), PendingOAuth { verifier, code: None, redirect_uri: MS_LOOPBACK_REDIRECT.into(), error: None });
    let redirect_uri = MS_LOOPBACK_REDIRECT;
    let authorization_url = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?client_id={client_id}&response_type=code&redirect_uri={MS_LOOPBACK_REDIRECT_ENCODED}&response_mode=query&scope={scope}&state={oauth_state}&code_challenge={challenge}&code_challenge_method=S256", scope = MS_SCOPES.replace(' ', "%20"));
    // Reintenta el bind por si el puerto está en TIME_WAIT de un intento anterior
    let listener = (0..5).find_map(|i| {
        match TcpListener::bind("127.0.0.1:43821") {
            Ok(l) => Some(l),
            Err(_) if i < 4 => { std::thread::sleep(Duration::from_millis(200)); None },
            Err(e) => return None,
        }
    }).ok_or_else(|| "No se pudo iniciar callback OAuth local: el puerto 43821 está en uso".to_string())?;
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
    // WebView2 (Windows) no dispara `on_navigation` con las redirecciones 302
    // de Microsoft: el `code` aterriza en la página de aviso de Edge y el
    // sondeo esperaría para siempre. Este vigilante consulta la URL vigente
    // de la ventana cada 250 ms y captura el código aunque el handler de
    // navegación no llegue a enterarse.
    let watch_handle = app.clone();
    let watch_shared = state.0.clone();
    let watch_window = window.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + CALLBACK_DEADLINE;
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(250));
            // Un error al leer la URL significa que la ventana ya no existe.
            let Ok(current) = watch_window.url() else { return };
            if !current.as_str().starts_with(MS_NATIVE_REDIRECT) { continue; }
            store_native_redirect(&current, &watch_shared);
            if let Some(window) = watch_handle.get_webview_window(MS_LOGIN_LABEL) { let _ = window.close(); }
            return;
        }
    });
    Ok(OAuthStart { authorization_url, state: oauth_state, redirect_uri: MS_NATIVE_REDIRECT.into() })
}

/// Decodifica pares `clave=valor` de una query o fragmento OAuth.
///
/// Los valores llegan percent-encoded (`%2F`, `%2B`…): se guardan decodificados
/// para que el canje con reqwest los vuelva a codificar exactamente una vez.
fn parse_pairs(source: &str) -> HashMap<String, String> {
    use percent_encoding::percent_decode_str;
    source
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (k.to_string(), percent_decode_str(v).decode_utf8_lossy().into_owned()))
        .collect()
}

/// Extrae los parámetros de la respuesta OAuth de una redirección nativa.
///
/// El endpoint v2 de Microsoft entrega el `code` en la query o en el
/// fragmento (`#code=…`) según cómo esté registrada la identidad del
/// cliente; si la query no trae `state`, se intenta con el fragmento.
fn response_params(url: &tauri::Url) -> HashMap<String, String> {
    let from_query = parse_pairs(url.query().unwrap_or(""));
    if from_query.contains_key("state") { return from_query; }
    parse_pairs(url.fragment().unwrap_or(""))
}

/// Guarda el resultado de la redirección nativa (código o error) en el intento
/// cuyo `state` coincide. La descripción del error se conserva para mostrarla.
fn store_native_redirect(url: &tauri::Url, shared: &Arc<Mutex<HashMap<String, PendingOAuth>>>) {
    let values = response_params(url);
    let Some(received_state) = values.get("state") else { return; };
    let Ok(mut pending) = shared.lock() else { return; };
    let Some(item) = pending.get_mut(received_state.as_str()) else { return; };
    if let Some(error) = values.get("error") {
        item.error = Some(format!("Microsoft rechazó el inicio de sesión: {error}"));
        return;
    }
    if item.code.is_none() {
        if let Some(code) = values.get("code") { item.code = Some(code.clone()); }
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
    let values = parse_pairs(query);
    let (Some(received_state), Some(code)) = (values.get("state"), values.get("code")) else { return false; };
    let Ok(mut pending) = shared.lock() else { return false; };
    match pending.get_mut(received_state.as_str()) {
        // Primero gana: una segunda redirección del mismo intento se ignora.
        Some(item) if item.code.is_none() => { item.code = Some(code.clone()); true }
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
    fn respuesta_xoauth2_tiene_formato_exacto() {
        let response = xoauth2_initial_response("qa@gmail.com", "ya29.token");
        let text = String::from_utf8(response).unwrap();
        assert_eq!(text, "user=qa@gmail.com\u{1}auth=Bearer ya29.token\u{1}");
    }

    #[test]
    fn id_token_entrega_el_correo() {
        // JWT de tres segmentos base64url: el payload lleva el email.
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"email":"QA@Gmail.com","sub":"123"}"#);
        let id_token = format!("eyJhbGciOiJSUzI1NiJ9.{payload}.firma-sin-usar");
        assert_eq!(email_from_id_token(&id_token).as_deref(), Some("QA@Gmail.com"));
        // Un id_token corrupto o sin correo no entrega nada.
        assert!(email_from_id_token("no-es-jwt").is_none());
        let sin_email = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"sub":"1"}"#);
        assert!(email_from_id_token(&format!("a.{sin_email}.c")).is_none());
        assert!(email_from_id_token("a.###.c").is_none());
    }

    #[test]
    fn url_de_autorizacion_de_google_lleva_todos_los_parametros() {
        // Se ejercita el mismo armado de start_google_oauth sin abrir puertos
        // ni navegador: se valida el formato de la URL.
        let verifier = "v".repeat(64);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let scope = GOOGLE_SCOPES.replace(':', "%3A").replace('/', "%2F").replace(' ', "%20");
        let url = format!("{GOOGLE_AUTH_ENDPOINT}?client_id={}&response_type=code&redirect_uri={GOOGLE_LOOPBACK_REDIRECT_ENCODED}&scope={scope}&state=estado&code_challenge={challenge}&code_challenge_method=S256&access_type=offline&prompt=select_account", google_client_id());
        for expected in [
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=",
            "&response_type=code",
            "&redirect_uri=http%3A%2F%2Flocalhost%3A43822%2F",
            "&scope=https%3A%2F%2Fmail.google.com%2F%20openid%20profile%20email",
            "&code_challenge=",
            "&code_challenge_method=S256",
            "&access_type=offline",
            "&prompt=select_account",
            google_client_id().as_str(),
        ] {
            assert!(url.contains(expected), "Falta '{expected}' en {url}");
        }
    }

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

    #[test]
    fn redireccion_en_fragmento_y_valores_codificados() {
        let mut map = HashMap::new();
        map.insert("estado2".to_string(), PendingOAuth { verifier: "v".into(), code: None, redirect_uri: MS_NATIVE_REDIRECT.into(), error: None });
        let shared = Arc::new(Mutex::new(map));

        // Clientes SPA: el endpoint v2 entrega el code en el fragmento, no en la query.
        let fragmento = tauri::Url::parse("https://login.microsoftonline.com/common/oauth2/nativeclient#code=M.C540%2FBAY.2.U.%2Bxyz%3D&state=estado2").unwrap();
        assert!(fragmento.query().is_none(), "el code debe vivir en el fragmento para este test");
        store_native_redirect(&fragmento, &shared);
        assert_eq!(
            shared.lock().unwrap().get("estado2").and_then(|item| item.code.clone()).as_deref(),
            Some("M.C540/BAY.2.U.+xyz="),
            "el code debe leerse del fragmento y decodificarse una sola vez"
        );

        // Query con valores percent-encoded: se decodifican al guardar.
        let mut segundo = HashMap::new();
        segundo.insert("estado3".to_string(), PendingOAuth { verifier: "v".into(), code: None, redirect_uri: MS_NATIVE_REDIRECT.into(), error: None });
        let shared = Arc::new(Mutex::new(segundo));
        let query_codificada = tauri::Url::parse("https://login.microsoftonline.com/common/oauth2/nativeclient?code=0.AXoA%2Fx%2B%3D&state=estado3").unwrap();
        store_native_redirect(&query_codificada, &shared);
        assert_eq!(
            shared.lock().unwrap().get("estado3").and_then(|item| item.code.clone()).as_deref(),
            Some("0.AXoA/x+=")
        );
    }
}
