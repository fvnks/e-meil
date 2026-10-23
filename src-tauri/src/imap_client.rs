use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use base64::Engine;

use crate::credentials::with_credential;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapConnectionResult {
    pub ok: bool,
    pub mailbox_count: Option<u32>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapFolder {
    pub name: String,
    pub delimiter: Option<String>,
    pub flags: Vec<String>,
    pub special_use: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapAttachment {
    pub part: String,
    pub filename: String,
    pub content_type: String,
    pub size: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapMessage {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub received_at: Option<String>,
    pub preview: String,
    pub unread: bool,
    pub has_attachments: bool,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapMessageContent {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub to_recipients: Option<String>,
    pub cc_recipients: Option<String>,
    pub received_at: Option<String>,
    pub text: String,
    pub html: Option<String>,
    pub has_attachments: bool,
    pub attachments: Vec<ImapAttachment>,
}

fn decode_bytes(bytes: Option<&[u8]>) -> String {
    bytes.map(|raw| String::from_utf8_lossy(raw).to_string()).unwrap_or_default().trim().to_string()
}

fn format_address_parts(name: Option<&[u8]>, mailbox: Option<&[u8]>, host: Option<&[u8]>) -> String {
    let display = decode_bytes(name);
    let local = decode_bytes(mailbox);
    let domain = decode_bytes(host);
    let email = if local.is_empty() && domain.is_empty() { String::new() } else if local.is_empty() { domain } else if domain.is_empty() { local } else { format!("{local}@{domain}") };
    if email.is_empty() { return "Remitente desconocido".into(); }
    if display.is_empty() || display.eq_ignore_ascii_case(&email) { email } else { format!("{display} <{email}>") }
}

fn looks_base64(text: &str) -> bool {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
    if lines.len() < 3 { return false; }
    let candidates = lines.iter().filter(|line| line.len() % 4 == 0 && line.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))).count();
    // At least 50% of lines should look like base64 (lowered for mixed content)
    candidates * 100 >= lines.len() * 50
}

fn normalize_body_text(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw).replace('\r', "");
    let lower = text.to_ascii_lowercase();
    let mut content = text.clone();
    let declared = lower.contains("content-transfer-encoding: base64");
    if let Some(position) = lower.find("content-transfer-encoding: base64") {
        let tail = &text[position..];
        if let Some(blank) = tail.find("\n\n") { content = tail[blank + 2..].to_string(); }
    }
    let trimmed = content.trim().to_string();
    if declared || looks_base64(&trimmed) {
        let compact: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
        if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(&compact) {
            if let Ok(utf8) = std::str::from_utf8(&decoded) {
                if utf8.chars().all(|c| !c.is_control() || matches!(c, '\n' | '\t')) { content = utf8.to_string(); }
            }
        }
    }
    let without_scripts = regex::Regex::new(r"(?is)<(script|style)[^>]*>.*?</(script|style)>").unwrap().replace_all(&content, " ");
    let with_breaks = regex::Regex::new(r"(?i)<br\s*/?>").unwrap().replace_all(&without_scripts, "\n");
    let with_blocks = regex::Regex::new(r"(?i)</(?:p|div|li|tr|h[1-6])>").unwrap().replace_all(&with_breaks, "\n");
    let only_text = regex::Regex::new(r"(?s)<[^>]+>").unwrap().replace_all(&with_blocks, "");
    let tidy = regex::Regex::new(r"[ \t]{2,}").unwrap().replace_all(&only_text, " ");
    let collapsed = regex::Regex::new(r"\n{3,}").unwrap().replace_all(&tidy, "\n\n");
    collapsed.trim().chars().take(4000).collect()
}

/// Decodifica quoted-printable a bytes: `=XX` hex, soft break `=\n` eliminado.
/// Se acumulan bytes y se convierten al final para respetar UTF-8 multi-octeto.
fn decode_quoted_printable(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'=' if i + 1 < bytes.len() && bytes[i + 1] == b'\n' => { i += 2; }
            b'=' if i + 2 < bytes.len() && bytes[i + 1].is_ascii_hexdigit() && bytes[i + 2].is_ascii_hexdigit() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00");
                out.push(u8::from_str_radix(hex, 16).unwrap_or(b'?'));
                i += 3;
            }
            b => { out.push(b); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Decodifica base64 tolerante a espacios y saltos de línea; None si no es
/// UTF-8 razonable tras decodificar (evita basura binaria en la vista HTML).
fn decode_base64_text(input: &str) -> Option<String> {
    let compact: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let decoded = base64::engine::general_purpose::STANDARD.decode(&compact).ok()?;
    let utf8 = std::str::from_utf8(&decoded).ok()?;
    (utf8.chars().all(|c| !c.is_control() || matches!(c, '\n' | '\t'))).then(|| utf8.to_string())
}

/// Extrae la parte text/html de un cuerpo IMAP crudo (BODY[TEXT]).
///
/// Sin parser MIME completo: localiza el encabezado `content-type: text/html`,
/// corta en la próxima línea de boundary, decodifica su transfer-encoding
/// (base64/quoted-printable) y limita el tamaño. Para mensajes de una sola
/// parte sin marcador, acepta el cuerpo completo si realmente parece HTML.
const HTML_MAX_CHARS: usize = 200_000;
fn extract_html_body(raw: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(raw).replace('\r', "");
    let lower = text.to_ascii_lowercase();
    let (content, declared_encoding) = match lower.find("content-type: text/html") {
        Some(position) => {
            let headers_end = lower[position..].find("\n\n").map(|p| position + p + 2)?;
            let headers = &lower[position..headers_end];
            let declared_encoding = if headers.contains("content-transfer-encoding: base64") { Some("base64") }
                else if headers.contains("content-transfer-encoding: quoted-printable") { Some("qp") }
                else { None };
            let body = &text[headers_end..];
            // La parte termina en la próxima línea de boundary "--" del multipart.
            let mut end = body.len();
            let mut offset = 0;
            for line in body.split('\n') {
                if offset > 0 && line.starts_with("--") { end = offset; break; }
                offset += line.len() + 1;
            }
            (body[..end].trim().to_string(), declared_encoding)
        }
        None => (text.trim().to_string(), None),
    };
    if content.is_empty() { return None; }
    let decoded = match declared_encoding {
        Some("base64") => decode_base64_text(&content)?,
        Some("qp") => decode_quoted_printable(&content),
        // Sin CTE declarado: heurística base64 igual que el texto plano.
        _ => decode_base64_text(&content).unwrap_or(content),
    };
    let decoded = decoded.trim().to_string();
    if decoded.is_empty() { return None; }
    let is_html = decoded.to_ascii_lowercase().starts_with("<!doctype") || decoded.contains('<');
    is_html.then(|| decoded.chars().take(HTML_MAX_CHARS).collect())
}

fn validate_host(host: &str) -> Result<&str, String> {
    let host = host.trim();
    if host.is_empty() || host.len() > 253 || host.contains('/') || host.contains('\\') {
        return Err("El servidor IMAP no es válido".into());
    }
    Ok(host)
}

fn connect<'a>(host: &'a str, port: u16, username: &'a str, password: &'a str, security: &str) -> Result<imap::Session<native_tls::TlsStream<std::net::TcpStream>>, String> {
    let tls = TlsConnector::builder().build().map_err(|e| format!("No se pudo preparar TLS: {e}"))?;
    // TLS directo (993) o negociación STARTTLS sobre conexión en claro (143).
    let client = if security == "starttls" {
        imap::connect_starttls((host, port), host, &tls).map_err(|e| format!("No se pudo negociar STARTTLS con el servidor IMAP: {e}"))?
    } else {
        imap::connect((host, port), host, &tls).map_err(|e| format!("No se pudo conectar al servidor IMAP: {e}"))?
    };
    client.login(username, password).map_err(|(e, _)| format!("El servidor rechazó el inicio de sesión IMAP: {e}"))
}

fn validate_inputs(_host: &str, port: u16, security: &str, username: &str) -> Result<(), String> {
    if port == 0 { return Err("El puerto IMAP no es válido".into()); }
    if security != "tls" && security != "starttls" { return Err("Seguridad IMAP no soportada: usa TLS directo (993) o STARTTLS (143).".into()); }
    if username.trim().is_empty() { return Err("El usuario IMAP no puede estar vacío".into()); }
    Ok(())
}

#[tauri::command]
pub fn test_imap_connection(account_id: String, host: String, port: u16, security: String, username: String) -> Result<ImapConnectionResult, String> {
    let host = validate_host(&host)?;
    validate_inputs(host, port, &security, &username)?;
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?;
        let count = session.list(None, Some("*" )).map_err(|e| format!("No se pudieron consultar las carpetas IMAP: {e}"))?.len() as u32;
        session.logout().map_err(|e| format!("La sesión IMAP no pudo cerrarse limpiamente: {e}"))?;
        Ok(ImapConnectionResult { ok: true, mailbox_count: Some(count), message: format!("Conexión correcta. Se encontraron {count} carpetas.") })
    })
}

