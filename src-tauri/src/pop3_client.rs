use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use base64::Engine;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::credentials::with_credential;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pop3ConnectionResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pop3Message {
    pub uidl: String,
    pub subject: String,
    pub from: String,
    pub received_at: Option<String>,
    pub preview: String,
    pub size: u32,
    pub has_attachments: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pop3MessageContent {
    pub uidl: String,
    pub subject: String,
    pub from: String,
    pub received_at: Option<String>,
    pub text: String,
    pub has_attachments: bool,
    pub size: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pop3TestInput {
    pub account_id: String,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pop3ListInput {
    pub account_id: String,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub limit: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pop3ReadInput {
    pub account_id: String,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub uidl: String,
}

fn validate_host(host: &str) -> Result<&str, String> {
    let host = host.trim();
    if host.is_empty() || host.len() > 253 || host.contains('/') || host.contains('\\') {
        return Err("El servidor POP3 no es válido".into());
    }
    Ok(host)
}

fn validate_inputs(_host: &str, port: u16, security: &str, username: &str) -> Result<(), String> {
    if port == 0 { return Err("El puerto POP3 no es válido".into()); }
    if security != "tls" { return Err("Solo se permite POP3 con TLS directo (normalmente puerto 995)".into()); }
    if username.trim().is_empty() { return Err("El usuario POP3 no puede estar vacío".into()); }
    Ok(())
}

fn connect_pop3(host: &str, port: u16, username: &str, password: &str) -> Result<BufReader<native_tls::TlsStream<std::net::TcpStream>>, String> {
    let tls = TlsConnector::builder().build().map_err(|e| format!("No se pudo preparar TLS: {e}"))?;
    let addr = (host, port).to_socket_addrs().map_err(|e| format!("No se pudo resolver el host: {e}"))?.next().ok_or("No se pudo resolver el host")?;
    let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(10)).map_err(|e| format!("No se pudo conectar al servidor POP3: {e}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
    let tls_stream = tls.connect(host, stream).map_err(|e| format!("Error en handshake TLS: {e}"))?;
    
    let mut reader = BufReader::new(tls_stream);
    
    // Read greeting
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| format!("No se pudo leer saludo POP3: {e}"))?;
    if !line.starts_with("+OK") {
        return Err(format!("Servidor POP3 rechazó la conexión: {line}"));
    }
    
    // USER
    write!(&mut *reader.get_mut(), "USER {}\r\n", username.trim()).map_err(|e| format!("No se pudo enviar USER: {e}"))?;
    reader.get_mut().flush().map_err(|e| format!("No se pudo hacer flush: {e}"))?;
    line.clear();
    reader.read_line(&mut line).map_err(|e| format!("No se pudo leer respuesta USER: {e}"))?;
    if !line.starts_with("+OK") {
        return Err(format!("Usuario rechazado: {line}"));
    }
    
    // PASS
    write!(&mut *reader.get_mut(), "PASS {}\r\n", password).map_err(|e| format!("No se pudo enviar PASS: {e}"))?;
    reader.get_mut().flush().map_err(|e| format!("No se pudo hacer flush: {e}"))?;
    line.clear();
    reader.read_line(&mut line).map_err(|e| format!("No se pudo leer respuesta PASS: {e}"))?;
    if !line.starts_with("+OK") {
        return Err(format!("Contraseña rechazada: {line}"));
    }
    
    Ok(reader)
}

fn read_line<R: Read>(reader: &mut BufReader<R>) -> Result<String, String> {
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| format!("Error leyendo línea: {e}"))?;
    Ok(line)
}

/// Lee la respuesta multiparrafo de POP3 hasta la linea terminadora ".".
/// Aplica el "dot-stuffing" inverso que exige el protocolo.
fn read_response_lines<R: Read>(reader: &mut BufReader<R>) -> Result<Vec<String>, String> {
    let mut lines = Vec::new();
    loop {
        let raw = read_line(reader)?;
        let trimmed = raw.trim_end_matches(['\r', '\n']).to_string();
        if trimmed == "." { break; }
        lines.push(trimmed.strip_prefix('.').map(str::to_string).unwrap_or(trimmed));
    }
    Ok(lines)
}

fn send_command<R: Read + Write>(reader: &mut BufReader<R>, command: &str) -> Result<Vec<String>, String> {
    write!(&mut *reader.get_mut(), "{command}\r\n").map_err(|e| format!("No se pudo enviar {command}: {e}"))?;
    reader.get_mut().flush().map_err(|e| format!("No se pudo hacer flush: {e}"))?;
    let status = read_line(reader)?;
    if !status.starts_with("+OK") {
        return Err(format!("El servidor POP3 rechazó {command}: {}", status.trim()));
    }
    read_response_lines(reader)
}

/// Decodifica cabeceras MIME codificadas (RFC 2047) en sus variantes base64 y quoted-printable.
fn decode_rfc2047(input: &str) -> String {
    let mut output = String::new();
    let mut rest = input;
    while let Some(start) = rest.find("=?") {
        output.push_str(&rest[..start]);
        let tail = &rest[start + 2..];
        let Some(end) = tail.find("?=") else {
            output.push_str("=?");
            rest = tail;
            break;
        };
        let encoded = &tail[..end];
        rest = &tail[end + 2..];
        let mut parts = encoded.splitn(3, '?');
        let (charset, encoding, payload) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let decoded = match encoding.to_ascii_uppercase().as_str() {
            "B" => base64::engine::general_purpose::STANDARD
                .decode(payload.replace(['\r', '\n', ' '], ""))
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
                .unwrap_or_else(|| encoded.to_string()),
            "Q" => decode_quoted_printable(payload),
            _ => payload.to_string(),
        };
        let _ = charset;
        output.push_str(&decoded);
    }
    output.push_str(rest);
    output
}

fn decode_quoted_printable(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'=' if index + 1 < bytes.len() && bytes[index + 1] == b'\n' => index += 2,
            b'=' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => { out.push(byte); index += 3; }
                    Err(_) => { out.push(bytes[index]); index += 1; }
                }
            }
            other => { out.push(other); index += 1; }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Convierte la respuesta de `UIDL` + `LIST` en la lista de mensajes del buzón.
fn parse_message_list(list_lines: &[String], uidl_lines: &[String]) -> Vec<Pop3Message> {
    let mut uidls: Vec<(u32, String)> = Vec::new();
    for line in uidl_lines {
        let mut parts = line.split_whitespace();
        if let (Some(number), Some(uidl)) = (parts.next(), parts.next()) {
            if let Ok(index) = number.parse::<u32>() {
                uidls.push((index, uidl.to_string()));
            }
        }
    }
    let mut messages = Vec::new();
    for line in list_lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 { continue; }
        let Ok(number) = parts[0].parse::<u32>() else { continue; };
        let size = parts[1].parse::<u32>().unwrap_or(0);
        let uidl = uidls
            .iter()
            .find(|(index, _)| *index == number)
            .map(|(_, uidl)| uidl.clone())
            .unwrap_or_else(|| number.to_string());
        messages.push(Pop3Message {
            uidl,
            subject: "(asunto pendiente)".into(),
            from: "(remitente pendiente)".into(),
            received_at: None,
            preview: format!("Mensaje POP3 #{}, {} bytes", number, size),
            size,
            has_attachments: false,
        });
    }
    messages
}

/// Extrae asunto, remitente, fecha y cuerpo de un mensaje POP3 retrieved.
fn parse_message_content(uidl: &str, raw_lines: &[String]) -> Pop3MessageContent {
    let mut subject = String::new();
    let mut from = String::new();
    let mut received_at: Option<String> = None;
    let mut body = String::new();
    let mut in_body = false;
    for line in raw_lines {
        if in_body {
            body.push_str(line);
            body.push('\n');
            continue;
        }
        if line.trim().is_empty() {
            in_body = true;
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            match key.trim().to_ascii_lowercase().as_str() {
                "subject" => subject = decode_rfc2047(value.trim()),
                "from" => from = decode_rfc2047(value.trim()),
                "date" => received_at = Some(value.trim().to_string()),
                _ => {}
            }
        }
    }
    let size = raw_lines.iter().map(|line| line.len() as u32).sum();
    Pop3MessageContent {
        uidl: uidl.to_string(),
        subject,
        from,
        received_at,
        text: body.trim().to_string(),
        has_attachments: false,
        size,
    }
}

#[tauri::command]
pub async fn test_pop3_connection(input: Pop3TestInput) -> Result<Pop3ConnectionResult, String> {
    let host = validate_host(&input.host)?;
    validate_inputs(host, input.port, &input.security, &input.username)?;
    
    with_credential(&input.account_id, |password| {
        let _reader = connect_pop3(host, input.port, input.username.trim(), password)?;
        Ok(Pop3ConnectionResult { ok: true, message: "Conexión POP3 correcta".into() })
    })
}

#[tauri::command]
pub fn list_pop3_messages(input: Pop3ListInput) -> Result<Vec<Pop3Message>, String> {
    let host = validate_host(&input.host)?;
    validate_inputs(host, input.port, &input.security, &input.username)?;
    let limit = input.limit.clamp(1, 100) as usize;

    with_credential(&input.account_id, |password| {
        let mut reader = connect_pop3(host, input.port, input.username.trim(), password)?;

        let uidl_lines = send_command(&mut reader, "UIDL")?;
        let list_lines = send_command(&mut reader, "LIST")?;
        let _ = send_command(&mut reader, "QUIT");

        let messages = parse_message_list(&list_lines, &uidl_lines);
        Ok(messages.into_iter().take(limit).collect())
    })
}

#[tauri::command]
pub fn read_pop3_message(input: Pop3ReadInput) -> Result<Pop3MessageContent, String> {
    let host = validate_host(&input.host)?;
    validate_inputs(host, input.port, &input.security, &input.username)?;
    
    let uidl = input.uidl.trim();
    if uidl.is_empty() || !uidl.chars().all(|c| c.is_ascii_digit()) {
        return Err("El identificador de mensaje POP3 no es válido".into());
    }

    with_credential(&input.account_id, |password| {
        let mut reader = connect_pop3(host, input.port, input.username.trim(), password)?;
        let raw = send_command(&mut reader, &format!("RETR {uidl}"))?;
        let _ = send_command(&mut reader, "QUIT");
        Ok(parse_message_content(uidl, &raw))
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_message_list_joins_uidl_and_size() {
        let list = vec!["1 2048".to_string(), "2 512".to_string()];
        let uidl = vec!["1 abc123".to_string(), "2 def456".to_string()];
        let messages = parse_message_list(&list, &uidl);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].uidl, "abc123");
        assert_eq!(messages[0].size, 2048);
        assert_eq!(messages[1].uidl, "def456");
        assert_eq!(messages[1].size, 512);
    }

    #[test]
    fn test_parse_message_list_ignores_malformed_lines() {
        let list = vec!["basura".to_string(), "3 100".to_string()];
        let uidl = vec!["3 xyz".to_string()];
        let messages = parse_message_list(&list, &uidl);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].uidl, "xyz");
    }

    #[test]
    fn test_parse_message_content_extracts_headers_and_body() {
        let raw = vec![
            "Subject: Hola".to_string(),
            "From: Ana <ana@ejemplo.com>".to_string(),
            "Date: Tue, 21 Oct 2026 09:00:00 -0300".to_string(),
            String::new(),
            "Primera linea".to_string(),
            "Segunda linea".to_string(),
        ];
        let content = parse_message_content("42", &raw);
        assert_eq!(content.uidl, "42");
        assert_eq!(content.subject, "Hola");
        assert_eq!(content.from, "Ana <ana@ejemplo.com>");
        assert!(content.received_at.is_some());
        assert_eq!(content.text, "Primera linea\nSegunda linea");
    }

    #[test]
    fn test_decode_rfc2047_base64_and_quoted_printable() {
        assert_eq!(decode_rfc2047("=?utf-8?B?SG9sYQ==?="), "Hola");
        assert_eq!(decode_rfc2047("=?utf-8?Q?Caf=C3=A9?="), "Caf\u{e9}");
        assert_eq!(decode_rfc2047("Texto normal"), "Texto normal");
    }

    #[test]
    fn test_read_response_lines_removes_dot_stuffing() {
        let raw = "primera\n..escaped\n.ultima\n.\n";
        let mut reader = BufReader::new(raw.as_bytes());
        let lines = read_response_lines(&mut reader).unwrap();
        assert_eq!(lines, vec!["primera", ".escaped", "ultima"]);
    }
}