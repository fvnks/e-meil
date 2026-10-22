/** Modelos compartidos entre UI y adaptadores de correo. */
export type MailProvider = 'microsoft-graph' | 'imap' | 'pop3';

export interface MailAccount {
  id: string;
  displayName: string;
  emailAddress: string;
  provider: MailProvider;
  connected: boolean;
}

export interface ServerSettings {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  username: string;
}

export interface AccountSetup {
  displayName: string;
  emailAddress: string;
  provider: MailProvider;
  incoming: ServerSettings;
  outgoing?: ServerSettings;
  auth: 'oauth' | 'password';
  /** UI-only state. Secret persistence must be done in Rust's OS keychain layer. */
  secret?: string;
}

export interface MailFolder {
  id: string;
  accountId: string;
  name: string;
  kind: 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'junk' | 'custom';
  unreadCount: number;
}

export interface MailMessage {
  id: string;
  accountId: string;
  folderId: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  preview: string;
  receivedAt: string;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
}

/** Provider-independent seam for future Graph, IMAP and POP3 implementations. */
export interface MailRepository {
  listAccounts(): Promise<MailAccount[]>;
  listFolders(accountId: string): Promise<MailFolder[]>;
  listMessages(folderId: string, query?: string): Promise<MailMessage[]>;
  markRead(messageId: string, read: boolean): Promise<void>;
  setStarred(messageId: string, starred: boolean): Promise<void>;
}

/** Calendar models */
export interface CalendarAccount {
  id: string;
  displayName: string;
  provider: 'caldav' | 'microsoft-graph' | 'local';
  connected: boolean;
  url?: string; // CalDAV URL
}

export interface CalendarEvent {
  id: string;
  accountId: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string; // ISO 8601
  endAt: string; // ISO 8601
  allDay: boolean;
  recurrenceRule?: string; // RRULE
  reminders: EventReminder[];
  color?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventReminder {
  minutesBefore: number;
  type: 'popup' | 'email';
}

export interface CalendarCalendar {
  id: string;
  accountId: string;
  name: string;
  color: string;
  isPrimary: boolean;
  readOnly: boolean;
}

/** Contacts models */
export interface ContactAccount {
  id: string;
  displayName: string;
  provider: 'carddav' | 'microsoft-graph' | 'local';
  connected: boolean;
  url?: string; // CardDAV URL
}

export interface Contact {
  id: string;
  accountId: string;
  addressBookId: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  emailAddresses: ContactEmail[];
  phoneNumbers: ContactPhone[];
  addresses: ContactAddress[];
  organization?: string;
  title?: string;
  birthday?: string; // YYYY-MM-DD
  notes?: string;
  photo?: string; // base64 data URL
  createdAt?: string;
  updatedAt?: string;
}

export interface ContactEmail {
  address: string;
  type: 'home' | 'work' | 'other';
  primary: boolean;
}

export interface ContactPhone {
  number: string;
  type: 'mobile' | 'home' | 'work' | 'fax' | 'other';
}

export interface ContactAddress {
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  type: 'home' | 'work' | 'other';
}

export interface AddressBook {
  id: string;
  accountId: string;
  name: string;
  isPrimary: boolean;
  readOnly: boolean;
}
