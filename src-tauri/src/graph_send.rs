use crate::credentials::with_oauth_access_token;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::fs;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSendInput { pub account_id: String, pub to: Vec<String>, pub cc: Vec<String>, pub bcc: Vec<String>, pub subject: String, pub html: String, pub attachments: Vec<GraphSendAttachment> }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSendAttachment { pub path: String, pub filename: String, pub content_type: String }

fn valid_addresses(values: &[String]) -> Result<Vec<serde_json::Value>, String> {
    values.iter().map(|value| { let address = value.trim(); if !address.contains('@') || address.len() > 320 { return Err(format!("Destinatario inválido: {address}")); } Ok(serde_json::json!({"emailAddress": {"address": address}})) }).collect()
}
fn clean_html(input: &str) -> String { regex::Regex::new(r"(?is)<(script|iframe|object|embed|form)[^>]*>.*?</\1>").unwrap().replace_all(input, "").into_owned() }

#[tauri::command]
pub fn send_graph_message(input: GraphSendInput) -> Result<(), String> {
    if input.to.is_empty() { return Err("Debe existir al menos un destinatario".into()); }
    let to = valid_addresses(&input.to)?; let cc = valid_addresses(&input.cc)?; let bcc = valid_addresses(&input.bcc)?;
    if input.attachments.len() > 10 { return Err("No se permiten más de 10 adjuntos".into()); }
    let mut attachments = Vec::new();
    for item in input.attachments {
        let metadata = fs::metadata(&item.path).map_err(|e| format!("No se pudo leer el adjunto: {e}"))?; if metadata.len() > 25 * 1024 * 1024 { return Err("Cada adjunto debe pesar menos de 25 MB".into()); }
        let content = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, fs::read(&item.path).map_err(|e| format!("No se pudo leer el adjunto: {e}"))?);
        attachments.push(serde_json::json!({"@odata.type":"#microsoft.graph.fileAttachment","name":item.filename.chars().take(180).collect::<String>(),"contentType":item.content_type,"contentBytes":content}));
    }
    let body = serde_json::json!({"message":{"subject":input.subject.chars().take(998).collect::<String>(),"body":{"contentType":"HTML","content":clean_html(&input.html)},"toRecipients":to,"ccRecipients":cc,"bccRecipients":bcc,"attachments":attachments},"saveToSentItems":true});
    with_oauth_access_token(&input.account_id, |token| { let response = Client::new().post("https://graph.microsoft.com/v1.0/me/sendMail").bearer_auth(token).json(&body).send().map_err(|e| format!("No se pudo enviar por Microsoft Graph: {e}"))?; if !response.status().is_success() { return Err(format!("Microsoft Graph respondió con {}", response.status())); } Ok(()) })
}

/// Crea un borrador en la carpeta Borradores de Microsoft 365 (POST /me/messages).
#[tauri::command]
pub fn create_graph_draft(input: GraphSendInput) -> Result<(), String> {
    let to = valid_addresses(&input.to)?;
    let cc = valid_addresses(&input.cc)?;
    let bcc = valid_addresses(&input.bcc)?;
    let body = serde_json::json!({"subject":input.subject.chars().take(998).collect::<String>(),"body":{"contentType":"HTML","content":clean_html(&input.html)},"toRecipients":to,"ccRecipients":cc,"bccRecipients":bcc});
    with_oauth_access_token(&input.account_id, |token| {
        let response = Client::new().post("https://graph.microsoft.com/v1.0/me/messages").bearer_auth(token).json(&body).send().map_err(|e| format!("No se pudo crear el borrador Graph: {e}"))?;
        if !response.status().is_success() { return Err(format!("Microsoft Graph respondió con {}", response.status())); }
        Ok(())
    })
}