#[tauri::command]
pub fn list_imap_folders(account_id: String, host: String, port: u16, security: String, username: String) -> Result<Vec<ImapFolder>, String> {
    let host = validate_host(&host)?;
    validate_inputs(host, port, &security, &username)?;
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?;
        let folders = session.list(None, Some("*" )).map_err(|e| format!("No se pudieron listar las carpetas IMAP: {e}"))?.into_iter().map(|mailbox| ImapFolder {
            name: mailbox.name().to_string(), delimiter: mailbox.delimiter().map(str::to_owned), flags: mailbox.attributes().iter().map(|flag| format!("{flag:?}")).collect(), special_use: mailbox.attributes().iter().find_map(|flag| { let value = format!("{flag:?}"); ["\\Archive", "\\All", "\\Trash", "\\Sent", "\\Junk", "\\Drafts"].iter().find(|marker| value.contains(*marker)).map(|marker| marker.trim_start_matches('\\').to_string()) }),
        }).collect();
        session.logout().map_err(|e| format!("La sesión IMAP no pudo cerrarse limpiamente: {e}"))?;
        Ok(folders)
    })
}

#[tauri::command]
pub fn read_imap_message(account_id: String, host: String, port: u16, security: String, username: String, mailbox: String, uid: u32) -> Result<ImapMessageContent, String> {
    let host = validate_host(&host)?;
    validate_inputs(host, port, &security, &username)?;
    let mailbox = mailbox.trim();
    if mailbox.is_empty() || mailbox.len() > 200 || uid == 0 { return Err("El mensaje IMAP no es válido".into()); }
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?;
        session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        let fetches = session.uid_fetch(uid.to_string(), "UID FLAGS ENVELOPE BODY.PEEK[TEXT]").map_err(|e| format!("No se pudo leer el mensaje: {e}"))?;
        let fetch = fetches.iter().next().ok_or_else(|| "El servidor no devolvió el mensaje solicitado".to_string())?;
        let envelope = fetch.envelope();
        let subject = envelope.and_then(|e| e.subject.as_ref()).map(|s| String::from_utf8_lossy(s).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "(sin asunto)".into());
        let from = envelope.and_then(|e| e.from.as_ref().and_then(|addresses| addresses.first())).map(|address| format_address_parts(address.name.as_deref(), address.mailbox.as_deref(), address.host.as_deref())).unwrap_or_else(|| "Remitente desconocido".into());
        let to_recipients = envelope.and_then(|e| e.to.as_ref()).map(|list| list.iter().map(|address| format_address_parts(address.name.as_deref(), address.mailbox.as_deref(), address.host.as_deref())).filter(|formatted| formatted != "Remitente desconocido").collect::<Vec<_>>().join(", "));
        let cc_recipients = envelope.and_then(|e| e.cc.as_ref()).map(|list| list.iter().map(|address| format_address_parts(address.name.as_deref(), address.mailbox.as_deref(), address.host.as_deref())).filter(|formatted| formatted != "Remitente desconocido").collect::<Vec<_>>().join(", "));
        let received_at = envelope.and_then(|e| e.date.as_ref()).map(|d| String::from_utf8_lossy(d).trim().to_string()).filter(|d| !d.is_empty());
        let raw_body: Vec<u8> = fetch.text().or_else(|| fetch.body()).map(|bytes| bytes.to_vec()).unwrap_or_default();
        let raw_text = String::from_utf8_lossy(&raw_body).to_lowercase();
        let has_attachments = raw_text.contains("content-disposition: attachment") || raw_text.contains("multipart/mixed");
        let attachments = if has_attachments { vec![ImapAttachment { part: "1".into(), filename: "Adjunto detectado (descarga pendiente)".into(), content_type: "application/octet-stream".into(), size: None }] } else { Vec::new() };
        let text = normalize_body_text(&raw_body);
        let html = extract_html_body(&raw_body);
        session.logout().map_err(|e| format!("La sesión IMAP no pudo cerrarse limpiamente: {e}"))?;
        Ok(ImapMessageContent { uid, subject, from, to_recipients, cc_recipients, received_at, text, html, has_attachments, attachments })
    })
}

