import { invoke, isTauri } from '@tauri-apps/api/core';

export interface ImapConnectionResult { ok: boolean; mailboxCount: number | null; message: string; }
export interface ImapFolder { name: string; delimiter: string | null; flags: string[]; specialUse: string | null; }
export interface ImapAttachment { part: string; filename: string; contentType: string; size: number | null; }
export interface ImapMessage { uid: number; subject: string; from: string; receivedAt: string | null; preview: string; unread: boolean; hasAttachments: boolean; }
export interface ImapMessageContent { uid: number; subject: string; from: string; toRecipients: string | null; ccRecipients: string | null; receivedAt: string | null; text: string; hasAttachments: boolean; attachments: ImapAttachment[]; }

function requireDesktop() { if (!isTauri()) throw new Error('Esta operación IMAP solo está disponible en la aplicación de escritorio.'); }
export async function testImapConnection(input: { accountId: string; host: string; port: number; security: string; username: string; }): Promise<ImapConnectionResult> { requireDesktop(); return invoke('test_imap_connection', input); }
export async function listImapFolders(input: { accountId: string; host: string; port: number; security: string; username: string; }): Promise<ImapFolder[]> { requireDesktop(); return invoke('list_imap_folders', input); }
export async function listImapMessages(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; limit?: number; }): Promise<ImapMessage[]> { requireDesktop(); return invoke('list_imap_messages', { ...input, limit: input.limit ?? 30 }); }
export async function listImapMessagesIncremental(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; afterUid: number; limit?: number; }): Promise<ImapMessage[]> { requireDesktop(); return invoke('list_imap_messages_incremental', { ...input, afterUid: input.afterUid, limit: input.limit ?? 30 }); }
export async function readImapMessage(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; uid: number; }): Promise<ImapMessageContent> { requireDesktop(); return invoke('read_imap_message', input); }
export async function setImapSeen(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; uid: number; seen: boolean }): Promise<void> { requireDesktop(); await invoke('set_imap_seen', input); }
export async function moveImapMessage(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; destination: string; uid: number }): Promise<void> { requireDesktop(); await invoke('move_imap_message', input); }
export async function deleteImapMessage(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; uid: number }): Promise<void> { requireDesktop(); await invoke('delete_imap_message', input); }
export async function downloadImapAttachment(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; uid: number; part: string; filename: string; destination: string }): Promise<string> { requireDesktop(); return invoke('download_imap_attachment', input); }
export async function searchImapMessages(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; query: string }): Promise<ImapMessage[]> { requireDesktop(); return invoke('search_imap_messages', input); }
export async function saveImapDraft(input: { accountId: string; host: string; port: number; security: string; username: string; mailbox: string; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string }): Promise<void> { requireDesktop(); await invoke('save_imap_draft', input); }
