import { invoke, isTauri } from '@tauri-apps/api/core';

export type CredentialBackend = 'windows-credential-manager' | 'linux-secret-service';
export interface CredentialStatus { backend: CredentialBackend | 'unsupported'; available: boolean; message: string | null; }

export async function credentialBackendStatus(): Promise<CredentialStatus | null> {
  if (!isTauri()) return null;
  return invoke<CredentialStatus>('credential_backend_status');
}

/** Sends a secret straight to the native keyring command; never persist it in browser storage. */
export async function saveCredential(accountId: string, secret: string): Promise<void> {
  if (!isTauri()) throw new Error('El almacén seguro solo está disponible en la aplicación de escritorio.');
  await invoke('save_credential', { accountId, secret });
}

export async function deleteCredential(accountId: string): Promise<void> {
  if (!isTauri()) throw new Error('El almacén seguro solo está disponible en la aplicación de escritorio.');
  await invoke('delete_credential', { accountId });
}