fn fetch_message_headers(session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>, uids: &str) -> Result<Vec<ImapMessage>, String> {
    let fetches = session.uid_fetch(uids, "UID FLAGS ENVELOPE BODY.PEEK[TEXT]<0.600>").map_err(|e| format!("No se pudieron leer los mensajes: {e}"))?;
    let mut messages = Vec::new();
    for fetch in fetches.iter().rev() {
        let envelope = fetch.envelope();
        let subject = envelope.and_then(|e| e.subject.as_ref()).map(|s| String::from_utf8_lossy(s).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "(sin asunto)".into());
        let from = envelope.and_then(|e| e.from.as_ref().and_then(|addresses| addresses.first())).map(|address| format_address_parts(address.name.as_deref(), address.mailbox.as_deref(), address.host.as_deref())).unwrap_or_else(|| "Remitente desconocido".into());
        let preview = fetch.text().or_else(|| fetch.body()).map(|body| normalize_body_text(body).replace('\n', " ").chars().take(180).collect()).unwrap_or_default();
        let uid = fetch.uid.unwrap_or_default();
        let seen = fetch.flags().iter().any(|flag| format!("{flag:?}") == "\\Seen");
        messages.push(ImapMessage { uid, subject, from, received_at: None, preview, unread: !seen, has_attachments: false, message_id: envelope.and_then(|e| e.message_id.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()), in_reply_to: envelope.and_then(|e| e.in_reply_to.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()) });
    }
    Ok(messages)
}

