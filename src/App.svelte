<script lang="ts">
  import { tick } from 'svelte';
  import { initialSetup, suggestCommonServer, validateServerSettings } from './lib/account-setup';
  import type { AccountSetup, MailProvider, CalendarEvent, CalendarCalendar, Contact, AddressBook, CalendarAccount, ContactAccount, EventReminder, ContactEmail, ContactPhone, ContactAddress } from './lib/types';
  import { credentialBackendStatus, saveCredential } from './lib/credentials';
  import { listAccounts, saveAccountMetadata, saveMicrosoftAccount } from './lib/accounts';
  import { deleteImapMessage, downloadImapAttachment, listImapFolders, listImapMessages, listImapMessagesIncremental, moveImapMessage, readImapMessage, setImapSeen, testImapConnection } from './lib/imap';
  import type { ImapMessageContent } from './lib/imap';
  import type { AccountRecord } from './lib/accounts';
import { deletePop3Message, listPop3Messages, readPop3Message, testPop3Connection } from './lib/pop3';
  import { listCachedMessages, updateCachedMessageState, upsertCachedMessages } from './lib/cache';
  import type { CachedMessage } from './lib/cache';
  import { startMicrosoftOAuth, waitForMicrosoftAuthorization } from './lib/oauth';
import { initLocale, t } from './lib/i18n';
  import { inspectAttachment, sendSmtpMail } from './lib/smtp';
  import { archiveGraphMessage, deleteGraphMessage, listGraphMessages, markGraphMessage, sendGraphMessage } from './lib/graph';
  import type { UnifiedMessage } from './lib/mail-repository';
  import { open } from '@tauri-apps/plugin-dialog';
  import Modal from './lib/Modal.svelte';
  import { tooltip } from './lib/tooltip';
  type Mail = { sender: string; address: string; subject: string; preview: string; time: string; initials: string; color: string; unread?: boolean; starred?: boolean; tag?: string; mailbox?: string; hasAttachments?: boolean; uid?: number | string; id?: string };
  let selected = $state(0);
  let currentFolder = $state('Bandeja de entrada');
  let search = $state('');
  let filterUnread = $state(false);
  let filterHasAttachments = $state(false);
  let filterMenuOpen = $state(false);
  let selectionMode = $state(false);
  let selectedUids = $state<Set<number | string>>(new Set());
  let contactSearch = $state('');
  let composeOpen = $state(false);
  let composeTo = $state('');
  let composeSubject = $state('');
  let composeHtml = $state('<p></p>');
  let composeAttachments = $state<{ name: string; size: number; type: string; path: string }[]>([]);
  let composeCc = $state('');
  let composeBcc = $state('');
  let signature = $state((typeof localStorage !== 'undefined' && localStorage.getItem('emeil-signature')) || 'Saludos,\n\nCamila González\nEstudio Co.');
  let showCcBcc = $state(false);
  let composeNotice = $state('');
  let sending = $state(false);
  function openCompose() { composeOpen = true; composeNotice = ''; composeTo = ''; composeCc = ''; composeBcc = ''; composeSubject = ''; composeAttachments = []; showCcBcc = false; const saved = localStorage.getItem('emeil-draft'); if (saved) { try { const draft = JSON.parse(saved); composeTo = draft.to || ''; composeCc = draft.cc || ''; composeBcc = draft.bcc || ''; composeSubject = draft.subject || ''; composeHtml = draft.html || `<p><br></p><p>${signature.replace(/\n/g, '<br>')}</p>`; composeAttachments = draft.attachments || []; composeNotice = 'Borrador recuperado automáticamente.'; return; } catch { localStorage.removeItem('emeil-draft'); } } composeHtml = `<p><br></p><p>${signature.replace(/\n/g, '<br>')}</p>`; }
  function execFormat(command: string, value?: string) { document.execCommand(command, false, value); }
  function cleanComposeHtml(html: string) { return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on\w+=("[^"]*"|'[^']*')/gi, '').replace(/<(iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, ''); }
  function extractEmailAddress(value: string) { const angled = value.match(/<([^>]+)>/); if (angled) return angled[1].trim(); const bare = value.match(/[^\s,;<>"]+@[^\s,;<>"]+/); return bare ? bare[0].trim() : value.trim(); }
  function stripHtmlToText(html: string) { const doc = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ''); const t = document.createElement('textarea'); t.innerHTML = doc; return t.value.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(); }
  function escapeForHtml(text: string) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function buildQuoteHeader(from: string, dateStr: string) { return `<p class="quote-header">El ${escapeForHtml(dateStr)}, ${escapeForHtml(from)} escribió:</p>`; }
  function buildQuoteBody(source: string) { const text = stripHtmlToText(source).slice(0, 2000); return `<blockquote class="original-quote">${escapeForHtml(text).replace(/\n/g, '<br>') || '(sin contenido)'}</blockquote>`; }
  function openReply(mode: 'imap' | 'graph') { openCompose(); const source = mode === 'imap' ? activeRealMessage : activeGraphMessage; if (!source) return; const from = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).from : (source as import('./lib/graph').GraphMessage).sender; composeTo = extractEmailAddress(from); composeSubject = /^re\s*:/i.test(source.subject) ? source.subject : `Re: ${source.subject}`; const dateStr = mode === 'imap' ? ((source as import('./lib/imap').ImapMessageContent).receivedAt ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date((source as import('./lib/imap').ImapMessageContent).receivedAt!)) : 'fecha desconocida') : ((source as import('./lib/graph').GraphMessage).receivedAt ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date((source as import('./lib/graph').GraphMessage).receivedAt!)) : 'fecha desconocida'); const body = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).text : ((source as import('./lib/graph').GraphMessage).body || (source as import('./lib/graph').GraphMessage).preview || ''); composeHtml = `<p><br></p>${buildQuoteHeader(from, dateStr)}${buildQuoteBody(body)}`; composeNotice = `Respondiendo a ${from}`; }
  function openForward(mode: 'imap' | 'graph') { openCompose(); const source = mode === 'imap' ? activeRealMessage : activeGraphMessage; if (!source) return; const from = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).from : (source as import('./lib/graph').GraphMessage).sender; const dateStr = mode === 'imap' ? ((source as import('./lib/imap').ImapMessageContent).receivedAt || '') : ((source as import('./lib/graph').GraphMessage).receivedAt || ''); const body = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).text : ((source as import('./lib/graph').GraphMessage).body || (source as import('./lib/graph').GraphMessage).preview || ''); composeTo = ''; composeSubject = /^fwd\s*:/i.test(source.subject) || /^reenv/i.test(source.subject) ? source.subject : `Fwd: ${source.subject}`; composeHtml = `<p><br></p><p class="quote-header">---------- Mensaje reenviado ----------<br>De: ${escapeForHtml(from)}<br>Asunto: ${escapeForHtml(source.subject)}<br>Fecha: ${escapeForHtml(dateStr)}</p>${buildQuoteBody(body)}`; composeNotice = `Reenviando: ${source.subject}`; }
  function handlePaste(event: ClipboardEvent) { event.preventDefault(); const text = event.clipboardData?.getData('text/plain') || ''; document.execCommand('insertText', false, text); }
  async function addAttachments() { const selected = await open({ multiple: true, directory: false, filters: [{ name: 'Archivos', extensions: ['*'] }] }); const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []; const inspected = []; for (const path of paths) { try { const info = await inspectAttachment(path); inspected.push({ name: info.name, size: info.size, type: info.contentType, path }); } catch (error) { composeNotice = String(error); } } composeAttachments = [...composeAttachments, ...inspected].slice(0, 10); }
  function removeAttachment(name: string) { composeAttachments = composeAttachments.filter((item) => item.name !== name); }
  function formatBytes(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  function saveDraft() { localStorage.setItem('emeil-draft', JSON.stringify({ to: composeTo, cc: composeCc, bcc: composeBcc, subject: composeSubject, html: composeHtml, attachments: composeAttachments })); composeNotice = 'Borrador guardado en este dispositivo.'; }

  let contextMenu = $state<{ x: number; y: number; kind: 'message' | 'empty'; uid?: number } | null>(null);
  async function openContextMenu(event: MouseEvent, uid?: number) {
    event.preventDefault();
    contextMenu = { x: Math.min(event.clientX, window.innerWidth - 225), y: Math.min(event.clientY, window.innerHeight - 220), kind: uid ? 'message' : 'empty', uid };
    // Patrón APG de menú: al abrirse, el foco entra en el primer elemento.
    await tick();
    document.querySelector<HTMLButtonElement>('.context-menu [role="menuitem"]')?.focus();
  }
  function closeContextMenu() { contextMenu = null; }
  // Navegación por teclado del menú contextual (patrón APG role="menu").
  function handleMenuKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]'));
    if (!items.length) return;
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0].focus(); }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1].focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); closeContextMenu(); }
    else if (event.key === 'Tab') { closeContextMenu(); }
  }
  // Escape cierra el popup más alto de la pila; los modales (Modal.svelte) lo
  // gestionan por sí mismos con su propio detector en fase de captura.
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (contextMenu) contextMenu = null;
    else if (themeOpen) themeOpen = false;
    else if (filterMenuOpen) filterMenuOpen = false;
    else if (drawerOpen) drawerOpen = false;
  }
  function contextAction(action: 'open' | 'read' | 'star' | 'delete' | 'compose') { if (action === 'compose') { openCompose(); } const mail = contextMenu?.uid ? syncedMessages.find((item) => item.uid === contextMenu?.uid) : undefined; if (mail && action === 'open') openRealMessage(mail); if (mail && action === 'read') toggleCachedState(mail, 'unread'); if (mail && action === 'star') toggleCachedState(mail, 'starred'); if (mail && action === 'delete') remoteAction('delete', mail); contextMenu = null; }
  let sent = $state(false);
  let setupOpen = $state(false);
  let setupStep = $state<'provider' | 'details'>('provider');
  let setup: AccountSetup = $state(initialSetup('microsoft-graph'));
  let setupError = $state('');
  let setupInfo = $state('');
  let microsoftClientId = $state('');
  let oauthBusy = $state(false);
  let oauthState = $state('');
  let testingConnection = $state(false);
  let syncing = $state(false);
  let syncMessage = $state('');
  let syncedFolders = $state<{ name: string; delimiter: string | null; flags: string[]; specialUse: string | null }[]>([]);
  let archiveFolder = $state('Archive');
  let sentFolder = $state<string | null>(null);
  let draftsFolder = $state<string | null>(null);
  let syncedMessages = $state<CachedMessage[]>([]);
  let unifiedMessages = $state<UnifiedMessage[]>([]);
  let activeProvider = $state<'imap' | 'pop3' | 'microsoft-graph'>('imap');
  let selectedMailbox = $state('INBOX');
  let activeRealMessage = $state<ImapMessageContent | null>(null);
  let activeGraphMessage = $state<import('./lib/graph').GraphMessage | null>(null);
  let activeContentMode = $state<'text' | 'html-blocked'>('text');
  let loadingMessage = $state(false);

  // Estado responsive: drawer de carpetas y panel de lectura a pantalla completa.
  let drawerOpen = $state(false);
  let mobileReadingOpen = $state(false);

  // Calendar & Contacts state
  let activeView = $state<'mail' | 'calendar' | 'contacts'>('mail');

  // En móvil: al cambiar de vista o carpeta se cierra el drawer de carpetas y
  // el panel de lectura a pantalla completa vuelve a la lista.
  $effect(() => { void activeView; void selectedMailbox; drawerOpen = false; });
  $effect(() => { void currentFolder; mobileReadingOpen = false; });
  let calendarEvents = $state<CalendarEvent[]>([]);
  let calendars = $state<CalendarCalendar[]>([]);
  let calendarAccounts = $state<CalendarAccount[]>([]);
  let contacts = $state<Contact[]>([]);
  let addressBooks = $state<AddressBook[]>([]);
  let contactAccounts = $state<ContactAccount[]>([]);
  let selectedDate = $state(new Date().toISOString().split('T')[0]);
  let calendarView = $state<'month' | 'week' | 'day'>('month');
  let selectedEvent = $state<CalendarEvent | null>(null);
  let selectedContact = $state<Contact | null>(null);
  let eventFormOpen = $state(false);
  let contactFormOpen = $state(false);
  type EventFormState = {
    title: string; description: string; location: string;
    startAt: string; endAt: string; allDay: boolean;
    calendarId: string; color: string; recurrenceRule: string;
    reminders: EventReminder[]; accountId: string;
  };
  type ContactFormState = {
    displayName: string; firstName: string; lastName: string;
    emailAddresses: ContactEmail[]; phoneNumbers: ContactPhone[]; addresses: ContactAddress[];
    organization: string; title: string; birthday: string; notes: string;
    addressBookId: string; accountId: string;
  };
  const emptyEventForm = (): EventFormState => ({
    title: '', description: '', location: '', accountId: '',
    startAt: '', endAt: '', allDay: false,
    calendarId: '', color: '#6557d9',
    recurrenceRule: '', reminders: []
  });
  const emptyContactForm = (): ContactFormState => ({
    displayName: '', firstName: '', lastName: '',
    emailAddresses: [{ address: '', type: 'home', primary: true }],
    phoneNumbers: [{ number: '', type: 'mobile' }],
    addresses: [{ street: '', city: '', region: '', postalCode: '', country: '', type: 'home' }],
    organization: '', title: '', birthday: '', notes: '',
    addressBookId: '', accountId: ''
  });
  let eventForm = $state<EventFormState>({
    title: '', description: '', location: '',
    startAt: '', endAt: '', allDay: false,
    calendarId: '', color: '#6557d9',
    recurrenceRule: '', reminders: [] as EventReminder[],
    accountId: ''
  });
  let contactForm = $state<ContactFormState>({
    displayName: '', firstName: '', lastName: '',
    emailAddresses: [{ address: '', type: 'home', primary: true }] as ContactEmail[],
    phoneNumbers: [{ number: '', type: 'mobile' }] as ContactPhone[],
    addresses: [{ street: '', city: '', region: '', postalCode: '', country: '', type: 'home' }] as ContactAddress[],
    organization: '', title: '',
    birthday: '', notes: '',
    addressBookId: '',
    accountId: ''
  });
  type ThemeName = 'violet' | 'ocean' | 'forest' | 'sunset' | 'graphite';
  const themes: { id: ThemeName; label: string; color: string; description: string }[] = [
    { id: 'violet', label: 'Lavanda', color: '#6557d9', description: 'El tema original de e-Meil' },
    { id: 'ocean', label: 'Océano', color: '#26718c', description: 'Azules serenos y frescos' },
    { id: 'forest', label: 'Bosque', color: '#357a5c', description: 'Verdes suaves y naturales' },
    { id: 'sunset', label: 'Atardecer', color: '#a3523a', description: 'Cálido, expresivo y acogedor' },
    { id: 'graphite', label: 'Grafito', color: '#4e5868', description: 'Neutro y profesional' },
  ];
  let theme = $state<ThemeName>((typeof localStorage !== 'undefined' && (localStorage.getItem('emeil-theme') as ThemeName)) || 'violet');
  let themeOpen = $state(false);
  function initialDarkMode(): boolean {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('emeil-dark-mode');
      if (saved === 'on') return true;
      if (saved === 'off') return false;
    }
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  let dark = $state<boolean>(initialDarkMode());
  function setDark(next: boolean) { dark = next; localStorage.setItem('emeil-dark-mode', next ? 'on' : 'off'); }
  initLocale();
  function setTheme(next: ThemeName) { theme = next; localStorage.setItem('emeil-theme', next); themeOpen = false; }
  let configuredAccounts = $state<{ name: string; email: string; provider: string }[]>([{ name: 'Estudio Co.', email: 'camila@estudio.co', provider: 'MICROSOFT-GRAPH' }]);
  let activeAccount = $state<{ name: string; email: string; provider: string } | null>(null);
  async function loadSavedAccounts() {
    try {
      const saved = await listAccounts();
      if (saved.length) {
        configuredAccounts = saved.map((account) => ({ name: account.displayName, email: account.emailAddress, provider: account.provider.toUpperCase() }));
        const remembered = localStorage.getItem('emeil-active-account');
        activeAccount = configuredAccounts.find((account) => account.email === remembered) ?? configuredAccounts[0];
      }
    } catch { /* The demo remains usable if native persistence is unavailable. */ }
  }
  loadSavedAccounts();
  function selectAccount(account: { name: string; email: string; provider: string }) {
    if (!account || (activeAccount?.email === account.email && activeProvider === (account.provider === 'MICROSOFT-GRAPH' ? 'microsoft-graph' : 'imap'))) return;
    activeAccount = account;
    localStorage.setItem('emeil-active-account', account.email);
    activeProvider = account.provider === 'MICROSOFT-GRAPH' ? 'microsoft-graph' : account.provider === 'POP3' ? 'pop3' : 'imap';
    activeRealMessage = null; activeGraphMessage = null; syncedMessages = []; unifiedMessages = []; selectedMailbox = 'INBOX'; currentFolder = 'Bandeja de entrada'; sentFolder = null; draftsFolder = null;
    if (account.provider === 'MICROSOFT-GRAPH') syncGraphAccount(); else if (account.provider === 'POP3') syncPop3Account(); else syncImapAccount();
  }
  function chooseProvider(provider: MailProvider) { setup = initialSetup(provider); setupStep = 'details'; setupError = ''; setupInfo = ''; }
  function displayTime(date: string | null) { return date ? new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(new Date(date)) : '—'; }
  async function toggleCachedState(mail: CachedMessage, field: 'unread' | 'starred') {
    mail[field] = !mail[field];
    await updateCachedMessageState({ accountId: mail.accountId, mailbox: mail.mailbox, uid: mail.uid, [field]: mail[field] });
  }
  async function batchAction(action: 'archive' | 'delete') {
    if (!activeAccount || selectedUids.size === 0) { syncMessage = 'No hay mensajes seleccionados.'; return; }
    if (action === 'archive' && !confirm(`Archivar ${selectedUids.size} mensajes?`)) return;
    if (action === 'delete' && !confirm(`Eliminar ${selectedUids.size} mensajes?`)) return;
    const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === activeAccount!.email);
    if (!record) { syncMessage = 'No se encontró la configuración de la cuenta.'; return; }
    try {
      if (activeProvider === 'microsoft-graph') {
        for (const uid of selectedUids) {
          const msg = unifiedMessages.find((m) => m.id === uid);
          if (msg) { if (action === 'archive') await archiveGraphMessage(record.id, msg.id); else await deleteGraphMessage(record.id, msg.id); }
        }
        unifiedMessages = unifiedMessages.filter((m) => !selectedUids.has(m.id));
      } else if (activeProvider === 'pop3') {
        if (action === 'archive') { syncMessage = 'POP3 no tiene carpetas: usa Eliminar.'; return; }
        for (const uid of selectedUids) {
          const row = syncedMessages.find((m) => m.uid === uid) as (CachedMessage & { pop3Uidl?: string }) | undefined;
          if (row?.pop3Uidl) await deletePop3Message({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, uidl: row.pop3Uidl });
        }
      } else {
        for (const uid of selectedUids) {
          const mail = syncedMessages.find((m) => m.uid === uid);
          if (mail) {
            const input = { accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: mail.mailbox, uid: mail.uid };
            if (action === 'archive') await moveImapMessage({ ...input, destination: archiveFolder }); else await deleteImapMessage(input);
          }
        }
        syncedMessages = syncedMessages.filter((m) => !selectedUids.has(m.uid));
      }
      selectedUids.clear(); selectionMode = false;
      syncMessage = action === 'archive' ? `Archivados ${selectedUids.size} mensajes.` : `Eliminados ${selectedUids.size} mensajes.`;
    } catch (error) { syncMessage = String(error); }
  }
  async function downloadAttachment(attachment: { part: string; filename: string }) {
    const dangerous = /\.(exe|msi|bat|cmd|com|scr|js|vbs|ps1|sh)$/i.test(attachment.filename);
    if (dangerous && !confirm('Este tipo de archivo puede ejecutarse en tu sistema. ¿Quieres guardarlo igualmente?')) return;
    const destination = prompt('Indica la carpeta de destino (ruta completa):', 'C:\\Users\\Public\\Downloads');
    if (!destination) return;
    const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === activeAccount?.email); const mail = syncedMessages.find((item) => item.uid === activeRealMessage?.uid);
    if (!record || !mail) { syncMessage = 'No se encontró la configuración del mensaje.'; return; }
    try { const path = await downloadImapAttachment({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: mail.mailbox, uid: mail.uid, part: attachment.part, filename: attachment.filename, destination }); syncMessage = `Adjunto guardado en ${path}`; }
    catch (error) { syncMessage = String(error); }
  }
  async function graphAction(action: 'seen' | 'delete' | 'archive', message = activeGraphMessage) { if (!activeAccount || activeProvider !== 'microsoft-graph') { syncMessage = 'Selecciona un mensaje Microsoft primero.'; return; } const account = activeAccount; const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === account.email); if (!record || !message) { syncMessage = 'Selecciona un mensaje Microsoft primero.'; return; } try { if (action === 'seen') await markGraphMessage(record.id, message.id, !message.isRead); if (action === 'delete') await deleteGraphMessage(record.id, message.id); if (action === 'archive') await archiveGraphMessage(record.id, message.id); if (action === 'seen') message.isRead = !message.isRead; else { unifiedMessages = unifiedMessages.filter((item) => item.id !== message.id); activeGraphMessage = null; } syncMessage = action === 'seen' ? 'Estado actualizado.' : action === 'archive' ? 'Mensaje archivado.' : 'Mensaje eliminado.'; } catch (error) { syncMessage = String(error); } }
  async function remoteAction(action: 'seen' | 'delete' | 'archive', mail = syncedMessages.find((item) => item.uid === activeRealMessage?.uid)) {
    if (!activeAccount) { syncMessage = 'Selecciona una cuenta primero.'; return; }
    const account = activeAccount;
    // POP3: sin carpetas ni estado en servidor; "leído" es local y el archivo
    // no está disponible. Eliminar usa DELE + QUIT (confirmado en el servidor).
    if (activeProvider === 'pop3') {
      const pop3Mail = mail as (CachedMessage & { pop3Uidl?: string }) | undefined;
      if (action === 'archive') { syncMessage = 'POP3 no tiene carpetas: usa Eliminar.'; return; }
      if (!pop3Mail?.pop3Uidl) { syncMessage = 'El mensaje ya no está disponible en el servidor.'; return; }
      if (action === 'seen') { pop3Mail.unread = !pop3Mail.unread; await updateCachedMessageState({ accountId: pop3Mail.accountId, mailbox: pop3Mail.mailbox, uid: pop3Mail.uid, unread: pop3Mail.unread }); syncMessage = 'Estado local actualizado (POP3 no sincroniza leído).'; return; }
      const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === account.email);
      if (!record) { syncMessage = 'No se encontró la configuración de la cuenta.'; return; }
      try { await deletePop3Message({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, uidl: pop3Mail.pop3Uidl }); syncedMessages = syncedMessages.filter((item) => item.uid !== pop3Mail.uid); activeRealMessage = null; syncMessage = 'Mensaje eliminado del servidor.'; }
      catch (error) { syncMessage = String(error); }
      return;
    }
    if (activeProvider !== 'imap') { syncMessage = 'Selecciona un mensaje IMAP primero.'; return; }
    const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === account.email);
    if (!record || !mail) { syncMessage = 'Selecciona un mensaje IMAP primero.'; return; }
    try {
      const input = { accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: mail.mailbox, uid: mail.uid };
      if (action === 'seen') { await setImapSeen({ ...input, seen: !mail.unread }); mail.unread = !mail.unread; await updateCachedMessageState({ ...input, unread: mail.unread }); }
      if (action === 'delete') { await deleteImapMessage(input); syncedMessages = syncedMessages.filter((item) => item.uid !== mail.uid); activeRealMessage = null; }
      if (action === 'archive') { await moveImapMessage({ ...input, destination: archiveFolder }); syncedMessages = syncedMessages.filter((item) => item.uid !== mail.uid); activeRealMessage = null; }
      syncMessage = action === 'seen' ? 'Estado actualizado.' : action === 'archive' ? 'Mensaje archivado.' : 'Mensaje eliminado.';
    } catch (error) { syncMessage = String(error); }
  }
  function openGraphMessage(message: import('./lib/graph').GraphMessage) { activeGraphMessage = message; activeRealMessage = null; mobileReadingOpen = true; if (!message.isRead) graphAction('seen', message); }
  async function openRealMessage(mail: { uid: number; subject: string }) {
    // POP3: el UIDL identifica el mensaje; se resuelve el número en el servidor.
    if (activeProvider === 'pop3') {
      if (!activeAccount) { syncMessage = 'Selecciona una cuenta POP3 primero.'; return; }
      const account = activeAccount; const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === account.email);
      const row = syncedMessages.find((item) => item.uid === mail.uid) as (CachedMessage & { pop3Uidl?: string }) | undefined;
      if (!record || !row?.pop3Uidl) { syncMessage = 'El mensaje ya no está disponible en el servidor.'; return; }
      loadingMessage = true; syncMessage = `Abriendo: ${mail.subject}`;
      try {
        const content = await readPop3Message({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, uidl: row.pop3Uidl });
        activeRealMessage = { uid: mail.uid, subject: content.subject || mail.subject, from: content.from || '(remitente desconocido)', receivedAt: content.receivedAt, text: content.text, hasAttachments: false, attachments: [] };
        row.unread = false;
      } catch (error) { syncMessage = String(error); }
      finally { loadingMessage = false; }
      return;
    }
    if (!activeAccount || activeProvider !== 'imap') { syncMessage = 'Selecciona una cuenta IMAP primero.'; return; }
    const account = activeAccount; const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === account.email);
    if (!record) { syncMessage = 'No se encontró la configuración de la cuenta.'; return; }
    loadingMessage = true; syncMessage = `Abriendo: ${mail.subject}`;
    try { activeRealMessage = await readImapMessage({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: selectedMailbox, uid: mail.uid });
      const cached = syncedMessages.find((item) => item.uid === mail.uid);
      if (cached) { cached.text = activeRealMessage.text; cached.unread = false; await updateCachedMessageState({ accountId: cached.accountId, mailbox: cached.mailbox, uid: cached.uid, unread: false }); await upsertCachedMessages([cached]); } }
    catch (error) { syncMessage = String(error); }
    finally { loadingMessage = false; }
  }
  function messageInitials(from: string) { return from.split(/[ @]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'; }
  async function syncGraphAccount() {
    if (!activeAccount || activeProvider !== 'microsoft-graph') { syncMessage = 'Selecciona una cuenta Microsoft primero.'; return; }
    const account = activeAccount; const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === account.email); const clientId = record?.oauthClientId || microsoftClientId; if (!record || !clientId) { syncMessage = 'Autoriza primero una cuenta Microsoft 365.'; return; }
    activeProvider = 'microsoft-graph'; syncing = true; syncMessage = 'Consultando Microsoft Graph…';
    try { const messages = await listGraphMessages(`microsoft:${clientId}`, clientId, 'common', 30); unifiedMessages = messages.map((message) => ({ id: message.id, accountId: record.id, provider: 'microsoft-graph', mailbox: 'INBOX', subject: message.subject, sender: message.sender, preview: message.preview, receivedAt: message.receivedAt, unread: !message.isRead, starred: false, hasAttachments: message.hasAttachments })); syncMessage = `Microsoft Graph: ${unifiedMessages.length} mensajes.`; } catch (error) { syncMessage = String(error); } finally { syncing = false; }
  }
  async function syncImapAccount(mailbox = selectedMailbox) {
    if (!activeAccount || activeProvider !== 'imap') { syncMessage = 'Agrega una cuenta IMAP para sincronizar.'; return; }
    syncing = true; syncMessage = 'Conectando IMAP…';
    try {
      const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === activeAccount!.email);
      if (!record) return;
      const input = { accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername };
      const cached = await listCachedMessages(record.id, mailbox);
      if (cached.length) syncedMessages = cached;
      syncedFolders = await listImapFolders(input);
      archiveFolder = syncedFolders.find((folder) => folder.specialUse === 'Archive')?.name ?? syncedFolders.find((folder) => /archive|archiv/i.test(folder.name))?.name ?? 'Archive';
      sentFolder = syncedFolders.find((folder) => folder.specialUse === 'Sent')?.name ?? syncedFolders.find((folder) => /sent|enviado|gesendet|inviad/i.test(folder.name))?.name ?? null;
      draftsFolder = syncedFolders.find((folder) => folder.specialUse === 'Drafts')?.name ?? syncedFolders.find((folder) => /draft|borrador|entwurf/i.test(folder.name))?.name ?? null;
      if (mailbox === 'SENT') selectedMailbox = sentFolder ?? selectedMailbox;
      const inbox = syncedFolders.find((folder) => folder.name.toLowerCase() === 'inbox') ?? syncedFolders[0];
      selectedMailbox = mailbox === 'INBOX' && inbox ? inbox.name : mailbox;
      if (selectedMailbox) {
        const highestUid = syncedMessages.reduce((max, message) => Math.max(max, message.uid), 0);
        const remoteMessages = highestUid ? await listImapMessagesIncremental({ ...input, mailbox: selectedMailbox, afterUid: highestUid, limit: 30 }) : await listImapMessages({ ...input, mailbox: selectedMailbox, limit: 30 });
        const previous = new Map(syncedMessages.map((message) => [message.uid, message]));
        const fresh = remoteMessages.map((message) => ({ ...message, accountId: record.id, mailbox: selectedMailbox, text: previous.get(message.uid)?.text ?? null, starred: previous.get(message.uid)?.starred ?? false, cachedAt: new Date().toISOString() }));
        syncedMessages = highestUid ? [...fresh, ...syncedMessages].slice(0, 100) : fresh;
        await upsertCachedMessages(syncedMessages);
      }
      syncMessage = `Sincronizado: ${syncedFolders.length} carpetas y ${syncedMessages.length} mensajes.`;
    } catch (error) { syncMessage = String(error); }
    finally { syncing = false; }
  }
  /** Hash FNV-1a estable: convierte el UIDL de POP3 en un uid numérico reutilizable. */
  function hashUidl(uidl: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < uidl.length; index++) {
      hash ^= uidl.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }
  async function syncPop3Account() {
    if (!activeAccount || activeProvider !== 'pop3') { syncMessage = 'Selecciona una cuenta POP3 primero.'; return; }
    syncing = true; syncMessage = 'Conectando POP3…';
    try {
      const account = activeAccount; const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === account.email);
      if (!record) { syncMessage = 'No se encontró la configuración de la cuenta.'; return; }
      const input = { accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername };
      const messages = await listPop3Messages({ ...input, limit: 30 });
      const previous = new Map(syncedMessages.map((row) => [(row as CachedMessage & { pop3Uidl?: string }).pop3Uidl ?? '', row]));
      const rows = messages.map((message) => {
        const existing = previous.get(message.uidl);
        const base: CachedMessage = {
          uid: hashUidl(message.uidl), subject: message.subject, from: message.from, receivedAt: message.receivedAt, preview: message.preview,
          unread: existing?.unread ?? true, hasAttachments: message.hasAttachments,
          accountId: record.id, mailbox: 'INBOX', text: existing?.text ?? null, starred: existing?.starred ?? false, cachedAt: new Date().toISOString()
        };
        return Object.assign(base, { pop3Uidl: message.uidl }) as CachedMessage & { pop3Uidl: string };
      });
      syncedMessages = rows;
      unifiedMessages = [];
      // POP3 solo expone la bandeja: las carpetas especiales no aplican.
      syncedFolders = [{ name: 'INBOX', delimiter: null, flags: [], specialUse: 'Inbox' }];
      sentFolder = null; draftsFolder = null; archiveFolder = 'Archive';
      selectedMailbox = 'INBOX';
      syncMessage = `POP3: ${rows.length} mensajes.`;
    } catch (error) { syncMessage = String(error); }
    finally { syncing = false; }
  }
  function applySuggestions() {
    if (setup.provider === 'imap' || setup.provider === 'pop3') {
      const suggestion = suggestCommonServer(setup.emailAddress, setup.provider);
      if (suggestion) { setup.incoming.host = suggestion.incomingHost; setup.incoming.port = suggestion.incomingPort; if (setup.outgoing) { setup.outgoing.host = suggestion.outgoingHost; setup.outgoing.port = suggestion.outgoingPort; setup.outgoing.security = suggestion.outgoingPort === 587 ? 'starttls' : 'tls'; } }
    }
  }
  async function testConnection() {
    if (setup.provider !== 'imap' && setup.provider !== 'pop3') { setupError = 'La prueba inicial solo está disponible para IMAP y POP3.'; return; }
    if (!setup.incoming.host || !setup.incoming.username || !setup.secret) { setupError = 'Completa servidor, usuario y contraseña antes de probar.'; return; }
    testingConnection = true; setupError = ''; setupInfo = '';
    try {
      const desktop = await credentialBackendStatus();
      if (!desktop?.available) throw new Error('El almacén seguro de escritorio no está disponible.');
      await saveCredential(setup.emailAddress.trim().toLowerCase(), setup.secret);
      const input = { accountId: setup.emailAddress.trim().toLowerCase(), host: setup.incoming.host, port: setup.incoming.port, security: setup.incoming.security, username: setup.incoming.username || setup.emailAddress };
      const result = setup.provider === 'pop3' ? await testPop3Connection(input) : await testImapConnection(input);
      setupInfo = result.message;
    } catch (error) { setupError = String(error); }
    finally { testingConnection = false; }
  }
  let oauthAttempt = 0;
  async function startMicrosoftLogin() {
    if (!microsoftClientId.trim()) { setupError = 'Introduce el Client ID de tu aplicación registrada en Microsoft Entra ID.'; return; }
    const attempt = ++oauthAttempt;
    oauthBusy = true; setupError = ''; setupInfo = '';
    try {
      const result = await startMicrosoftOAuth(microsoftClientId.trim());
      oauthState = result.state;
      setupInfo = 'Se abrió Microsoft en el navegador. Completa el inicio de sesión y vuelve a e-Meil; la autorización se comprueba automáticamente.';
      const status = await waitForMicrosoftAuthorization(microsoftClientId.trim(), 'common', result.state, {
        isCurrent: () => attempt === oauthAttempt,
        onTick: (elapsed) => { if (attempt === oauthAttempt) setupInfo = `Esperando la autorización de Microsoft… (${Math.round(elapsed / 1000)} s)`; }
      });
      if (status.status === 'stale') return;
      if (status.status !== 'authorized') { setupError = status.message; return; }
      if (!status.email) { setupError = 'Microsoft no informó el correo de la cuenta autorizada.'; return; }
      setupInfo = status.message;
      setup.displayName = 'Microsoft 365'; setup.emailAddress = status.email; setup.provider = 'microsoft-graph';
      await saveMicrosoftAccount({ emailAddress: status.email, displayName: 'Microsoft 365', clientId: microsoftClientId.trim(), tenant: 'common' });
      await loadSavedAccounts();
      activeProvider = 'microsoft-graph';
    }
    catch (error) { setupError = String(error); }
    finally { if (attempt === oauthAttempt) oauthBusy = false; }
  }
  async function saveAccount(event: SubmitEvent) {
    event.preventDefault();
    if (setup.provider !== 'microsoft-graph') {
      const incomingError = validateServerSettings(setup.incoming, 'entrada');
      const outgoingError = setup.outgoing ? validateServerSettings(setup.outgoing, 'salida') : 'Configura el servidor SMTP de salida.';
      if (incomingError || outgoingError) { setupError = incomingError ?? outgoingError!; return; }
    }
    if (setup.provider === 'microsoft-graph') { setupOpen = false; setupStep = 'provider'; await loadSavedAccounts(); setupInfo = 'Cuenta Microsoft disponible tras la autorización OAuth.'; return; }
    if (setup.auth === 'password' && !setup.secret) { setupError = 'Ingresa la contraseña o clave de aplicación requerida por tu proveedor.'; return; }
    setupError = ''; setupInfo = '';
    const desktop = await credentialBackendStatus();
    if (!desktop) { setupError = 'El almacenamiento seguro solo está disponible en la aplicación de escritorio. No ingreses credenciales en la versión web.'; return; }
    if (!desktop.available) { setupError = desktop.message ?? 'El almacén seguro no está disponible en este sistema.'; return; }
    if (desktop.backend === 'linux-secret-service') setupInfo = 'Linux requiere que tengas configurado un almacén Secret Service, como GNOME Keyring o KWallet.';
    const accountId = setup.emailAddress.trim().toLowerCase();
    try {
      await saveCredential(accountId, setup.secret!);
    } catch (error) { setupError = `No se pudo guardar de forma segura: ${String(error)}`; return; }
    try {
      await saveAccountMetadata(setup);
    } catch (error) { setupError = `La credencial se guardó, pero no se pudo guardar la configuración: ${String(error)}`; return; }
    configuredAccounts = [...configuredAccounts, { name: setup.displayName || setup.emailAddress, email: setup.emailAddress, provider: setup.provider.toUpperCase() }];
    setup.secret = ''; setupOpen = false; setupStep = 'provider';
    setupInfo = 'Credencial guardada en el almacén seguro del sistema. La conexión IMAP/POP aún no está implementada.';
  }
  const folders = [
    { name: 'Bandeja de entrada', icon: '▣', count: '12' },
    { name: 'Favoritos', icon: '☆' },
    { name: 'Borradores', icon: '▤', count: '2' },
    { name: 'Elementos enviados', icon: '↗' },
    { name: 'Correo no deseado', icon: '⊘', count: '3' },
    { name: 'Elementos eliminados', icon: '♲' },
  ];
  let mails: Mail[] = $state([
    { sender: 'Sofía Martínez', address: 'sofia.martinez@estudio.co', subject: 'Propuesta visual — identidad de marca', preview: 'Hola, te comparto la primera versión del sistema visual. He incluido algunas alternativas de color para que podamos revisarlas…', time: '10:42', initials: 'SM', color: 'lavender', unread: true, starred: true, tag: 'Diseño', hasAttachments: true },
    { sender: 'El equipo de Linear', address: 'updates@linear.app', subject: 'Tu resumen semanal está listo', preview: 'Esta semana el equipo completó 8 tareas y abrió 3 nuevos proyectos. Mira las novedades que te esperan en tu espacio…', time: '09:18', initials: 'L', color: 'ink', unread: true, hasAttachments: false },
    { sender: 'Diego Fernández', address: 'diego@estudio.co', subject: 'Re: Reunión del jueves', preview: 'Perfecto, entonces nos vemos a las 11:30. Reservé la sala grande y agregué el enlace para quienes se conecten remoto.', time: 'Ayer', initials: 'DF', color: 'peach', starred: true, hasAttachments: true },
    { sender: 'Figma', address: 'team@figma.com', subject: 'Nuevos comentarios en «Web refresh»', preview: 'Camila y otras 2 personas dejaron comentarios en el archivo. Camila: «Me encanta cómo quedó el encabezado…»', time: 'Ayer', initials: 'Fg', color: 'coral', tag: 'Trabajo', hasAttachments: false },
    { sender: 'Mamá', address: 'maria.gonzalez@gmail.com', subject: 'Fotos del fin de semana 🌿', preview: 'Mira las fotos que sacamos en la costa. La próxima vez tienes que venir, el lugar estaba precioso y el almuerzo…', time: 'Lun', initials: 'M', color: 'sage', unread: true, hasAttachments: true },
    { sender: 'Notion', address: 'team@notion.so', subject: 'Tu semana en Notion', preview: 'Un vistazo a lo que pasó en tus páginas y espacios de trabajo durante esta semana.', time: 'Lun', initials: 'N', color: 'paper', hasAttachments: false },
    { sender: 'Javiera Rojas', address: 'javiera@estudio.co', subject: 'Referencias para el proyecto editorial', preview: 'Te dejé una colección de referencias en la carpeta compartida. Hay un par de revistas que creo que te van a gustar…', time: 'Dom', initials: 'JR', color: 'blue', hasAttachments: false },
  ]);
  const activeMail = $derived(mails[selected]);
  const graphMails = $derived(unifiedMessages.map((message) => ({ sender: message.sender, address: message.sender, subject: message.subject, preview: message.preview, time: message.receivedAt || '', initials: message.sender.slice(0, 2).toUpperCase(), color: 'lavender', unread: message.unread, starred: message.starred, mailbox: message.mailbox, tag: 'Microsoft 365', hasAttachments: message.hasAttachments, uid: message.id })));
  const visibleMails = $derived((activeProvider === 'microsoft-graph' ? graphMails : mails).map((mail, i) => ({ mail, i })).filter(({ mail }) => {
    const matchesQuery = `${mail.sender} ${mail.address} ${mail.subject} ${mail.preview}`.toLowerCase().includes(search.toLowerCase());
    const matchesFolder = currentFolder === 'Favoritos' ? mail.starred : currentFolder === 'Bandeja de entrada' ? true : currentFolder === 'Elementos enviados' ? mail.mailbox === sentFolder : currentFolder === 'Borradores' ? mail.mailbox === draftsFolder : false;
    const matchesUnread = filterUnread ? mail.unread : true;
    const matchesAttachments = filterHasAttachments ? mail.hasAttachments : true;
    return matchesQuery && matchesFolder && matchesUnread && matchesAttachments;
  }));
  const todayLabel = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('es-CL');
  function openMail(i: number) { selected = i; mails[i].unread = false; mobileReadingOpen = true; }
  function toggleStar(i: number, event: MouseEvent) { event.stopPropagation(); mails[i].starred = !mails[i].starred; }
  async function sendMail(event: SubmitEvent) { event.preventDefault(); if (sending) return; sending = true; composeNotice = 'Enviando mensaje…'; if (composeAttachments.some((attachment) => !attachment.path)) { composeNotice = 'Vuelve a seleccionar los adjuntos desde la aplicación de escritorio.'; sending = false; return; } if (!activeAccount) { composeNotice = 'Selecciona una cuenta primero.'; sending = false; return; } const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === activeAccount!.email); const useGraph = activeAccount!.provider === 'MICROSOFT-GRAPH' || activeProvider === 'microsoft-graph'; if (!record) { composeNotice = 'Configura primero una cuenta SMTP/IMAP o Microsoft.'; sending = false; return; } const clientKey = record.oauthClientId || microsoftClientId; try { const recipients = { to: composeTo.split(/[;,]/).map((item) => item.trim()).filter(Boolean), cc: composeCc.split(/[;,]/).map((item) => item.trim()).filter(Boolean), bcc: composeBcc.split(/[;,]/).map((item) => item.trim()).filter(Boolean) }; const attachments = composeAttachments.map((attachment) => ({ path: attachment.path || '', filename: attachment.name, contentType: attachment.type })); if (useGraph) { if (!clientKey) { composeNotice = 'Falta el Client ID de Microsoft para enviar.'; sending = false; return; } await sendGraphMessage({ accountId: `microsoft:${clientKey}`, ...recipients, subject: composeSubject, html: cleanComposeHtml(composeHtml), attachments }); } else { let smtpResult: import("./lib/smtp").SendSmtpResult; if (sentFolder) { smtpResult = await sendSmtpMail({ accountId: record.id, host: record.outgoingHost, port: record.outgoingPort, security: record.outgoingSecurity, username: record.outgoingUsername || record.emailAddress, ...recipients, subject: composeSubject, html: cleanComposeHtml(composeHtml), attachments, sentCopy: { host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: sentFolder } }); } else { smtpResult = await sendSmtpMail({ accountId: record.id, host: record.outgoingHost, port: record.outgoingPort, security: record.outgoingSecurity, username: record.outgoingUsername || record.emailAddress, ...recipients, subject: composeSubject, html: cleanComposeHtml(composeHtml), attachments }); } let smtpMsg = 'Mensaje entregado al servidor SMTP.'; if (smtpResult.sentCopySaved === true) smtpMsg += ' Copia guardada en enviados.'; else if (smtpResult.sentCopySaved === false) smtpMsg += ` No se pudo guardar la copia en enviados: ${smtpResult.sentCopyError}`; syncMessage = useGraph ? 'Mensaje enviado mediante Microsoft Graph.' : smtpMsg; } localStorage.removeItem('emeil-draft'); composeOpen = false; sent = true; setTimeout(() => sent = false, 2600); } catch (error) { composeNotice = `No se pudo enviar: ${String(error)}`; } finally { sending = false; } }

  // Calendar & Contacts helpers
  function loadCalendarData() {
    try {
      const saved = localStorage.getItem('emeil-calendar');
      if (saved) { const data = JSON.parse(saved); calendarEvents = data.events || []; calendars = data.calendars || []; }
    } catch { /* ignore */ }
    if (!calendars.length) {
      calendars = [{ id: 'primary', accountId: 'local', name: 'Personal', color: '#6557d9', isPrimary: true, readOnly: false }];
      calendarEvents = [];
    }
  }
  function saveCalendarData() { localStorage.setItem('emeil-calendar', JSON.stringify({ events: calendarEvents, calendars })); }

  function loadContactsData() {
    try {
      const saved = localStorage.getItem('emeil-contacts');
      if (saved) { const data = JSON.parse(saved); contacts = data.contacts || []; addressBooks = data.addressBooks || []; }
    } catch { /* ignore */ }
    if (!addressBooks.length) {
      addressBooks = [{ id: 'primary', accountId: 'local', name: 'Contactos', isPrimary: true, readOnly: false }];
      contacts = [];
    }
  }
  function saveContactsData() { localStorage.setItem('emeil-contacts', JSON.stringify({ contacts, addressBooks })); }

  function generateId() { return crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36); }

  function openEventForm(event?: CalendarEvent) {
    if (event) {
      eventForm = {
        title: event.title,
        description: event.description ?? '',
        location: event.location ?? '',
        accountId: event.accountId ?? '',
        startAt: event.startAt.slice(0,16),
        endAt: event.endAt.slice(0,16),
        allDay: event.allDay,
        calendarId: event.calendarId,
        color: event.color ?? '#6557d9',
        recurrenceRule: event.recurrenceRule ?? '',
        reminders: event.reminders ?? []
      };
      selectedEvent = event;
    } else {
      const start = new Date(selectedDate + 'T09:00');
      const end = new Date(start.getTime() + 3600000);
      eventForm = { title: '', description: '', location: '', accountId: '',
        startAt: start.toISOString().slice(0,16), endAt: end.toISOString().slice(0,16), allDay: false,
        calendarId: calendars[0]?.id || '', color: '#6557d9',
        recurrenceRule: '', reminders: [{ minutesBefore: 15, type: 'popup' }] };
      selectedEvent = null;
    }
    eventFormOpen = true;
  }
  function closeEventForm() { eventFormOpen = false; eventForm = emptyEventForm(); selectedEvent = null; }
  async function saveEvent() {
    if (!eventForm.title.trim()) return;
    const now = new Date().toISOString();
    if (selectedEvent) {
      const idx = calendarEvents.findIndex(e => e.id === selectedEvent!.id);
      if (idx >= 0) calendarEvents[idx] = { ...eventForm, id: selectedEvent.id, updatedAt: now };
    } else {
      calendarEvents.push({ ...eventForm, id: generateId(), createdAt: now, updatedAt: now, accountId: '' });
    }
    saveCalendarData();
    closeEventForm();
  }
  function deleteEvent(event: CalendarEvent) { if (confirm('Eliminar este evento?')) { calendarEvents = calendarEvents.filter(e => e.id !== event.id); saveCalendarData(); } }

  function openContactForm(contact?: Contact) {
    if (contact) {
      contactForm = {
        displayName: contact.displayName ?? '',
        firstName: contact.firstName ?? '',
        lastName: contact.lastName ?? '',
        emailAddresses: contact.emailAddresses ?? [],
        phoneNumbers: contact.phoneNumbers ?? [],
        addresses: contact.addresses ?? [],
        organization: contact.organization ?? '',
        title: contact.title ?? '',
        birthday: contact.birthday ?? '',
        notes: contact.notes ?? '',
        addressBookId: contact.addressBookId ?? '',
        accountId: contact.accountId ?? ''
      };
      selectedContact = contact;
    } else {
      contactForm = { ...emptyContactForm(), addressBookId: addressBooks[0]?.id || '' };
      selectedContact = null;
    }
    contactFormOpen = true;
  }
  function closeContactForm() { contactFormOpen = false; contactForm = emptyContactForm(); selectedContact = null; }
  async function saveContact() {
    if (!contactForm.displayName.trim()) return;
    const now = new Date().toISOString();
    if (selectedContact) {
      const idx = contacts.findIndex(c => c.id === selectedContact!.id);
      if (idx >= 0) contacts[idx] = { ...contactForm, id: selectedContact.id, updatedAt: now };
    } else {
      contacts.push({ ...contactForm, id: generateId(), createdAt: now, updatedAt: now, accountId: '' });
    }
    saveContactsData();
    closeContactForm();
  }
  function deleteContact(contact: Contact) { if (confirm('Eliminar este contacto?')) { contacts = contacts.filter(c => c.id !== contact.id); saveContactsData(); } }

  function formatEventTime(dateStr: string) { return new Date(dateStr).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); }
  function formatDate(dateStr: string) { return new Date(dateStr).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function getEventsForDate(date: string) { return calendarEvents.filter(e => e.startAt.startsWith(date) || (e.allDay && e.startAt <= date && e.endAt >= date)); }
  function getEventsForWeek(startOfWeek: Date) { const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(endOfWeek.getDate() + 6); return calendarEvents.filter(e => new Date(e.startAt) <= endOfWeek && new Date(e.endAt) >= startOfWeek); }
  function getEventsForMonth(year: number, month: number) { const start = new Date(year, month, 1); const end = new Date(year, month + 1, 0); return calendarEvents.filter(e => new Date(e.startAt) <= end && new Date(e.endAt) >= start); }
  function getMonthDays(dateStr: string) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: Date[] = [];
    // Previous month days
    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push(d);
    }
    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(new Date(year, month, d));
    }
    // Next month days to fill 42 cells (6 weeks)
    while (days.length < 42) {
      const next = new Date(days[days.length - 1]);
      next.setDate(next.getDate() + 1);
      days.push(next);
    }
    return days;
  }
  function getWeekDays(dateStr: string) {
    const date = new Date(dateStr);
    const day = date.getDay() === 0 ? 6 : date.getDay() - 1; // Monday = 0
    const startOfWeek = new Date(date);
    startOfWeek.setDate(startOfWeek.getDate() - day);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      days.push(d);
    }
    return days;
  }

  // Initialize calendar and contacts on load
  loadCalendarData();
  loadContactsData();
