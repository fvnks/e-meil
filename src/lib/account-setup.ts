import type { AccountSetup, MailProvider, ServerSettings } from './types';

const secure = (host: string, port: number): ServerSettings => ({ host, port, security: 'tls', username: '' });

export function validateServerSettings(settings: ServerSettings, label: string): string | null {
  if (!settings.host.trim()) return `Indica el servidor de ${label}.`;
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) return `El puerto de ${label} debe estar entre 1 y 65535.`;
  if (!settings.username.trim()) return `Indica el usuario para ${label}.`;
  return null;
}

export function initialSetup(provider: MailProvider): AccountSetup {
  if (provider === 'microsoft-graph') {
    return {
      displayName: '', emailAddress: '', provider, auth: 'oauth',
      incoming: secure('graph.microsoft.com', 443),
    };
  }
  return {
    displayName: '', emailAddress: '', provider, auth: 'password',
    incoming: secure('', provider === 'imap' ? 993 : 995),
    outgoing: secure('', 465),
  };
}

/** Convenience defaults only. Providers frequently disable password auth; prefer OAuth/app-password policies. */
export function suggestCommonServer(emailAddress: string, provider: 'imap' | 'pop3') {
  const domain = emailAddress.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  if (domain === 'gmail.com') return provider === 'imap'
    ? { incomingHost: 'imap.gmail.com', incomingPort: 993, outgoingHost: 'smtp.gmail.com', outgoingPort: 465 }
    : { incomingHost: 'pop.gmail.com', incomingPort: 995, outgoingHost: 'smtp.gmail.com', outgoingPort: 465 };
  if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com') return provider === 'imap'
    ? { incomingHost: 'outlook.office365.com', incomingPort: 993, outgoingHost: 'smtp-mail.outlook.com', outgoingPort: 587 }
    : { incomingHost: 'outlook.office365.com', incomingPort: 995, outgoingHost: 'smtp-mail.outlook.com', outgoingPort: 587 };
  return null;
}
