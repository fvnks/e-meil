import { invoke, isTauri } from '@tauri-apps/api/core';

export interface GraphMessage { id: string; subject: string; sender: string; preview: string; body: string | null; receivedAt: string | null; isRead: boolean; hasAttachments: boolean; }
export interface GraphSendAttachment { path: string; filename: string; contentType: string; }
export async function listGraphMessages(accountId: string, clientId: string, tenant = 'common', top = 30, search?: string): Promise<GraphMessage[]> { if (!isTauri()) throw new Error('Microsoft Graph requiere la aplicación de escritorio.'); return invoke<GraphMessage[]>('list_graph_messages', { accountId, clientId, tenant, top, search: search ?? null }); }
export async function markGraphMessage(accountId: string, messageId: string, read: boolean): Promise<void> { await invoke('mark_graph_message', { accountId, messageId, read }); }
export async function archiveGraphMessage(accountId: string, messageId: string): Promise<void> { await invoke('archive_graph_message', { accountId, messageId }); }
export async function deleteGraphMessage(accountId: string, messageId: string): Promise<void> { await invoke('delete_graph_message', { accountId, messageId }); }
export async function sendGraphMessage(input: { accountId: string; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; attachments: GraphSendAttachment[] }): Promise<void> { if (!isTauri()) throw new Error('Microsoft Graph requiere la aplicación de escritorio.'); await invoke('send_graph_message', { input }); }
export async function createGraphDraft(input: { accountId: string; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; attachments: GraphSendAttachment[] }): Promise<void> { if (!isTauri()) throw new Error('Microsoft Graph requiere la aplicación de escritorio.'); await invoke('create_graph_draft', { input }); }
