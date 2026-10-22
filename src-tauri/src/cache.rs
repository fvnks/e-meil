use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMessage {
    pub account_id: String,
    pub mailbox: String,
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub received_at: Option<String>,
    pub preview: String,
    pub text: Option<String>,
    pub unread: bool,
    pub starred: bool,
    pub has_attachments: bool,
    pub cached_at: String,
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| format!("No se pudo ubicar la caché: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la caché: {e}"))?;
    Ok(dir.join("messages.json"))
}

fn load(app: &AppHandle) -> Result<Vec<CachedMessage>, String> {
    let path = cache_path(app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let data = fs::read_to_string(path).map_err(|e| format!("No se pudo leer la caché: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("La caché está dañada: {e}"))
}

fn save(app: &AppHandle, messages: &[CachedMessage]) -> Result<(), String> {
    let path = cache_path(app)?;
    let tmp = path.with_extension("tmp");
    let data = serde_json::to_string_pretty(messages).map_err(|e| format!("No se pudo serializar la caché: {e}"))?;
    fs::write(&tmp, data).map_err(|e| format!("No se pudo escribir la caché: {e}"))?;
    fs::rename(tmp, path).map_err(|e| format!("No se pudo confirmar la caché: {e}"))
}

#[tauri::command]
pub fn list_cached_messages(app: AppHandle, account_id: String, mailbox: String) -> Result<Vec<CachedMessage>, String> {
    Ok(load(&app)?.into_iter().filter(|message| message.account_id == account_id && message.mailbox == mailbox).collect())
}

#[tauri::command]
pub fn upsert_cached_messages(app: AppHandle, incoming: Vec<CachedMessage>) -> Result<(), String> {
    let mut messages = load(&app)?;
    for message in incoming {
        messages.retain(|existing| !(existing.account_id == message.account_id && existing.mailbox == message.mailbox && existing.uid == message.uid));
        messages.push(message);
    }
    // Keep the cache bounded while preserving the newest records by insertion order.
    if messages.len() > 5000 { messages.drain(0..messages.len() - 5000); }
    save(&app, &messages)
}

#[tauri::command]
pub fn update_cached_message_state(app: AppHandle, account_id: String, mailbox: String, uid: u32, unread: Option<bool>, starred: Option<bool>) -> Result<(), String> {
    let mut messages = load(&app)?;
    if let Some(message) = messages.iter_mut().find(|message| message.account_id == account_id && message.mailbox == mailbox && message.uid == uid) {
        if let Some(value) = unread { message.unread = value; }
        if let Some(value) = starred { message.starred = value; }
    }
    save(&app, &messages)
}
