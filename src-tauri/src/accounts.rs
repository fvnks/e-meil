use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecord {
    pub id: String,
    pub display_name: String,
    pub email_address: String,
    pub provider: String,
    pub incoming_host: String,
    pub incoming_port: u16,
    pub incoming_security: String,
    pub incoming_username: String,
    pub outgoing_host: String,
    pub outgoing_port: u16,
    pub outgoing_security: String,
    pub outgoing_username: String,
    pub auth: String,
    #[serde(default)] pub oauth_client_id: Option<String>,
    #[serde(default)] pub oauth_tenant: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| format!("No se pudo ubicar la configuración: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la configuración: {e}"))?;
    Ok(dir.join("accounts.json"))
}

fn load(app: &AppHandle) -> Result<Vec<AccountRecord>, String> {
    let path = config_path(app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let data = fs::read_to_string(path).map_err(|e| format!("No se pudo leer la configuración: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("La configuración de cuentas está dañada: {e}"))
}

fn save(app: &AppHandle, accounts: &[AccountRecord]) -> Result<(), String> {
    let path = config_path(app)?;
    let data = serde_json::to_string_pretty(accounts).map_err(|e| format!("No se pudo serializar la cuenta: {e}"))?;
    fs::write(path, data).map_err(|e| format!("No se pudo guardar la configuración: {e}"))
}

#[tauri::command]
pub fn list_accounts(app: AppHandle) -> Result<Vec<AccountRecord>, String> { load(&app) }

#[tauri::command]
pub fn save_account(app: AppHandle, account: AccountRecord) -> Result<(), String> {
    if account.email_address.trim().is_empty() { return Err("La dirección de correo es obligatoria".into()); }
    let mut accounts = load(&app)?;
    accounts.retain(|existing| existing.id != account.id);
    accounts.push(account);
    save(&app, &accounts)
}

#[tauri::command]
pub fn delete_account(app: AppHandle, account_id: String) -> Result<(), String> {
    let mut accounts = load(&app)?;
    accounts.retain(|account| account.id != account_id);
    save(&app, &accounts)
}
