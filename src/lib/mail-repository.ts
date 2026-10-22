export type MailProviderKind = 'imap' | 'microsoft-graph';

export interface UnifiedMessage {
  id: string;
  accountId: string;
  provider: MailProviderKind;
  mailbox: string;
  subject: string;
  sender: string;
  preview: string;
  receivedAt: string | null;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
}

export interface MailRepository {
  listMessages(mailbox?: string, limit?: number): Promise<UnifiedMessage[]>;
  markRead?(message: UnifiedMessage, read: boolean): Promise<void>;
  archive?(message: UnifiedMessage): Promise<void>;
  remove?(message: UnifiedMessage): Promise<void>;
}
