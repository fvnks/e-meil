use crate::credentials::with_oauth_access_token;
use reqwest::blocking::Client;

fn graph_request(account_id: &str, method: reqwest::Method, url: &str) -> Result<(), String> {
    with_oauth_access_token(account_id, |token| {
        let response = Client::new().request(method, url).bearer_auth(token).send().map_err(|e| format!("No se pudo contactar Microsoft Graph: {e}"))?;
        if !response.status().is_success() { return Err(format!("Microsoft Graph respondió con {}", response.status())); }
        Ok(())
    })
}

#[tauri::command]
pub fn mark_graph_message(account_id: String, message_id: String, read: bool) -> Result<(), String> {
    with_oauth_access_token(&account_id, |token| {
        let response = Client::new().patch(format!("https://graph.microsoft.com/v1.0/me/messages/{message_id}" )).bearer_auth(token).json(&serde_json::json!({"isRead": read})).send().map_err(|e| format!("No se pudo actualizar el mensaje: {e}"))?;
        if !response.status().is_success() { return Err(format!("Microsoft Graph respondió con {}", response.status())); } Ok(())
    })
}

#[tauri::command]
pub fn archive_graph_message(account_id: String, message_id: String) -> Result<(), String> {
    with_oauth_access_token(&account_id, |token| {
        let response = Client::new().post(format!("https://graph.microsoft.com/v1.0/me/messages/{message_id}/move")).bearer_auth(token).json(&serde_json::json!({"destinationId": "archive"})).send().map_err(|e| format!("No se pudo archivar el mensaje: {e}"))?;
        if !response.status().is_success() { return Err(format!("Microsoft Graph respondió con {}", response.status())); } Ok(())
    })
}

#[tauri::command]
pub fn delete_graph_message(account_id: String, message_id: String) -> Result<(), String> { graph_request(&account_id, reqwest::Method::DELETE, &format!("https://graph.microsoft.com/v1.0/me/messages/{message_id}")) }
