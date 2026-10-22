import { invoke, isTauri } from '@tauri-apps/api/core';

export interface Pop3ConnectionResult { ok: boolean; message: string; }
export interface Pop3Message { uidl: string; subject: string; from: string; receivedAt: string | null; preview: string; size: number; hasAttachments: boolean; }
export interface Pop3MessageContent { uidl: string; subject: string; from: string; receivedAt: string | null; text: string; hasAttachments: boolean; size: number; }

export async function testPop3Connection(input: { accountId: string; host: string; port: number; security: string; username: string; }): Promise<Pop3ConnectionResult> { if (!isTauri()) throw new Error('La prueba POP3 solo está disponible en la aplicación de escritorio.'); return invoke('test_pop3_connection', input); }
export async function listPop3Messages(input: { accountId: string; host: string; port: number; security: string; username: string; limit?: number; }): Promise<Pop3Message[]> { if (!isTauri()) throw new Error('POP3 requiere la aplicación de escritorio.'); return invoke('list_pop3_messages', { ...input, limit: input.limit ?? 30 }); }
export async function readPop3Message(input: { accountId: string; host: string; port: number; security: string; username: string; uidl: string; }): Promise<Pop3MessageContent> { if (!isTauri()) throw new Error('POP3 requiere la aplicación de escritorio.'); return invoke('read_pop3_message', input); }
export async function deletePop3Message(input: { accountId: string; host: string; port: number; security: string; username: string; uidl: string; }): Promise<void> { if (!isTauri()) throw new Error('POP3 requiere la aplicación de escritorio.'); await invoke('delete_pop3_message', input); }