</script>

<svelte:head><title>{t('app.title')}</title></svelte:head>

<svelte:window oncontextmenu={(event) => openContextMenu(event)} onclick={closeContextMenu} onkeydown={handleWindowKeydown} /><div class="app-shell theme-{theme}" class:dark={dark} class:drawer-open={drawerOpen}>
  <a href="#main-content" class="skip-link">{t('app.skipContent')}</a>
  <a href="#sidebar" class="skip-link">{t('app.skipSidebar')}</a>
  <header class="topbar">
    <button class="menu-button" type="button" aria-label={t('topbar.menu')} aria-expanded={drawerOpen} aria-controls="sidebar" onclick={() => drawerOpen = !drawerOpen}><span class="menu-icon" aria-hidden="true"></span><span class="menu-icon" aria-hidden="true"></span><span class="menu-icon" aria-hidden="true"></span></button>
    <div class="brand"><div class="brand-mark"><span></span><span></span></div><span class="brand-name">e-meil</span></div>
    <div class="top-search"><span class="search-icon">⌕</span><input bind:value={search} placeholder="Buscar en todos los mensajes" aria-label="Buscar mensajes"/><kbd>⌘ K</kbd></div>
    <div class="top-actions"><button class="icon-button" use:tooltip={t('topbar.help')} aria-label={t('topbar.help')}>?</button><button class="icon-button settings" aria-label={t('topbar.theme')} use:tooltip={t('topbar.theme')} onclick={() => themeOpen = !themeOpen}>⚙</button>{#if themeOpen}<div class="theme-menu" role="dialog" aria-label="Elegir tema"><div class="theme-menu-title">{t('theme.title')}</div>{#each themes as option}<button class:theme-selected={theme === option.id} class="theme-option" onclick={() => setTheme(option.id)}><span class="theme-swatch" style={`--swatch:${option.color}`}></span><span><strong>{option.label}</strong><small>{option.description}</small></span>{#if theme === option.id}<b>✓</b>{/if}</button>{/each}<p class="theme-menu-note">{t('theme.note')}</p><button class="theme-option" role="switch" aria-checked={dark} onclick={() => setDark(!dark)}><span class="theme-swatch dark-swatch" aria-hidden="true"></span><span><strong>{t('theme.dark')}</strong><small>{dark ? t('theme.darkOn') : t('theme.darkOff')}</small></span>{#if dark}<b>✓</b>{/if}</button></div>{/if}{#if activeAccount}<button class="account" use:tooltip={activeAccount.email} onclick={() => themeOpen = false} onkeydown={(e) => { if (e.key === 'Enter') themeOpen = false; }}><div class="account-avatar">{activeAccount.email.slice(0,1).toUpperCase()}</div><div class="account-meta"><strong>{activeAccount.name}</strong><span>{activeAccount.email}</span><small>{activeAccount.provider === 'MICROSOFT-GRAPH' ? 'Microsoft 365' : activeAccount.provider === 'POP3' ? 'POP3' : 'IMAP'}</small></div></button>{/if}</div>
  </header>
  {#if drawerOpen}<div class="drawer-backdrop" role="presentation" aria-hidden="true" onclick={() => drawerOpen = false}></div>{/if}
  <div class="workspace">
    <nav class="rail" aria-label={t('rail.apps')}><button class="rail-item" class:active={activeView === 'mail'} use:tooltip={t('rail.mail')} aria-label={t('rail.mail')} onclick={() => activeView = 'mail'}><span>✉</span><i></i></button><button class="rail-item" class:active={activeView === 'calendar'} use:tooltip={t('rail.calendar')} aria-label={t('rail.calendar')} onclick={() => activeView = 'calendar'}><span>▦</span></button><button class="rail-item" class:active={activeView === 'contacts'} use:tooltip={t('rail.contacts')} aria-label={t('rail.contacts')} onclick={() => activeView = 'contacts'}><span>♙</span></button><div class="rail-spacer"></div><button class="rail-item" use:tooltip={t('rail.more')} aria-label={t('rail.more')}><span>⊞</span></button></nav>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-heading"><span>{t('sidebar.folders')}</span><button use:tooltip={t('sidebar.foldersOptions')} aria-label={t('sidebar.foldersOptions')}>···</button></div>
      <button class="compose-button" onclick={() => composeOpen = true}><span>＋</span> {t('sidebar.compose')} <kbd>N</kbd></button>
      <div class="folder-list">{#each folders as folder}<button class:folder-active={currentFolder === folder.name} class="folder" onclick={() => { currentFolder = folder.name; if (folder.name === 'Elementos enviados' && sentFolder) { selectedMailbox = sentFolder; syncImapAccount(sentFolder); } if (folder.name === 'Borradores' && draftsFolder) { selectedMailbox = draftsFolder; syncImapAccount(draftsFolder); } }}><span class="folder-icon">{folder.icon}</span><span>{folder.name}</span>{#if folder.count}<b>{folder.count}</b>{/if}</button>{/each}{#if syncedFolders.length}<div class="native-folder-label">{t('sidebar.imapFolders')}</div>{#each syncedFolders as folder}<button class:folder-active={selectedMailbox === folder.name} class="folder native-folder" onclick={() => { selectedMailbox = folder.name; currentFolder = folder.name === sentFolder ? 'Elementos enviados' : folder.name; syncImapAccount(folder.name); }}><span class="folder-icon">{folder.specialUse === 'Sent' ? '↗' : folder.specialUse === 'Archive' ? '▣' : '▱'}</span><span>{folder.name}</span>{#if folder.specialUse}<small class="special-folder-badge">{folder.specialUse}</small>{/if}</button>{/each}{/if}</div>
      <div class="sidebar-section"><div class="sidebar-heading"><span>{t('sidebar.accounts')}</span><button use:tooltip={t('sidebar.addAccount')} aria-label={t('sidebar.addAccount')}>＋</button></div>{#each configuredAccounts as account}<div class="mail-account" class:mail-account-active={activeAccount?.email === account.email} onclick={() => selectAccount(account)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAccount(account); } }} role="button" tabindex="0" aria-label={`Activar cuenta ${account.email}`}><span class="provider-dot">{account.provider === 'MICROSOFT-GRAPH' ? 'ms' : account.provider === 'POP3' ? 'pop' : 'imap'}</span><span>{account.name}</span>{#if activeAccount?.email === account.email}<small class="active-badge">●</small>{/if}</div><span class="account-email">{account.email}</span>{/each}<button class="add-account" onclick={() => { setupOpen = true; setupStep = 'provider'; }}>{t('sidebar.addAccountFull')}</button></div>
      <div class="sidebar-footer"><span class="sync-dot"></span> {t('sidebar.allSynced')} <span class="sync-time">{t('sidebar.now')}</span></div>
    </aside>
    <main class="mail-area" id="main-content">
      {#if activeView === 'mail'}
      <section class="message-list">
        <div class="list-header"><div><div class="eyebrow">{todayLabel}</div><h1>{currentFolder}</h1><div class="inbox-subtitle">{t('list.subtitle')}</div></div><div class="filter-dropdown"><button class="filter-button" aria-haspopup="menu" aria-expanded={filterMenuOpen} onclick={() => filterMenuOpen = !filterMenuOpen} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filterMenuOpen = !filterMenuOpen; } }}>☷ <span>{t('filters.trigger')}</span><span class="chevron">⌄</span></button>{#if filterMenuOpen}<div class="filter-menu" role="group" aria-label={t('filters.group')}><div class="filter-section"><label><input type="checkbox" bind:checked={filterUnread} onchange={() => filterMenuOpen = false} /> <span>No leídos</span></label></div><div class="filter-section"><label><input type="checkbox" bind:checked={filterHasAttachments} onchange={() => filterMenuOpen = false} /> <span>Con adjuntos</span></label></div>{#if filterUnread || filterHasAttachments}<button class="filter-clear" onclick={() => { filterUnread = false; filterHasAttachments = false; filterMenuOpen = false; }}>{t('filters.clear')}</button>{/if}</div>{/if}</div></div>
        <div class="list-tools">{#if selectionMode}<div class="batch-bar"><button class="batch-btn" onclick={() => { selectedUids.clear(); selectionMode = false; }} aria-label="Cancelar selección">{t('common.cancel')}</button><span class="batch-count">{selectedUids.size} seleccionados</span><button class="batch-btn danger" onclick={() => batchAction('archive')}>{t('batch.archive')}</button><button class="batch-btn danger" onclick={() => batchAction('delete')}>{t('batch.delete')}</button></div>{:else}<button class="select-all" aria-label="Seleccionar" onclick={() => { selectionMode = true; selectedUids.clear(); visibleMails.forEach(({ mail }) => { const key = (mail as any).uid ?? (mail as any).id; selectedUids.add(key); }); }}></button><span>{t('list.select')}</span>{/if}{#if filterUnread || filterHasAttachments}<div class="active-filters" style="margin-left:auto;display:flex;gap:6px;align-items:center;font-size:10px;color:var(--muted)">{#if filterUnread}<span class="filter-pill">✉ {t('filters.unread')}</span>{/if}{#if filterHasAttachments}<span class="filter-pill">⌁ {t('filters.attachments')}</span>{/if}</div>{/if}<div class="tool-spacer"></div><span class="list-count">{selectionMode ? selectedUids.size + ' seleccionados de ' : ''}{syncedMessages.length || visibleMails.length} mensajes</span><button class="tool-icon" use:tooltip={'Ordenar'} aria-label="Ordenar">↕</button><button class="tool-icon" title={t('common.refresh')} onclick={() => activeProvider === 'microsoft-graph' ? syncGraphAccount() : activeProvider === 'pop3' ? syncPop3Account() : syncImapAccount()} disabled={syncing}>{syncing ? '…' : '⟳'}</button></div>{#if syncMessage}<div class="sync-banner">{syncMessage}</div>{/if}
        <div class="messages">{#if syncedMessages.length}{#each syncedMessages as mail (mail.uid)}<article class:unread={mail.unread} class="message-row" oncontextmenu={(event) => openContextMenu(event, mail.uid)}>{#if selectionMode}<input type="checkbox" class="select-checkbox" checked={selectedUids.has(mail.uid)} onchange={() => { if (selectedUids.has(mail.uid)) selectedUids.delete(mail.uid); else selectedUids.add(mail.uid); }} />{:else}<button class="message-open" onclick={() => openRealMessage(mail)} aria-label={t('reading.open')}><span class="row-check"></span></button>{/if}<button type="button" class:starred={mail.starred} class="star" aria-label={t('reading.favorite')} onclick={(event) => { event.stopPropagation(); toggleCachedState(mail, 'starred'); }}>{mail.starred ? '★' : '☆'}</button><span class="sender-avatar lavender">{messageInitials(mail.from)}</span><button class="message-open message-body-open" onclick={() => openRealMessage(mail)} aria-label={t('reading.open')}><span class="sender-avatar lavender">{messageInitials(mail.from)}</span><span class="message-content"><span class="message-top"><span class="sender">{mail.from}</span><span class="message-time">{displayTime(mail.receivedAt)}</span></span><span class="subject-line">{mail.subject}</span><span class="preview">{mail.preview || 'Sin vista previa disponible.'}</span></span></button>{#if mail.unread}<span class="unread-dot"></span>{/if}</article>{/each}{:else}{#each visibleMails as item (item.i)}<article class:selected={selected === item.i} class:unread={item.mail.unread} class="message-row">{#if selectionMode}<input type="checkbox" class="select-checkbox" checked={selectedUids.has(item.mail.uid ?? item.i)} onchange={() => { const key = item.mail.uid ?? item.i; if (selectedUids.has(key)) selectedUids.delete(key); else selectedUids.add(key); }} />{:else}<button class="message-open" aria-label="Abrir mensaje: {item.mail.subject}" onclick={() => activeProvider === 'microsoft-graph' ? openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage) : openMail(item.i)}><span class="row-check"></span></button>{/if}<button type="button" class:starred={item.mail.starred} class="star" aria-label={item.mail.starred ? 'Quitar de favoritos' : 'Añadir a favoritos'} onclick={(event) => toggleStar(item.i, event)}>{item.mail.starred ? '★' : '☆'}</button><button class="message-open message-body-open" aria-label="Abrir mensaje: {item.mail.subject}" onclick={() => activeProvider === 'microsoft-graph' ? openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage) : openMail(item.i)}><span class="sender-avatar {item.mail.color}">{item.mail.initials}</span><span class="message-content"><span class="message-top"><span class="sender">{item.mail.sender}</span><span class="message-time">{item.mail.time}</span></span><span class="subject-line">{item.mail.subject}{#if item.mail.tag}<span class="tag">{item.mail.tag}</span>{/if}</span><span class="preview">{item.mail.preview}</span></span></button>{#if item.mail.unread}<span class="unread-dot"></span>{/if}</article>{/each}{/if}</div>
        <div class="list-bottom"><span>Estás al día</span><span class="bottom-spark">✳</span></div>
      <div class="list-bottom"><span>Estás al día</span><span class="bottom-spark">✳</span></div>
      </section>
      {:else if activeView === 'calendar'}
      <section class="calendar-view">
        <div class="calendar-header">
          <div class="calendar-nav">
            <button class="nav-btn" onclick={() => { const d = new Date(selectedDate); d.setMonth(d.getMonth() - 1); selectedDate = d.toISOString().split('T')[0]; }} title="Mes anterior">‹</button>
            <h2>{formatDate(selectedDate + 'T00:00')}</h2>
            <button class="nav-btn" onclick={() => { const d = new Date(selectedDate); d.setMonth(d.getMonth() + 1); selectedDate = d.toISOString().split('T')[0]; }} title="Mes siguiente">›</button>
          </div>
          <div class="calendar-actions">
            <select bind:value={calendarView} class="view-select">
              <option value="month">{t('calendar.month')}</option>
              <option value="week">{t('calendar.week')}</option>
              <option value="day">{t('calendar.day')}</option>
            </select>
            <button class="btn-primary" onclick={() => openEventForm()}>{t('calendar.newEvent')}</button>
          </div>
        </div>
        <div class="calendar-grid">
          {#if calendarView === 'month'}
          <div class="month-view">
            <div class="week-days">
              {#each ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'] as day}<div class="week-day">{day}</div>{/each}
            </div>
            <div class="month-days">
              {#each getMonthDays(selectedDate) as date}
                <div class="day" class:today={date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]} class:other-month={date.getMonth() !== new Date(selectedDate).getMonth()} class:has-events={getEventsForDate(date.toISOString().split('T')[0]).length > 0} role="button" tabindex="0" aria-label={date.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })} onclick={() => { selectedDate = date.toISOString().split('T')[0]; }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedDate = date.toISOString().split('T')[0]; } }}>
                  <span class="day-number">{date.getDate()}</span>
                  <div class="day-events">{#each getEventsForDate(date.toISOString().split('T')[0]).slice(0,3) as event}<div class="event" style="border-left-color: {event.color || '#6557d9'}" role="button" tabindex="0" aria-label={event.title + ', ' + formatEventTime(event.startAt)} onclick={(e) => { e.stopPropagation(); openEventForm(event); }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openEventForm(event); } }}>{formatEventTime(event.startAt)} {event.title}</div>{/each}{#if getEventsForDate(date.toISOString().split('T')[0]).length > 3}<div class="more-events">+{getEventsForDate(date.toISOString().split('T')[0]).length - 3} más</div>{/if}</div>
                </div>
              {/each}
            </div>
          </div>
          {:else if calendarView === 'week'}
          <div class="week-view">
            <div class="week-header">
              {#each getWeekDays(selectedDate) as d}
                <div class="week-day-header">{d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' })}</div>
              {/each}
            </div>
            <div class="week-grid">
              {#each Array.from({length: 24}, (_, h) => h) as hour}
                <div class="time-slot">{hour.toString().padStart(2,'0')}:00</div>
                {#each getWeekDays(selectedDate) as d}
                  <div class="week-cell">{#each getEventsForDate(d.toISOString().split('T')[0]).filter(e => new Date(e.startAt).getHours() === hour) as event}<div class="event" style="border-left-color: {event.color || '#6557d9'}" role="button" tabindex="0" aria-label={event.title + ', ' + formatEventTime(event.startAt)} onclick={() => openEventForm(event)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventForm(event); } }}>{formatEventTime(event.startAt)} {event.title}</div>{/each}</div>
                {/each}
              {/each}
            </div>
          </div>
          {:else}
          <div class="day-view">
            <div class="day-header">
              <h3>{formatDate(selectedDate + 'T00:00')}</h3>
            </div>
            <div class="day-grid">
              {#each Array.from({length: 24}, (_, h) => h) as hour}
                <div class="time-slot">{hour.toString().padStart(2,'0')}:00</div>
                <div class="day-cell">{#each getEventsForDate(selectedDate).filter(e => new Date(e.startAt).getHours() === hour) as event}<div class="event" style="border-left-color: {event.color || '#6557d9'}" role="button" tabindex="0" aria-label={event.title + ', ' + formatEventTime(event.startAt)} onclick={() => openEventForm(event)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventForm(event); } }}>{formatEventTime(event.startAt)} {event.title}</div>{/each}</div>
              {/each}
            </div>
          </div>
          {/if}
        </div>
        <Modal open={eventFormOpen} title={selectedEvent ? 'Editar evento' : 'Nuevo evento'} onclose={closeEventForm} class="event-form">
          <label>{t('form.title')}<input bind:value={eventForm.title} placeholder="Título del evento" required></label><label>{t('form.description')}<textarea bind:value={eventForm.description} rows="3"></textarea></label><label>{t('form.location')}<input bind:value={eventForm.location} placeholder="Ubicación"></label><label>{t('form.allDay')}<input type="checkbox" bind:checked={eventForm.allDay} onchange={() => { if (eventForm.allDay) { eventForm.startAt = selectedDate + 'T00:00'; eventForm.endAt = selectedDate + 'T23:59'; } }}></label><label>{t('form.start')}<input type="datetime-local" bind:value={eventForm.startAt}></label><label>{t('form.end')}<input type="datetime-local" bind:value={eventForm.endAt}></label><label>{t('form.calendar')}<select bind:value={eventForm.calendarId}>{#each calendars as cal}<option value={cal.id}>{cal.name}</option>{/each}</select></label><label>{t('form.color')}<input type="color" bind:value={eventForm.color}></label><div class="form-actions"><button class="btn-secondary" onclick={closeEventForm}>{t('common.cancel')}</button><button class="btn-primary" onclick={saveEvent}>{t('common.save')}</button></div>
        </Modal>
      </section>
      {:else if activeView === 'contacts'}
      <section class="contacts-view">
        <div class="contacts-header">
          <h2>Contactos</h2>
          <div class="contacts-actions">
            <input type="text" bind:value={contactSearch} placeholder="Buscar contactos..." class="search-input" />
            <button class="btn-primary" onclick={() => openContactForm()}>{t('contacts.new')}</button>
          </div>
        </div>
        <div class="contacts-list">
          {#each contacts.filter(c => c.displayName.toLowerCase().includes(contactSearch.toLowerCase())) as contact}
          <div class="contact-card" role="button" tabindex="0" aria-label={contact.displayName + ', ' + (contact.emailAddresses[0]?.address || contact.phoneNumbers[0]?.number || '')} onclick={() => openContactForm(contact)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContactForm(contact); } }}>
            <div class="contact-avatar">{contact.displayName.slice(0,1).toUpperCase()}</div>
            <div class="contact-info">
              <strong>{contact.displayName}</strong>
              <span>{contact.emailAddresses[0]?.address || contact.phoneNumbers[0]?.number || ''}</span>
            </div>
          </div>
          {/each}
          {#if !contacts.filter(c => c.displayName.toLowerCase().includes(contactSearch.toLowerCase())).length}
            <div class="empty-state">{t('contacts.empty')}</div>
          {/if}
        </div>
        <Modal open={contactFormOpen} title={selectedContact ? 'Editar contacto' : 'Nuevo contacto'} onclose={closeContactForm} class="contact-form">
          <label>{t('contacts.name')}<input bind:value={contactForm.displayName} placeholder="Nombre completo" required></label><div class="form-row"><label>{t('contacts.name')}<input bind:value={contactForm.firstName} placeholder="Nombre"></label><label>{t('contacts.lastName')}<input bind:value={contactForm.lastName} placeholder="Apellidos"></label></div><label>{t('contacts.email')}<input type="email" bind:value={contactForm.emailAddresses[0].address} placeholder="email@ejemplo.com"></label><label>{t('contacts.phone')}<input type="tel" bind:value={contactForm.phoneNumbers[0].number} placeholder="+34 600 000 000"></label><label>{t('contacts.organization')}<input bind:value={contactForm.organization} placeholder="Empresa/Organización"></label><label>{t('contacts.role')}<input bind:value={contactForm.title} placeholder="Cargo"></label><label>{t('contacts.birthday')}<input type="date" bind:value={contactForm.birthday}></label><label>{t('contacts.notes')}<textarea bind:value={contactForm.notes} rows="3"></textarea></label><div class="form-actions"><button class="btn-secondary" onclick={closeContactForm}>{t('common.cancel')}</button><button class="btn-primary" onclick={saveContact}>{t('common.save')}</button></div>
        </Modal>
      </section>
      {/if}
      <section class="reading-pane" class:reading-open={mobileReadingOpen}>{#if activeRealMessage}<div class="reading-toolbar"><div class="toolbar-left"><button class="pane-tool" title={t('common.backToList')} onclick={() => { activeRealMessage = null; mobileReadingOpen = false; }}>←</button><span class="toolbar-divider"></span><span class="real-badge">IMAP</span></div><div class="toolbar-right"><span>{loadingMessage ? 'Cargando…' : 'Mensaje real'}</span></div></div><article class="email"><div class="email-category"><span class="category-dot"></span> {t('reading.imapAccount')} <span class="category-line"></span></div><div class="email-subject-row"><h2>{activeRealMessage.subject}</h2><span class="real-attachment">{activeRealMessage.hasAttachments ? '⌁ adjuntos' : ''}</span></div><div class="email-from"><div class="sender-avatar large lavender">{messageInitials(activeRealMessage.from)}</div><div class="from-info"><div class="from-name">{activeRealMessage.from}</div><span class="to-line">{t('reading.syncedFrom', { mailbox: selectedMailbox })}</span></div></div><div class="email-body real-body"><div class="safe-content-notice">{t('reading.plainTextNotice')}</div>{#if activeRealMessage.attachments.length}<div class="real-attachments">{#each activeRealMessage.attachments as attachment}<div class="real-attachment-card"><span>⌁</span><div><strong>{attachment.filename}</strong><small>{attachment.contentType} · límite 25 MB</small></div><button class="download-attachment" onclick={() => downloadAttachment(attachment)} title={t('reading.saveAttachment')}>↓</button></div>{/each}</div>{/if}<pre>{activeRealMessage.text || 'Este mensaje no contiene texto visible.'}</pre><div class="email-actions"><button class="reply-button" onclick={() => openReply('imap')}>↶ <span>{t('common.reply')}</span></button><button class="forward-button" onclick={() => openForward('imap')}>↗ <span>{t('common.forward')}</span></button></div></div></article>{:else if activeGraphMessage}<div class="reading-toolbar"><div class="toolbar-left"><button class="pane-tool" title={t('common.backToList')} onclick={() => { activeGraphMessage = null; mobileReadingOpen = false; }}>←</button><span class="toolbar-divider"></span><span class="real-badge">GRAPH</span><button class="pane-tool" title={t('batch.archive')} onclick={() => graphAction('archive')}>▣</button><button class="pane-tool" title={t('batch.delete')} onclick={() => graphAction('delete')}>♲</button></div></div><article class="email"><div class="email-category"><span class="category-dot"></span> {t('reading.ms365')} <span class="category-line"></span></div><div class="email-subject-row"><h2>{activeGraphMessage.subject}</h2><span class="real-attachment">{activeGraphMessage.hasAttachments ? '⌁ adjuntos' : ''}</span></div><div class="email-from"><div class="sender-avatar large lavender">{messageInitials(activeGraphMessage.sender)}</div><div class="from-info"><div class="from-name">{activeGraphMessage.sender}</div><span class="to-line">{t('reading.syncedFromGraph')}</span></div></div><div class="email-body real-body"><div class="safe-content-notice">{t('reading.graphSecureNotice')}</div><pre>{activeGraphMessage.body || activeGraphMessage.preview || 'Este mensaje no contiene texto visible.'}</pre></div><div class="email-actions"><button class="reply-button" onclick={() => openReply('graph')}>↶ <span>{t('common.reply')}</span></button><button class="forward-button" onclick={() => openForward('graph')}>↗ <span>{t('common.forward')}</span></button></div></article>{:else if activeMail}<div class="reading-toolbar"><div class="toolbar-left"><button class="pane-tool" title={t('common.backToList')} onclick={() => { mobileReadingOpen = false; }}>←</button><span class="toolbar-divider"></span><button class="pane-tool" title={t('batch.archive')} onclick={() => remoteAction('archive')}>▣</button><button class="pane-tool" title={t('batch.delete')} onclick={() => remoteAction('delete')}>♲</button><button class="pane-tool" title={t('context.read')} onclick={() => remoteAction('seen')}>✉</button><span class="toolbar-divider"></span><button class="pane-tool" title={t('reading.move')}>⌑</button><button class="pane-tool" title={t('common.more')}>···</button></div><div class="toolbar-right"><span>1 de 12</span><button class="pane-tool">‹</button><button class="pane-tool">›</button></div></div>
        <article class="email"><div class="email-category"><span class="category-dot"></span> {activeMail.tag ?? 'Principal'} <span class="category-line"></span></div><div class="email-subject-row"><h2>{activeMail.subject}</h2><button class="pane-tool" title={t('reading.favorite')}>☆</button></div><div class="email-from"><div class="sender-avatar large {activeMail.color}">{activeMail.initials}</div><div class="from-info"><div class="from-name">{activeMail.sender}<span class="from-address"> &lt;{activeMail.address}&gt;</span></div><span class="to-line">{t('reading.toMe')} <span class="chevron">⌄</span></span></div><div class="email-date">Hoy, 10:42</div><button class="pane-tool more-mail">···</button></div><div class="email-body"><p>Hola Camila,</p><p>Te comparto la primera versión del sistema visual para la nueva identidad. Estuve explorando un lenguaje que se sienta cercano y editorial, pero que también funcione bien en digital.</p><p>Incluí tres rutas de color para que podamos elegir la que mejor se adapte a lo que conversamos. La primera mantiene los tonos cálidos; la segunda es un poco más fresca; y la tercera es más sobria.</p><div class="attachment"><div class="attachment-preview"><div class="mini-art"><span>forma</span><i></i></div></div><div class="attachment-info"><strong>Identidad visual — v1</strong><span>PDF · 4.8 MB</span></div><button class="download">↓</button></div><p>Cuando tengas un momento, cuéntame qué te parece. Si quieres, lo revisamos juntas el jueves.</p><p>¡Abrazo!<br/>Sofía</p></div><div class="email-actions"><button class="reply-button" onclick={() => composeOpen = true}>↶ <span>{t('common.reply')}</span></button><button class="forward-button" onclick={() => composeOpen = true}>↗ <span>{t('common.forward')}</span></button><button class="reaction-button" title={t('reading.react')}>☺</button></div></article>{:else}<div class="empty-state">{t('common.emptyReading')}</div>{/if}</section>
    </main>
  </div>
</div>
{#if sent}<div class="toast">✓ <span>{t('reading.sent')}</span><button onclick={() => sent = false}>{t('common.undo')}</button></div>{/if}
{#if setupOpen}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) setupOpen = false; }}><section class="setup-window" aria-label="Agregar cuenta de correo"><header class="setup-header"><div><span class="setup-kicker">{t('setup.title')}</span><h2>{setupStep === 'provider' ? 'Conecta tu correo' : 'Detalles de la cuenta'}</h2><p>{setupStep === 'provider' ? 'Elige el tipo de cuenta que quieres agregar.' : 'Introduce los datos proporcionados por tu proveedor.'}</p></div><button type="button" onclick={() => setupOpen = false} aria-label={t('common.close')}>×</button></header>{#if setupStep === 'provider'}<div class="provider-options"><button class="provider-choice" onclick={() => chooseProvider('microsoft-graph')}><span class="provider-logo ms-logo">▦</span><span><strong>{t('setup.providerMs')}</strong><small>{t('setup.msLogin')}</small></span><span class="choice-arrow">›</span></button><button class="provider-choice" onclick={() => chooseProvider('imap')}><span class="provider-logo imap-logo">✉</span><span><strong>IMAP</strong><small>{t('setup.imapDesc')}</small></span><span class="choice-arrow">›</span></button><button class="provider-choice" onclick={() => chooseProvider('pop3')}><span class="provider-logo pop-logo">↓</span><span><strong>POP3</strong><small>{t('setup.pop3Desc')}</small></span><span class="choice-arrow">›</span></button></div><div class="setup-note">Las cuentas se configuran en este dispositivo y conectan directamente con tu proveedor.</div>{:else}<form class="account-form" onsubmit={saveAccount}><button type="button" class="back-link" onclick={() => setupStep = 'provider'}>{t('setup.changeType')}</button><div class="provider-badge">{setup.provider === 'microsoft-graph' ? 'Microsoft 365 · OAuth' : setup.provider.toUpperCase() + ' · Configuración manual'}</div><label>{t('setup.displayName')}<input bind:value={setup.displayName} placeholder="Mi cuenta personal"/></label><label>{t('setup.email')}<input type="email" bind:value={setup.emailAddress} placeholder="nombre@ejemplo.com" required onblur={applySuggestions}/></label>{#if setup.provider !== 'microsoft-graph'}<div class="server-block"><h3>Servidor de entrada ({setup.provider.toUpperCase()})</h3><div class="server-fields"><label>{t('setup.server')}<input bind:value={setup.incoming.host} placeholder="imap.ejemplo.com" required/></label><label>{t('setup.port')}<input type="number" bind:value={setup.incoming.port} required/></label></div><label>{t('setup.security')}<select bind:value={setup.incoming.security}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label><h3>{t('setup.outgoing')}</h3><div class="server-fields"><label>{t('setup.server')}<input bind:value={setup.outgoing!.host} placeholder="smtp.ejemplo.com" required/></label><label>{t('setup.port')}<input type="number" bind:value={setup.outgoing!.port} required/></label></div><label>{t('setup.security')}<select bind:value={setup.outgoing!.security}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label></div><label>{t('setup.user')}<input bind:value={setup.incoming.username} placeholder="Normalmente tu dirección de correo"/></label><label>{t('setup.password')}<input type="password" bind:value={setup.secret} autocomplete="new-password" placeholder="Se usará solo en esta demostración"/></label><p class="security-hint">⚠ En esta versión de demostración no se guarda ni se envía esta contraseña a ningún servidor.</p>{:else}<div class="oauth-explainer"><span>↗</span><div><strong>{t('setup.secureLogin')}</strong><p>Se abrirá Microsoft en una ventana segura para autorizar e-Meil mediante OAuth 2.0 con PKCE.</p><label>Client ID de Microsoft Entra ID<input bind:value={microsoftClientId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></label><button type="button" class="send-button oauth-button" onclick={startMicrosoftLogin} disabled={oauthBusy}>{oauthBusy ? t('common.loading') : t('setup.msLoginButton')}</button></div></div>{/if}{#if setupError}<p class="setup-error">{setupError}</p>{/if}{#if setupInfo}<p class="setup-message">{setupInfo}</p>{/if}<footer class="setup-footer">{#if setup.provider === 'imap' || setup.provider === 'pop3'}<button type="button" class="cancel-setup" onclick={testConnection} disabled={testingConnection}>{testingConnection ? 'Probando…' : 'Probar conexión'}</button>{/if}<button type="button" class="cancel-setup" onclick={() => setupOpen = false}>{t('common.cancel')}</button><button class="send-button" type="submit">{setup.provider === 'microsoft-graph' ? t('setup.msContinue') : t('setup.addAccount')}</button></footer></form>{/if}</section></div>{/if}
{#if contextMenu}<div class="context-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px`} role="menu" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={handleMenuKeydown}><div class="context-title">{contextMenu.kind === 'message' ? t('context.messageTitle') : 'e-MEIL'}</div>{#if contextMenu.kind === 'message'}<button role="menuitem" onclick={() => contextAction('open')}>▣ <span>{t('context.open')}</span></button><button role="menuitem" onclick={() => contextAction('read')}>✉ <span>{t('context.read')}</span></button><button role="menuitem" onclick={() => contextAction('star')}>☆ <span>{t('context.star')}</span></button><button role="menuitem" onclick={() => contextAction('delete')} class="danger">♲ <span>{t('context.delete')}</span></button>{:else}<button role="menuitem" onclick={() => contextAction('compose')}>＋ <span>{t('context.compose')}</span></button><button role="menuitem" onclick={() => syncImapAccount()}>⟳ <span>{t('context.sync')}</span></button>{/if}</div>{/if}{#if composeOpen}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) composeOpen = false; }}><form class="compose-window compose-expanded" onsubmit={sendMail}><div class="compose-header"><div><span class="compose-kicker">{t('compose.kicker')}</span><strong>{t('compose.headerTitle')}</strong></div><div><button type="button" class="window-action" title={t('compose.saveDraft')} onclick={saveDraft}>⌄</button><button type="button" class="window-action" onclick={() => composeOpen = false} aria-label={t('common.close')}>×</button></div></div><div class="compose-ribbon"><div class="ribbon-group"><button type="button" class="ribbon-main" onclick={() => addAttachments()}><span>⌁</span><small>{t('compose.attach')}</small></button><button type="button" onclick={() => showCcBcc = !showCcBcc}>{t('compose.ccBcc')}</button></div><span class="ribbon-divider"></span><div class="ribbon-group"><button type="button" onclick={() => execFormat('bold')}><b>B</b><small>{t('compose.bold')}</small></button><button type="button" onclick={() => execFormat('italic')}><i>I</i><small>{t('compose.italic')}</small></button><button type="button" onclick={() => execFormat('underline')}><u>U</u><small>{t('compose.underline')}</small></button><button type="button" onclick={() => execFormat('insertUnorderedList')}>☷<small>{t('compose.list')}</small></button><button type="button" onclick={() => execFormat('justifyLeft')}>≡<small>{t('compose.align')}</small></button></div><span class="ribbon-divider"></span><div class="ribbon-group"><button type="button" onclick={() => { document.execCommand('insertText', false, '\n' + signature); }}><span>✎</span><small>{t('compose.signature')}</small></button><button type="button" onclick={() => execFormat('undo')}>↶<small>Deshacer</small></button><button type="button" onclick={() => execFormat('redo')}>↷<small>{t('compose.redo')}</small></button></div></div><label class="compose-field">{t('compose.to')} <input type="email" bind:value={composeTo} placeholder="nombre@ejemplo.com" required/></label>{#if showCcBcc}<label class="compose-field">{t('compose.cc')} <input bind:value={composeCc} placeholder="personas adicionales"/></label><label class="compose-field">{t('compose.bcc')} <input bind:value={composeBcc} placeholder="destinatarios ocultos"/></label>{/if}<label class="compose-field">{t('compose.subject')} <input bind:value={composeSubject} placeholder="Añade un asunto"/></label><div class="rich-editor" contenteditable="true" role="textbox" aria-label="Cuerpo del mensaje" onpaste={handlePaste} oninput={(event) => composeHtml = (event.currentTarget as HTMLElement).innerHTML}> {@html composeHtml}</div>{#if composeAttachments.length}<div class="compose-attachments">{#each composeAttachments as attachment}<div><span>⌁</span><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small><button type="button" onclick={() => removeAttachment(attachment.name)}>×</button></div>{/each}</div>{/if}{#if composeNotice}<div class="compose-notice">{composeNotice}</div>{/if}<div class="compose-footer"><button class="send-button" type="submit" disabled={sending}>{sending ? 'Enviando…' : 'Enviar'} <span>↗</span></button><button type="button" class="draft-button" onclick={saveDraft}>Guardar borrador</button><button type="button" class="discard-button" onclick={() => composeOpen = false}>{t('compose.discard')}</button></div></form></div>{/if}