fn validate_mailbox_uid(mailbox: &str, uid: u32) -> Result<&str, String> {
    let mailbox = mailbox.trim();
    if mailbox.is_empty() || mailbox.len() > 200 || uid == 0 { return Err("El mensaje IMAP no es válido".into()); }
    Ok(mailbox)
}

fn safe_filename(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' }).collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() { "adjunto.bin".into() } else { trimmed.chars().take(180).collect() }
}

#[tauri::command]
pub fn download_imap_attachment(account_id: String, host: String, port: u16, security: String, username: String, mailbox: String, uid: u32, part: String, filename: String, destination: String) -> Result<String, String> {
    let host = validate_host(&host)?; validate_inputs(host, port, &security, &username)?; let mailbox = validate_mailbox_uid(&mailbox, uid)?;
    let part = part.trim(); if part.is_empty() || part.len() > 40 || !part.chars().all(|c| c.is_ascii_digit() || c == '.') { return Err("La parte del adjunto no es válida".into()); }
    let destination = std::path::PathBuf::from(destination); if destination.as_os_str().is_empty() { return Err("La ubicación de destino no es válida".into()); }
    let filename = safe_filename(&filename); let target = destination.join(filename);
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?; session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        let fetches = session.uid_fetch(uid.to_string(), format!("BODY.PEEK[{part}]")).map_err(|e| format!("No se pudo descargar el adjunto: {e}"))?;
        let fetch = fetches.iter().next().ok_or_else(|| "El servidor no devolvió el adjunto".to_string())?;
        let body = fetch.body().ok_or_else(|| "El adjunto no contiene datos".to_string())?;
        const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024; if body.len() > MAX_ATTACHMENT_BYTES { return Err("El adjunto supera el límite de 25 MB".into()); }
        let decoded = base64::engine::general_purpose::STANDARD.decode(body).unwrap_or_else(|_| body.to_vec());
        if decoded.len() > MAX_ATTACHMENT_BYTES { return Err("El adjunto supera el límite de 25 MB".into()); }
        std::fs::write(&target, decoded).map_err(|e| format!("No se pudo guardar el adjunto: {e}"))?;
        session.logout().map_err(|e| format!("No se pudo cerrar la sesión IMAP: {e}"))?;
        Ok(target.to_string_lossy().to_string())
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapAppendInput {
    pub account_id: String,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub mailbox: String,
    pub raw_message: String,
}

pub(crate) fn append_raw_to_mailbox(account_id: &str, host: &str, port: u16, security: &str, username: &str, mailbox: &str, raw_message: &[u8]) -> Result<(), String> {
    let host = validate_host(host)?;
    validate_inputs(host, port, security, username)?;
    let mailbox = mailbox.trim();
    if mailbox.is_empty() || mailbox.len() > 200 { return Err("La carpeta no es válida".into()); }
    if raw_message.is_empty() || raw_message.len() > 30 * 1024 * 1024 { return Err("El mensaje a copiar no es válido".into()); }
    with_credential(account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?;
        session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta '{mailbox}': {e}"))?;
        session.append(mailbox, raw_message).map_err(|e| format!("No se pudo guardar el mensaje en '{mailbox}': {e}"))?;
        session.logout().map_err(|e| format!("No se pudo cerrar la sesión IMAP: {e}"))
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapSearchInput { pub account_id: String, pub host: String, pub port: u16, pub security: String, pub username: String, pub mailbox: String, pub query: String }

/// Búsqueda en el servidor (IMAP SEARCH TEXT) sobre una carpeta: devuelve los
/// resúmenes de los mensajes que coinciden, del más nuevo al más viejo.
#[tauri::command]
pub fn search_imap_messages(input: ImapSearchInput) -> Result<Vec<ImapMessage>, String> {
    let host = validate_host(&input.host)?;
    validate_inputs(host, input.port, &input.security, &input.username)?;
    let mailbox = input.mailbox.trim();
    if mailbox.is_empty() { return Err("La carpeta IMAP no es válida".into()); }
    let query = input.query.trim().replace(['"', '\r', '\n'], "");
    if query.chars().count() < 2 { return Err("La búsqueda debe tener al menos 2 caracteres".into()); }

    with_credential(&input.account_id, |password| {
        let mut session = connect(host, input.port, input.username.trim(), password, &input.security)?;
        session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        let uids: Vec<u32> = {
            let found = session.uid_search(format!("TEXT \"{query}\"")).map_err(|e| format!("El servidor rechazó la búsqueda: {e}"))?;
            let mut list: Vec<u32> = found.into_iter().collect();
            list.sort_unstable();
            list.reverse();
            list
        };
        if uids.is_empty() {
            session.logout().map_err(|e| format!("La sesión IMAP no pudo cerrarse limpiamente: {e}"))?;
            return Ok(Vec::new());
        }
        let sequence = uids.iter().map(|uid| uid.to_string()).collect::<Vec<_>>().join(",");
        let fetches = session.fetch(&sequence, "UID FLAGS ENVELOPE BODY.PEEK[TEXT]<0.600>").map_err(|e| format!("No se pudieron leer los mensajes: {e}"))?;
        let mut messages = Vec::new();
        for fetch in fetches.iter() {
            let envelope = fetch.envelope();
            let subject = envelope.and_then(|e| e.subject.as_ref()).map(|s| String::from_utf8_lossy(s).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "(sin asunto)".into());
            let from = envelope.and_then(|e| e.from.as_ref().and_then(|addresses| addresses.first())).map(|address| format_address_parts(address.name.as_deref(), address.mailbox.as_deref(), address.host.as_deref())).unwrap_or_else(|| "Remitente desconocido".into());
            let preview = fetch.text().or_else(|| fetch.body()).map(|body| normalize_body_text(body).replace('\n', " ").chars().take(180).collect()).unwrap_or_default();
            let seen = fetch.flags().iter().any(|flag| format!("{flag:?}") == "\\Seen");
            messages.push(ImapMessage { uid: fetch.uid.unwrap_or_default(), subject, from, received_at: None, preview, unread: !seen, has_attachments: false, message_id: envelope.and_then(|e| e.message_id.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()), in_reply_to: envelope.and_then(|e| e.in_reply_to.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()) });
        }
        session.logout().map_err(|e| format!("La sesión IMAP no pudo cerrarse limpiamente: {e}"))?;
        Ok(messages)
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapDraftInput { pub account_id: String, pub host: String, pub port: u16, pub security: String, pub username: String, pub mailbox: String, pub to: Vec<String>, pub cc: Vec<String>, pub bcc: Vec<String>, pub subject: String, pub html: String }

/// Guarda el redactor en curso como borrador IMAP (APPEND con flag \Draft).
#[tauri::command]
pub fn save_imap_draft(input: ImapDraftInput) -> Result<(), String> {
    let host = validate_host(&input.host)?;
    validate_inputs(host, input.port, &input.security, &input.username)?;
    let mailbox = input.mailbox.trim();
    if mailbox.is_empty() { return Err("No se detectó la carpeta de borradores de esta cuenta".into()); }

    let from: lettre::message::Mailbox = input.username.trim().parse().map_err(|_| "La dirección remitente no es válida".to_string())?;
    let mut builder = lettre::Message::builder().from(from).subject(input.subject.chars().take(998).collect::<String>());
    for recipient in &input.to { let mailbox_addr: lettre::message::Mailbox = recipient.trim().parse().map_err(|_| format!("Destinatario inválido: {recipient}"))?; builder = builder.to(mailbox_addr); }
    for recipient in &input.cc { let mailbox_addr: lettre::message::Mailbox = recipient.trim().parse().map_err(|_| format!("Destinatario inválido: {recipient}"))?; builder = builder.cc(mailbox_addr); }
    for recipient in &input.bcc { let mailbox_addr: lettre::message::Mailbox = recipient.trim().parse().map_err(|_| format!("Destinatario inválido: {recipient}"))?; builder = builder.bcc(mailbox_addr); }
    let message = builder
        .multipart(lettre::message::MultiPart::alternative()
            .singlepart(lettre::message::SinglePart::builder()
                .header(lettre::message::header::ContentType::TEXT_PLAIN)
                .body(input.html.replace("<br>", "\n").replace("</p>", "\n\n").chars().filter(|c| !c.is_control()).collect::<String>()))
            .singlepart(lettre::message::SinglePart::builder()
                .header(lettre::message::header::ContentType::TEXT_HTML)
                .body(input.html.clone())))
        .map_err(|e| format!("No se pudo construir el borrador: {e}"))?;

    with_credential(&input.account_id, |password| {
        let mut session = connect(host, input.port, input.username.trim(), password, &input.security)?;
        session.append_with_flags(mailbox, &message.formatted(), &[imap::types::Flag::Draft]).map_err(|e| format!("No se pudo guardar el borrador en '{mailbox}': {e}"))?;
        session.logout().map_err(|e| format!("No se pudo cerrar la sesión IMAP: {e}"))
    })
}

#[tauri::command]
pub fn append_imap_sent_message(input: ImapAppendInput) -> Result<(), String> {
    append_raw_to_mailbox(&input.account_id, &input.host, input.port, &input.security, &input.username, &input.mailbox, input.raw_message.as_bytes())
}

#[tauri::command]
pub fn set_imap_seen(account_id: String, host: String, port: u16, security: String, username: String, mailbox: String, uid: u32, seen: bool) -> Result<(), String> {
    let host = validate_host(&host)?; validate_inputs(host, port, &security, &username)?; let mailbox = validate_mailbox_uid(&mailbox, uid)?;
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?; session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        if seen { session.uid_store(uid.to_string(), "+FLAGS (\\Seen)") } else { session.uid_store(uid.to_string(), "-FLAGS (\\Seen)") }.map_err(|e| format!("No se pudo actualizar el estado leído: {e}"))?;
        session.logout().map_err(|e| format!("No se pudo cerrar la sesión IMAP: {e}"))
    })
}

#[tauri::command]
pub fn move_imap_message(account_id: String, host: String, port: u16, security: String, username: String, mailbox: String, destination: String, uid: u32) -> Result<(), String> {
    let host = validate_host(&host)?; validate_inputs(host, port, &security, &username)?; let mailbox = validate_mailbox_uid(&mailbox, uid)?; let destination = destination.trim();
    if destination.is_empty() || destination.len() > 200 { return Err("La carpeta de destino no es válida".into()); }
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?; session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        session.uid_mv(uid.to_string(), destination).map_err(|e| format!("No se pudo mover el mensaje: {e}"))?;
        session.logout().map_err(|e| format!("No se pudo cerrar la sesión IMAP: {e}"))
    })
}

#[tauri::command]
pub fn delete_imap_message(account_id: String, host: String, port: u16, security: String, username: String, mailbox: String, uid: u32) -> Result<(), String> {
    let host = validate_host(&host)?; validate_inputs(host, port, &security, &username)?; let mailbox = validate_mailbox_uid(&mailbox, uid)?;
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?; session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        session.uid_store(uid.to_string(), "+FLAGS (\\Deleted)").map_err(|e| format!("No se pudo marcar el mensaje: {e}"))?;
        session.expunge().map_err(|e| format!("No se pudo eliminar el mensaje: {e}"))?;
        session.logout().map_err(|e| format!("No se pudo cerrar la sesión IMAP: {e}"))
    })
}

