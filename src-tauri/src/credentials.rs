use keyring::Entry;
use serde::Serialize;

const SERVICE_NAME: &str = "org.emeil.client";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub backend: &'static str,
    pub available: bool,
    pub message: Option<String>,
}

fn entry(account_id: &str) -> Result<Entry, String> {
    let id = account_id.trim();
    if id.is_empty() {
        return Err("El identificador de cuenta no puede estar vacío".into());
    }
    Entry::new(SERVICE_NAME, id).map_err(|e| format!("No se pudo acceder al almacén seguro: {e}"))
}

#[tauri::command]
pub fn save_credential(account_id: String, secret: String) -> Result<(), String> {
    if secret.is_empty() {
        return Err("La contraseña no puede estar vacía".into());
    }
    entry(&account_id)?.set_password(&secret).map_err(|e| format!("No se pudo guardar la credencial: {e}"))
}

#[allow(dead_code)]
pub fn save_oauth_tokens(account_id: &str, access_token: &str, refresh_token: Option<&str>) -> Result<(), String> {
    if access_token.trim().is_empty() { return Err("El access token está vacío".into()); }
    entry(&format!("{account_id}:oauth:access"))?.set_password(access_token).map_err(|e| format!("No se pudo guardar el access token: {e}"))?;
    if let Some(refresh) = refresh_token.filter(|token| !token.trim().is_empty()) { entry(&format!("{account_id}:oauth:refresh"))?.set_password(refresh).map_err(|e| format!("No se pudo guardar el refresh token: {e}"))?; }
    Ok(())
}

pub fn with_oauth_refresh_token<T, F>(account_id: &str, operation: F) -> Result<T, String>
where F: FnOnce(&str) -> Result<T, String> {
    let token = entry(&format!("{account_id}:oauth:refresh"))?.get_password().map_err(|e| format!("No se pudo obtener el refresh token OAuth: {e}"))?;
    operation(&token)
}

#[allow(dead_code)]
pub fn with_oauth_access_token<T, F>(account_id: &str, operation: F) -> Result<T, String>
where F: FnOnce(&str) -> Result<T, String> {
    let token = entry(&format!("{account_id}:oauth:access"))?.get_password().map_err(|e| format!("No se pudo obtener el token OAuth: {e}"))?;
    operation(&token)
}

pub fn with_credential<T, F>(account_id: &str, operation: F) -> Result<T, String>
where
    F: FnOnce(&str) -> Result<T, String>,
{
    let secret = entry(account_id)?.get_password().map_err(|e| format!("No se pudo obtener la credencial: {e}"))?;
    operation(&secret)
}

#[tauri::command]
pub fn delete_credential(account_id: String) -> Result<(), String> {
    match entry(&account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("No se pudo eliminar la credencial: {e}")),
    }
}

#[tauri::command]
pub fn credential_backend_status() -> CredentialStatus {
    #[cfg(target_os = "windows")]
    let (backend, available, message) = ("windows-credential-manager", true, None);
    #[cfg(target_os = "linux")]
    let (backend, available, message) = ("linux-secret-service", true, None);
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let (backend, available, message) = ("unsupported", false, Some("Sistema operativo no soportado".to_string()));
    CredentialStatus { backend, available, message }
}
