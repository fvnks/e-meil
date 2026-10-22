use lettre::{message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart}, Message, SmtpTransport, Transport};
use lettre::transport::smtp::authentication::Credentials;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

use crate::credentials::with_credential;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentCopyInput {
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub mailbox: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMailInput {
    pub account_id: String,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub html: String,
    pub attachments: Vec<SendAttachment>,
    pub sent_copy: Option<SentCopyInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAttachment { pub path: String, pub filename: String, pub content_type: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo { pub name: String, pub size: u64, pub content_type: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendSmtpResult {
    pub delivered: bool,
    pub sent_copy_saved: Option<bool>,
    pub sent_copy_error: Option<String>,
}

#[tauri::command]
pub fn inspect_attachment(path: String) -> Result<AttachmentInfo, String> {
    let file = Path::new(&path); let metadata = fs::metadata(file).map_err(|e| format!("No se pudo leer el adjunto: {e}"))?;
    if !metadata.is_file() { return Err("La ruta seleccionada no es un archivo".into()); }
    if metadata.len() > 25 * 1024 * 1024 { return Err("El adjunto supera el límite de 25 MB".into()); }
    let name = file.file_name().and_then(|name| name.to_str()).unwrap_or("adjunto").chars().take(180).collect::<String>();
    let content_type = mime_guess::from_path(file).first_or_octet_stream().essence_str().to_string();
    Ok(AttachmentInfo { name, size: metadata.len(), content_type })
}

fn clean_html(input: &str) -> String {
    let without_scripts = regex::Regex::new(r"(?is)<(script|iframe|object|embed|form)[^>]*>.*?</\1>").unwrap().replace_all(input, "");
    regex::Regex::new(r#"(?i)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')"#).unwrap().replace_all(&without_scripts, "").into_owned()
}

fn parse_mailboxes(values: &[String]) -> Result<Vec<Mailbox>, String> {
    if values.is_empty() { return Err("Debe existir al menos un destinatario".into()); }
    values.iter().map(|value| value.parse::<Mailbox>().map_err(|_| format!("Destinatario inválido: {value}"))).collect()
}

#[tauri::command]
pub fn send_smtp_mail(input: SendMailInput) -> Result<SendSmtpResult, String> {
    let host = input.host.trim(); if host.is_empty() || input.port == 0 { return Err("El servidor SMTP no es válido".into()); }
    if input.security != "tls" && input.security != "starttls" { return Err("Seguridad SMTP no soportada: usa TLS directo (465) o STARTTLS (587).".into()); }
    let sender: Mailbox = input.username.parse().map_err(|_| "La dirección remitente no es válida".to_string())?;
    let to = parse_mailboxes(&input.to)?; let cc = parse_mailboxes(&input.cc).unwrap_or_default(); let bcc = parse_mailboxes(&input.bcc).unwrap_or_default();
    let mut builder = Message::builder().from(sender).subject(input.subject.chars().take(998).collect::<String>());
    for recipient in to { builder = builder.to(recipient); } for recipient in cc { builder = builder.cc(recipient); } for recipient in bcc { builder = builder.bcc(recipient); }
    let html = clean_html(&input.html);
    let mut multipart = MultiPart::mixed().singlepart(SinglePart::builder().header(ContentType::TEXT_HTML).body(html));
    for attachment in input.attachments.iter().take(10) {
        let path = Path::new(&attachment.path); let metadata = fs::metadata(path).map_err(|e| format!("No se pudo leer el adjunto: {e}"))?; if metadata.len() > 25 * 1024 * 1024 { return Err("Cada adjunto debe pesar menos de 25 MB".into()); }
        let data = fs::read(path).map_err(|e| format!("No se pudo leer el adjunto: {e}"))?; let content_type = attachment.content_type.parse().unwrap_or(ContentType::parse("application/octet-stream").expect("valid fallback MIME"));
        multipart = multipart.singlepart(Attachment::new(attachment.filename.chars().take(180).collect()).body(data, content_type));
    }
    let message = builder.multipart(multipart).map_err(|e| format!("No se pudo construir el mensaje: {e}"))?;
    with_credential(&input.account_id, |password| {
        let credentials = Credentials::new(input.username.clone(), password.to_string());
        // TLS directo (465, conexión implícita) o STARTTLS (587, upgrade en claro).
        let transport = if input.security == "starttls" {
            SmtpTransport::starttls_relay(host).map_err(|e| format!("No se pudo preparar SMTP STARTTLS: {e}"))?
        } else {
            SmtpTransport::relay(host).map_err(|e| format!("No se pudo preparar SMTP TLS: {e}"))?
        };
        let transport = transport.port(input.port).credentials(credentials).build();
        transport.send(&message).map_err(|e| format!("El servidor SMTP rechazó el mensaje: {e}"))?;
        Ok(())
    })?;
    let mut sent_copy_saved = None;
    let mut sent_copy_error = None;
    if let Some(sent) = input.sent_copy {
        match super::imap_client::append_raw_to_mailbox(&input.account_id, &sent.host, sent.port, &sent.security, &sent.username, &sent.mailbox, &message.formatted()) {
            Ok(()) => sent_copy_saved = Some(true),
            Err(error) => { sent_copy_saved = Some(false); sent_copy_error = Some(error); }
        }
    }
    Ok(SendSmtpResult { delivered: true, sent_copy_saved, sent_copy_error })
}
