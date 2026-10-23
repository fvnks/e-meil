use crate::credentials::{save_oauth_tokens, with_oauth_refresh_token};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMessage { pub id: String, pub subject: String, pub sender: String, pub preview: String, pub body: Option<String>, pub received_at: Option<String>, pub is_read: bool, pub has_attachments: bool, pub to_recipients: Option<String>, pub conversation_id: Option<String> }

#[derive(Debug, Deserialize)] struct TokenResponse { access_token: Option<String>, refresh_token: Option<String>, #[allow(dead_code)] expires_in: Option<u64>, error: Option<String>, error_description: Option<String> }
#[derive(Debug, Deserialize)] struct GraphResponse { value: Vec<GraphRawMessage> }
#[derive(Debug, Deserialize)] struct GraphRawMessage { id: String, subject: Option<String>, body_preview: Option<String>, body: Option<GraphBody>, is_read: Option<bool>, has_attachments: Option<bool>, received_date_time: Option<String>, from: Option<GraphFrom>, #[serde(rename = "toRecipients")] to_recipients: Option<Vec<GraphRecipientList>>, #[serde(rename = "conversationId")] conversation_id: Option<String> }
#[derive(Debug, Deserialize)] struct GraphBody { content: Option<String> }
#[derive(Debug, Deserialize)] struct GraphFrom { email_address: Option<GraphAddress> }
#[derive(Debug, Deserialize)] struct GraphRecipientList { email_address: Option<GraphAddress> }
#[derive(Debug, Deserialize)] struct GraphAddress { address: Option<String> }

fn refresh_token(account_id: &str, client_id: &str, tenant: &str) -> Result<String, String> {
    with_oauth_refresh_token(account_id, |refresh| {
        let endpoint = format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", if tenant.trim().is_empty() { "common" } else { tenant.trim() });
        let response = Client::new().post(endpoint).form(&[("client_id", client_id.trim()), ("grant_type", "refresh_token"), ("refresh_token", refresh), ("scope", "openid profile email offline_access Mail.Read Mail.Send")]).send().map_err(|e| format!("No se pudo renovar OAuth: {e}"))?;
        let token: TokenResponse = response.json().map_err(|e| format!("Respuesta de renovación inválida: {e}"))?;
        if let Some(error) = token.error { return Err(token.error_description.unwrap_or(error)); }
        let access = token.access_token.ok_or_else(|| "Microsoft no devolvió un access token renovado".to_string())?;
        save_oauth_tokens(account_id, &access, token.refresh_token.as_deref())?;
        Ok(access)
    })
}

/// Codifica el mínimo necesario para usar un valor dentro de un query param.
fn encode_query_value(value: &str) -> String {
    value.replace('%', "%25").replace(' ', "%20").replace('"', "%22").replace('#', "%23").replace('&', "%26").replace('+', "%2B").replace('\r', "").replace('\n', "")
}

#[tauri::command]
pub fn list_graph_messages(account_id: String, client_id: String, tenant: String, top: Option<u32>, search: Option<String>) -> Result<Vec<GraphMessage>, String> {
    let access = refresh_token(&account_id, &client_id, &tenant)?;
    let limit = top.unwrap_or(30).clamp(1, 100);
    let select = "id,subject,bodyPreview,body,isRead,hasAttachments,receivedDateTime,from,toRecipients,conversationId";
    let (url, use_search) = match search.as_deref().map(str::trim).filter(|query| query.chars().count() >= 2) {
        Some(query) => (format!("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top={limit}&$select={select}&$search={}", encode_query_value(&format!("\"{query}\""))), true),
        None => (format!("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top={limit}&$orderby=receivedDateTime%20desc&$select={select}"), false),
    };
    // $search es incompatible con $orderby y exige el encabezado ConsistencyLevel.
    let mut request = Client::new().get(&url).bearer_auth(access);
    if use_search { request = request.header("ConsistencyLevel", "eventual"); }
    let response = request.send().map_err(|e| format!("No se pudo consultar Microsoft Graph: {e}"))?;
    if !response.status().is_success() { return Err(format!("Microsoft Graph respondió con {}", response.status())); }
    let payload: GraphResponse = response.json().map_err(|e| format!("Respuesta Graph inválida: {e}"))?;
    Ok(payload.value.into_iter().map(|message| GraphMessage { id: message.id, body: message.body.and_then(|body| body.content), has_attachments: message.has_attachments.unwrap_or(false), subject: message.subject.unwrap_or_else(|| "(Sin asunto)".into()), sender: message.from.and_then(|from| from.email_address).and_then(|address| address.address).unwrap_or_else(|| "Desconocido".into()), preview: message.body_preview.unwrap_or_default(), received_at: message.received_date_time, is_read: message.is_read.unwrap_or(false), to_recipients: message.to_recipients.map(|recipients| recipients.iter().filter_map(|recipient| recipient.email_address.as_ref().and_then(|address| address.address.clone())).collect::<Vec<_>>().join(", ")).filter(|joined| !joined.is_empty()), conversation_id: message.conversation_id }).collect())
}
