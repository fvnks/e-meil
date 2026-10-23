import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AccountSetup } from './types';

export interface AccountRecord {
  id: string;
  displayName: string;
  emailAddress: string;
  provider: string;
  incomingHost: string;
  incomingPort: number;
  incomingSecurity: string;
  incomingUsername: string;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecurity: string;
  outgoingUsername: string;
  auth: string;
  oauthClientId?: string;
  oauthTenant?: string;
}

export async function listAccounts(): Promise<AccountRecord[]> {
  if (!isTauri()) return [];
  return invoke<AccountRecord[]>('list_accounts');
}

export async function saveMicrosoftAccount(input: { emailAddress: string; displayName: string; clientId: string; tenant: string }): Promise<void> {
  if (!isTauri()) throw new Error('La persistencia de cuentas solo está disponible en escritorio.');
  await invoke('save_account', { account: {
    id: input.emailAddress.trim().toLowerCase(),
    displayName: input.displayName || input.emailAddress,
    emailAddress: input.emailAddress,
    provider: 'microsoft-graph',
    incomingHost: 'graph.microsoft.com',
    incomingPort: 443,
    incomingSecurity: 'oauth',
    incomingUsername: input.emailAddress,
    outgoingHost: 'graph.microsoft.com',
    outgoingPort: 443,
    outgoingSecurity: 'oauth',
    outgoingUsername: input.emailAddress,
    auth: 'oauth',
    oauthClientId: input.clientId,
    oauthTenant: input.tenant,
  } satisfies AccountRecord });
}
export async function saveGoogleAccount(input: { emailAddress: string; displayName?: string }): Promise<void> {
  if (!isTauri()) throw new Error('La persistencia de cuentas solo está disponible en escritorio.');
  const email = input.emailAddress.trim();
  if (!email) throw new Error('Falta el correo de la cuenta de Google.');
  await invoke('save_account', { account: {
    // El prefijo google: es el interruptor de XOAUTH2 en IMAP/SMTP; los hosts
    // de Google son fijos (TLS 993 y 465).
    id: `google:${email}`,
    displayName: input.displayName?.trim() || 'Gmail',
    emailAddress: email,
    provider: 'imap',
    incomingHost: 'imap.gmail.com',
    incomingPort: 993,
    incomingSecurity: 'tls',
    incomingUsername: email,
    outgoingHost: 'smtp.gmail.com',
    outgoingPort: 465,
    outgoingSecurity: 'tls',
    outgoingUsername: email,
    auth: 'oauth',
    oauthClientId: undefined,
    oauthTenant: undefined,
  } satisfies AccountRecord });
}

export async function saveAccountMetadata(setup: AccountSetup): Promise<void> {
  if (!isTauri()) throw new Error('La persistencia de cuentas solo está disponible en escritorio.');
  await invoke('save_account', { account: {
    id: setup.emailAddress.trim().toLowerCase(),
    displayName: setup.displayName || setup.emailAddress,
    emailAddress: setup.emailAddress,
    provider: setup.provider,
    incomingHost: setup.incoming.host,
    incomingPort: setup.incoming.port,
    incomingSecurity: setup.incoming.security,
    incomingUsername: setup.incoming.username || setup.emailAddress,
    outgoingHost: setup.outgoing?.host ?? '',
    outgoingPort: setup.outgoing?.port ?? 0,
    outgoingSecurity: setup.outgoing?.security ?? 'tls',
    outgoingUsername: setup.outgoing?.username ?? setup.emailAddress,
    auth: setup.auth,
     oauthClientId: setup.provider === 'microsoft-graph' ? undefined : undefined,
     oauthTenant: setup.provider === 'microsoft-graph' ? 'common' : undefined,
  } satisfies AccountRecord });
}

export async function deleteAccount(accountId: string): Promise<void> {
  if (!isTauri()) throw new Error('La persistencia de cuentas solo está disponible en escritorio.');
  await invoke('delete_account', { accountId });
}
