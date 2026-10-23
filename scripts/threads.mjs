/**
 * Hilos de conversación (sesión 19): Rust expone message_id/in_reply_to
 * del ENVELOPE y Graph conversationId, para agrupar en el frontend.
 * Uso: node scripts/threads.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const report = [];
const ok = (l) => report.push('OK   ' + l);
const miss = (l) => report.push('MISS ' + l);

// ========== 1. imap_client.rs ==========
let imap = readFileSync('src-tauri/src/imap_client.rs', 'utf8');

// 1a. Agregar message_id/in_reply_to al struct ImapMessage
const msgStructOld = 'pub struct ImapMessage { pub uid: u32, pub subject: String, pub from: String, pub received_at: Option<String>, pub preview: String, pub unread: bool, pub has_attachments: bool, }';
const msgStructNew = 'pub struct ImapMessage { pub uid: u32, pub subject: String, pub from: String, pub received_at: Option<String>, pub preview: String, pub unread: bool, pub has_attachments: bool, pub message_id: Option<String>, pub in_reply_to: Option<String>, }';
imap.includes(msgStructOld) ? (imap = imap.split(msgStructOld).join(msgStructNew), ok('ImapMessage struct')) : miss('ImapMessage struct');

// 1b. En list_imap_messages: extraer del ENVELOPE (la consulta ya trae ENVELOPE)
const listQueryOld = '"UID FLAGS ENVELOPE BODY.PEEK[TEXT]<0.600>"';
const listQueryNew = '"UID FLAGS ENVELOPE BODY.PEEK[TEXT]<0.600>"';
// La consulta ya incluye ENVELOPE, solo extraer los campos.

// Buscar la construcción de ImapMessage en list_imap_messages
const listBuildOld = 'messages.push(ImapMessage { uid, subject, from, received_at: None, preview, unread: !seen, has_attachments: false });';
const listBuildNew = 'messages.push(ImapMessage { uid, subject, from, received_at: None, preview, unread: !seen, has_attachments: false, message_id: envelope.and_then(|e| e.message_id.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()), in_reply_to: envelope.and_then(|e| e.in_reply_to.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()) });';
imap.includes(listBuildOld) ? (imap = imap.split(listBuildOld).join(listBuildNew), ok('list_imap_messages build')) : miss('list_imap_messages build');

// 1c. En search_imap_messages: igual
const searchBuildOld = 'messages.push(ImapMessage { uid: fetch.uid.unwrap_or_default(), subject, from, received_at: None, preview, unread: !seen, has_attachments: false });';
const searchBuildNew = 'messages.push(ImapMessage { uid: fetch.uid.unwrap_or_default(), subject, from, received_at: None, preview, unread: !seen, has_attachments: false, message_id: envelope.and_then(|e| e.message_id.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()), in_reply_to: envelope.and_then(|e| e.in_reply_to.as_ref()).map(|id| String::from_utf8_lossy(id).trim().to_string()) });';
imap.includes(searchBuildOld) ? (imap = imap.split(searchBuildOld).join(searchBuildNew), ok('search_imap_messages build')) : miss('search_imap_messages build');

// 1d. En list_imap_messages_incremental: igual
const incBuildOld = 'messages.push(ImapMessage { uid: fetch.uid.unwrap_or_default(), subject, from, received_at: None, preview, unread: !seen, has_attachments: false });';
// NOTE: this is the same pattern as search; check if there's a third occurrence
const incCount = (imap.match(new RegExp(listBuildOld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
if (incCount > 1) {
  // Replace all remaining occurrences
  imap = imap.split(listBuildOld).join(listBuildNew);
  ok('build occurrences replaced (' + incCount + 'x)');
} else {
  ok('build occurrences: single (already handled)');
}

writeFileSync('src-tauri/src/imap_client.rs', imap);

// ========== 2. graph.rs ==========
let graph = readFileSync('src-tauri/src/graph.rs', 'utf8');

// 2a. conversationId en select
const selectOld = '"id,subject,bodyPreview,body,isRead,hasAttachments,receivedDateTime,from,toRecipients"';
const selectNew = '"id,subject,bodyPreview,body,isRead,hasAttachments,receivedDateTime,from,toRecipients,conversationId"';
graph.includes(selectOld) ? (graph = graph.split(selectOld).join(selectNew), ok('graph select conversationId')) : miss('graph select');

// 2b. GraphRawMessage: agregar conversation_id
const rawMsgOld = '#[serde(rename = "toRecipients")] to_recipients: Option<Vec<GraphRecipientList>> }';
const rawMsgNew = '#[serde(rename = "toRecipients")] to_recipients: Option<Vec<GraphRecipientList>>, #[serde(rename = "conversationId")] conversation_id: Option<String> }';
graph.includes(rawMsgOld) ? (graph = graph.split(rawMsgOld).join(rawMsgNew), ok('GraphRawMessage conversationId')) : miss('GraphRawMessage');

// 2c. GraphMessage: agregar conversation_id
const gmOld = 'pub struct GraphMessage { pub id: String, pub subject: String, pub sender: String, pub preview: String, pub body: Option<String>, pub received_at: Option<String>, pub is_read: bool, pub has_attachments: bool, pub to_recipients: Option<String> }';
const gmNew = 'pub struct GraphMessage { pub id: String, pub subject: String, pub sender: String, pub preview: String, pub body: Option<String>, pub received_at: Option<String>, pub is_read: bool, pub has_attachments: bool, pub to_recipients: Option<String>, pub conversation_id: Option<String> }';
graph.includes(gmOld) ? (graph = graph.split(gmOld).join(gmNew), ok('GraphMessage conversationId')) : miss('GraphMessage');

// 2d. Mapeo: agregar conversation_id
const mapOld = 'to_recipients: message.to_recipients.map(|recipients| recipients.iter().filter_map(|recipient| recipient.email_address.as_ref().and_then(|address| address.address.clone())).collect::<Vec<_>>().join(", ")).filter(|joined| !joined.is_empty()) }';
const mapNew = 'to_recipients: message.to_recipients.map(|recipients| recipients.iter().filter_map(|recipient| recipient.email_address.as_ref().and_then(|address| address.address.clone())).collect::<Vec<_>>().join(", ")).filter(|joined| !joined.is_empty()), conversation_id: message.conversation_id }';
graph.includes(mapOld) ? (graph = graph.split(mapOld).join(mapNew), ok('graph map conversationId')) : miss('graph map');

writeFileSync('src-tauri/src/graph.rs', graph);

// ========== 3. Puentes de tipos ==========
let imapTs = readFileSync('src/lib/imap.ts', 'utf8');
const imapTsOld = 'export interface ImapMessage { uid: number; subject: string; from: string; receivedAt: string | null; preview: string; unread: boolean; hasAttachments: boolean; }';
const imapTsNew = 'export interface ImapMessage { uid: number; subject: string; from: string; receivedAt: string | null; preview: string; unread: boolean; hasAttachments: boolean; messageId: string | null; inReplyTo: string | null; }';
imapTs.includes(imapTsOld) ? (imapTs = imapTs.split(imapTsOld).join(imapTsNew), ok('imap.ts ImapMessage')) : miss('imap.ts ImapMessage');
writeFileSync('src/lib/imap.ts', imapTs);

let graphTs = readFileSync('src/lib/graph.ts', 'utf8');
const graphTsOld = 'export interface GraphMessage { id: string; subject: string; sender: string; preview: string; body: string | null; receivedAt: string | null; isRead: boolean; hasAttachments: boolean; toRecipients: string | null; }';
const graphTsNew = 'export interface GraphMessage { id: string; subject: string; sender: string; preview: string; body: string | null; receivedAt: string | null; isRead: boolean; hasAttachments: boolean; toRecipients: string | null; conversationId: string | null; }';
graphTs.includes(graphTsOld) ? (graphTs = graphTs.split(graphTsOld).join(graphTsNew), ok('graph.ts GraphMessage')) : miss('graph.ts GraphMessage');
writeFileSync('src/lib/graph.ts', graphTs);

console.log(report.join('\n'));
