import { invoke, isTauri } from '@tauri-apps/api/core';

export interface CachedMessage {
  accountId: string; mailbox: string; uid: number; subject: string; from: string;
  receivedAt: string | null; preview: string; text: string | null; unread: boolean;
  starred: boolean; hasAttachments: boolean; cachedAt: string;
}

export async function listCachedMessages(accountId: string, mailbox: string): Promise<CachedMessage[]> {
  if (!isTauri()) return [];
  return invoke<CachedMessage[]>('list_cached_messages', { accountId, mailbox });
}
export async function upsertCachedMessages(messages: CachedMessage[]): Promise<void> {
  if (!isTauri() || !messages.length) return;
  await invoke('upsert_cached_messages', { incoming: messages });
}
export async function updateCachedMessageState(input: { accountId: string; mailbox: string; uid: number; unread?: boolean; starred?: boolean }): Promise<void> {
  if (!isTauri()) return;
  await invoke('update_cached_message_state', input);
}