#[tauri::command]
pub fn list_imap_messages_incremental(account_id: String, host: String, port: u16, security: String, username: String, mailbox: String, after_uid: u32, limit: u16) -> Result<Vec<ImapMessage>, String> {
    let host = validate_host(&host)?; validate_inputs(host, port, &security, &username)?;
    let mailbox = mailbox.trim(); if mailbox.is_empty() || mailbox.len() > 200 { return Err("La carpeta IMAP no es válida".into()); }
    let limit = limit.clamp(1, 100);
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?;
        session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        let uids = session.uid_search(format!("UID {}:*", after_uid.saturating_add(1))).map_err(|e| format!("No se pudieron buscar mensajes nuevos: {e}"))?;
        let mut sorted: Vec<u32> = uids.into_iter().collect(); sorted.sort_unstable(); sorted.reverse(); sorted.truncate(limit as usize);
        let sequence = sorted.iter().map(ToString::to_string).collect::<Vec<_>>().join(",");
        let messages = if sequence.is_empty() { Vec::new() } else { fetch_message_headers(&mut session, &sequence)? };
        session.logout().map_err(|e| format!("La sesión IMAP no pudo cerrarse limpiamente: {e}"))?;
        Ok(messages)
    })
}

#[tauri::command]
pub fn list_imap_messages(account_id: String, host: String, port: u16, security: String, username: String, mailbox: String, limit: u16) -> Result<Vec<ImapMessage>, String> {
    let host = validate_host(&host)?;
    validate_inputs(host, port, &security, &username)?;
    let mailbox = mailbox.trim();
    if mailbox.is_empty() || mailbox.len() > 200 { return Err("La carpeta IMAP no es válida".into()); }
    let limit = limit.clamp(1, 100);
    with_credential(&account_id, |password| {
        let mut session = connect(host, port, username.trim(), password, &security)?;
        session.select(mailbox).map_err(|e| format!("No se pudo abrir la carpeta IMAP: {e}"))?;
        let sequence = format!("*:{limit}");
        let fetches = session.fetch(sequence, "UID FLAGS ENVELOPE BODY.PEEK[TEXT]<0.600>").map_err(|e| format!("No se pudieron leer los mensajes: {e}"))?;
        let mut messages = Vec::new();
        for fetch in fetches.iter().rev() {
            let envelope = fetch.envelope();
            let subject = envelope.and_then(|e| e.subject.as_ref()).map(|s| String::from_utf8_lossy(s).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "(sin asunto)".into());
            let from = envelope.and_then(|e| e.from.as_ref().and_then(|addresses| addresses.first())).map(|address| format_address_parts(address.name.as_deref(), address.mailbox.as_deref(), address.host.as_deref())).unwrap_or_else(|| "Remitente desconocido".into());
            let preview = fetch.text().or_else(|| fetch.body()).map(|body| normalize_body_text(body).replace('\n', " ").chars().take(180).collect()).unwrap_or_default();
            let uid = fetch.uid.unwrap_or_default();
            let seen = fetch.flags().iter().any(|flag| format!("{flag:?}") == "\\Seen");
            messages.push(ImapMessage { uid, subject, from, received_at: None, preview, unread: !seen, has_attachments: false, message_id: envelope.and_then(|e| e.message_id.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()), in_reply_to: envelope.and_then(|e| e.in_reply_to.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()) });
        }
        session.logout().map_err(|e| format!("La sesión IMAP no pudo cerrarse limpiamente: {e}"))?;
        Ok(messages)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_address_parts() {
        assert_eq!(format_address_parts(None, Some(b"user"), Some(b"example.com")), "user@example.com");
        assert_eq!(format_address_parts(Some(b"Juan Perez"), Some(b"juan"), Some(b"example.com")), "Juan Perez <juan@example.com>");
        assert_eq!(format_address_parts(Some(b"user@example.com"), Some(b"user"), Some(b"example.com")), "user@example.com");
        assert_eq!(format_address_parts(None, None, None), "Remitente desconocido");
        assert_eq!(format_address_parts(None, Some(b"user"), None), "user");
        assert_eq!(format_address_parts(Some(b"USER@EXAMPLE.COM"), Some(b"user"), Some(b"example.com")), "user@example.com");
    }

    #[test]
    fn test_decode_bytes() {
        assert_eq!(decode_bytes(Some(b"hello")), "hello");
        assert_eq!(decode_bytes(None), "");
        assert_eq!(decode_bytes(Some(b"  spaced  ")), "spaced");
    }

    #[test]
    fn test_looks_base64() {
        assert!(!looks_base64("hello world"));
        let b64_text = "SGVsbG8gd29ybGQ=\nVGVzdCBtZXNzYWdl\nQmFzZTY0IGVuY29kZWQ=";
        assert!(looks_base64(b64_text));
        let mixed = "Normal text\nSGVsbG8gd29ybGQ=\nMore text\nVGVzdA==";
        assert!(looks_base64(mixed));
    }

    #[test]
    fn test_normalize_body_text() {
        let html = b"<p>Hello <b>world</b></p><script>alert('xss')</script>";
        let result = normalize_body_text(html);
        assert!(result.contains("Hello world"));
        assert!(!result.contains("<script>"));
        assert!(!result.contains("<p>"));
        assert!(!result.contains("<b>"));
        let b64 = "SGVsbG8gd29ybGQ=";
        let mime_with_b64 = format!("Content-Transfer-Encoding: base64\n\n{}", b64);
        let result = normalize_body_text(mime_with_b64.as_bytes());
        assert!(result.contains("Hello world"));
        let html = b"<p>Line 1</p>\n<p>Line 2</p>\n\n<p>Line 3</p>";
        let result = normalize_body_text(html);
        assert!(result.contains("Line 1"));
        assert!(result.contains("Line 2"));
        assert!(result.contains("Line 3"));
        let long = "a".repeat(5000);
        let result = normalize_body_text(long.as_bytes());
        assert_eq!(result.len(), 4000);
    }

    #[test]
    fn test_format_address_parts_special_cases() {
        assert_eq!(format_address_parts(Some(b"Jos\xc3\xa9"), Some(b"jose"), Some(b"example.com")), "Jos\u{00e9} <jose@example.com>");
        assert_eq!(format_address_parts(None, None, Some(b"example.com")), "example.com");
        assert_eq!(format_address_parts(Some(b"  Name  "), Some(b"user"), Some(b"example.com")), "Name <user@example.com>");
    }

    #[test]
    fn decode_quoted_printable_respeta_utf8() {
        assert_eq!(decode_quoted_printable("Hol=C3=A1\nmundo"), "Holá\nmundo");
        assert_eq!(decode_quoted_printable("linea=\nmultilinea"), "lineamultilinea");
        assert_eq!(decode_quoted_printable("sin escapes"), "sin escapes");
        // Un '=' suelto no válido sobrevive tal cual.
        assert_eq!(decode_quoted_printable("a=2Fb=zz"), "a/b=zz");
    }

    #[test]
    fn extract_html_body_encuentra_parte_quoted_printable() {
        let raw = b"--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHola plano\r\n--b1\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Hol=C3=A1</p>\r\n--b1--";
        assert_eq!(extract_html_body(raw).as_deref(), Some("<p>Holá</p>"));
    }

    #[test]
    fn extract_html_body_decodifica_base64() {
        let b64 = base64::engine::general_purpose::STANDARD.encode("<p>Hi</p>");
        let raw = format!("--b1\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n{b64}\n--b1--");
        assert_eq!(extract_html_body(raw.as_bytes()).as_deref(), Some("<p>Hi</p>"));
    }

    #[test]
    fn extract_html_body_acepta_mensaje_simple() {
        // Mensaje de una sola parte: el cuerpo entero ya es HTML.
        assert_eq!(extract_html_body(b"<html><body>Hola</body></html>").as_deref(), Some("<html><body>Hola</body></html>"));
        // Una sola parte en base64 (sin encabezado visible en BODY[TEXT]).
        let b64 = base64::engine::general_purpose::STANDARD.encode("<p>Base64 solo</p>");
        assert_eq!(extract_html_body(b64.as_bytes()).as_deref(), Some("<p>Base64 solo</p>"));
    }

    #[test]
    fn extract_html_body_rechaza_texto_plano() {
        assert_eq!(extract_html_body(b"Hola, este es un mensaje sin HTML."), None);
        assert_eq!(extract_html_body(b"--b1\nContent-Type: text/plain\n\nSolo texto\n--b1--"), None);
        assert_eq!(extract_html_body(b""), None);
    }
}