<script lang="ts">
  import { tick } from 'svelte';
  import { initialSetup, suggestCommonServer, validateServerSettings } from './lib/account-setup';
  import type { AccountSetup, MailProvider, CalendarEvent, CalendarCalendar, Contact, AddressBook, CalendarAccount, ContactAccount, EventReminder, ContactEmail, ContactPhone, ContactAddress } from './lib/types';
  import { credentialBackendStatus, deleteCredential, saveCredential } from './lib/credentials';
  import { deleteAccount, listAccounts, saveAccountMetadata, saveGoogleAccount, saveMicrosoftAccount } from './lib/accounts';
  import { deleteImapMessage, downloadImapAttachment, listImapFolders, listImapMessages, listImapMessagesIncremental, moveImapMessage, readImapMessage, saveImapDraft, searchImapMessages, setImapSeen, testImapConnection } from './lib/imap';
  import { createEmptyRule, getMatchingRules, loadRules, saveRules, type MailRule } from './lib/rules';
  import type { ImapMessageContent } from './lib/imap';
  import type { AccountRecord } from './lib/accounts';
import { deletePop3Message, listPop3Messages, readPop3Message, testPop3Connection } from './lib/pop3';
  import { listCachedMessages, updateCachedMessageState, upsertCachedMessages } from './lib/cache';
  import type { CachedMessage } from './lib/cache';
  import { startGoogleOauth, startMicrosoftLoginWindow, waitForGoogleAuthorization, waitForMicrosoftAuthorization } from './lib/oauth';
  import { MICROSOFT_CLIENT_ID, MICROSOFT_TENANT } from './lib/config';
  import { checkAppUpdate, installAppUpdate, type UpdateInfo } from './lib/updater';
import { getLocale, initLocale, setLocale, t, type Locale } from './lib/i18n';
  import { inspectAttachment, sendSmtpMail } from './lib/smtp';
  import { archiveGraphMessage, createGraphDraft, deleteGraphMessage, listGraphMessages, markGraphMessage, sendGraphMessage } from './lib/graph';
  import { notifyNewMail as notifyNewMailDesktop, type NewMailSummary } from './lib/notifications';
  import { isTauri } from '@tauri-apps/api/core';
  import { invoke as tauriInvoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
  import type { UnifiedMessage } from './lib/mail-repository';
  import { open } from '@tauri-apps/plugin-dialog';
  import Modal from './lib/Modal.svelte';
  import Icon from './lib/Icon.svelte';
  import { tooltip } from './lib/tooltip';
  let currentFolder = $state('Bandeja de entrada');
  let search = $state('');
  let filterUnread = $state(false);
  let filterHasAttachments = $state(false);
  let filterMenuOpen = $state(false);
  let sortMenuOpen = $state(false);
  let sortKey = $state<'date-desc' | 'date-asc' | 'sender' | 'unread'>('date-desc');
  function sortMessages<T extends { receivedAt?: string | null; time?: string; from?: string; sender?: string; unread?: boolean; mail?: { time?: string; unread?: boolean; sender?: string } }>(list: T[]): T[] {
    const sorted = [...list];
    const senderOf = (item: T) => item.from ?? item.sender ?? item.mail?.sender ?? '';
    const unreadOf = (item: T) => Boolean(item.unread ?? item.mail?.unread ?? false);
    const dateOf = (item: T) => { const raw = item.receivedAt ?? item.time ?? item.mail?.time ?? ''; const parsed = raw ? new Date(raw).getTime() : 0; return Number.isNaN(parsed) ? 0 : parsed; };
    if (sortKey === 'sender') sorted.sort((a, b) => senderOf(a).localeCompare(senderOf(b)));
    else if (sortKey === 'unread') sorted.sort((a, b) => Number(unreadOf(b)) - Number(unreadOf(a)));
    else sorted.sort((a, b) => sortKey === 'date-asc' ? dateOf(a) - dateOf(b) : dateOf(b) - dateOf(a));
    return sorted;
  }
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
  let signature = $state((typeof localStorage !== 'undefined' && localStorage.getItem('emeil-signature')) || '');
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
  function sanitizeGraphHtml(html: string): string {
    const container = document.createElement('div');
    container.innerHTML = html;
    const dangerous = container.querySelectorAll('script,iframe,object,embed,form,link,meta,base');
    dangerous.forEach((el) => el.remove());
    container.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'src') el.removeAttribute(attr.name);
      });
    });
    container.querySelectorAll('img').forEach((img) => { img.removeAttribute('src'); img.alt = img.alt || 'Imagen remota bloqueada'; });
    return container.innerHTML;
  }
  function buildQuoteBody(source: string) { const text = stripHtmlToText(source).slice(0, 2000); return `<blockquote class="original-quote">${escapeForHtml(text).replace(/\n/g, '<br>') || '(sin contenido)'}</blockquote>`; }
  function parseAddressList(raw: string | null | undefined): string[] {
    if (!raw) return [];
    const emails = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
    return [...new Set(emails.map((email) => email.toLowerCase()))];
  }
  function openReply(mode: 'imap' | 'graph', all = false) { openCompose(); const source = mode === 'imap' ? activeRealMessage : activeGraphMessage; if (!source) return; const from = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).from : (source as import('./lib/graph').GraphMessage).sender;
    const rawTo = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).toRecipients : (source as import('./lib/graph').GraphMessage).toRecipients;
    const rawCc = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).ccRecipients : null;
    const senderEmail = extractEmailAddress(from);
    composeSubject = /^re\s*:/i.test(source.subject) ? source.subject : `Re: ${source.subject}`;
    if (all) {
      const self = activeAccount?.email?.toLowerCase();
      const others = parseAddressList(rawTo).filter((email) => email !== self && email !== senderEmail);
      const ccs = parseAddressList(rawCc).filter((email) => email !== self && email !== senderEmail);
      composeTo = [...new Set([senderEmail, ...others])].join(', ');
      composeCc = ccs.join(', ');
    } else {
      composeTo = senderEmail;
    }
    const dateStr = mode === 'imap' ? ((source as import('./lib/imap').ImapMessageContent).receivedAt ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date((source as import('./lib/imap').ImapMessageContent).receivedAt!)) : 'fecha desconocida') : ((source as import('./lib/graph').GraphMessage).receivedAt ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date((source as import('./lib/graph').GraphMessage).receivedAt!)) : 'fecha desconocida'); const body = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).text : ((source as import('./lib/graph').GraphMessage).body || (source as import('./lib/graph').GraphMessage).preview || ''); composeHtml = `<p><br></p>${buildQuoteHeader(from, dateStr)}${buildQuoteBody(body)}`; composeNotice = all ? `Respondiendo a todos: ${from}` : `Respondiendo a ${from}`; }
  function openForward(mode: 'imap' | 'graph') { openCompose(); const source = mode === 'imap' ? activeRealMessage : activeGraphMessage; if (!source) return; const from = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).from : (source as import('./lib/graph').GraphMessage).sender; const dateStr = mode === 'imap' ? ((source as import('./lib/imap').ImapMessageContent).receivedAt || '') : ((source as import('./lib/graph').GraphMessage).receivedAt || ''); const body = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).text : ((source as import('./lib/graph').GraphMessage).body || (source as import('./lib/graph').GraphMessage).preview || ''); composeTo = ''; composeSubject = /^fwd\s*:/i.test(source.subject) || /^reenv/i.test(source.subject) ? source.subject : `Fwd: ${source.subject}`; composeHtml = `<p><br></p><p class="quote-header">---------- Mensaje reenviado ----------<br>De: ${escapeForHtml(from)}<br>Asunto: ${escapeForHtml(source.subject)}<br>Fecha: ${escapeForHtml(dateStr)}</p>${buildQuoteBody(body)}`; composeNotice = `Reenviando: ${source.subject}`; }
  function handlePaste(event: ClipboardEvent) { event.preventDefault(); const text = event.clipboardData?.getData('text/plain') || ''; document.execCommand('insertText', false, text); }
  async function addAttachments() { const selected = await open({ multiple: true, directory: false, filters: [{ name: 'Archivos', extensions: ['*'] }] }); const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : []; const inspected = []; for (const path of paths) { try { const info = await inspectAttachment(path); inspected.push({ name: info.name, size: info.size, type: info.contentType, path }); } catch (error) { composeNotice = String(error); } } composeAttachments = [...composeAttachments, ...inspected].slice(0, 10); }
  function removeAttachment(name: string) { composeAttachments = composeAttachments.filter((item) => item.name !== name); }
  function formatBytes(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  async function saveDraft(auto = false) {
    const localDraft = { to: composeTo, cc: composeCc, bcc: composeBcc, subject: composeSubject, html: composeHtml, attachments: composeAttachments };
    localStorage.setItem('emeil-draft', JSON.stringify(localDraft));
    try {
      if (!activeAccount) { composeNotice = auto ? t('compose.autosaved') : 'Borrador guardado en este dispositivo.'; return; }
      const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === activeAccount!.email);
      if (!record) { composeNotice = auto ? t('compose.autosaved') : 'Borrador guardado en este dispositivo.'; return; }
      const to = composeTo.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
      const cc = composeCc.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
      const bcc = composeBcc.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
      const html = cleanComposeHtml(composeHtml);
      if (activeProvider === 'microsoft-graph') {
        const clientKey = record.oauthClientId || microsoftClientId;
        if (!clientKey) { composeNotice = 'Borrador guardado en este dispositivo (falta Client ID).'; return; }
        await createGraphDraft({ accountId: `microsoft:${clientKey}`, to, cc, bcc, subject: composeSubject, html, attachments: [] });
        composeNotice = 'Borrador guardado en Borradores (Microsoft 365).';
      } else if (activeProvider === 'imap' && draftsFolder) {
        await saveImapDraft({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername || record.emailAddress, mailbox: draftsFolder, to, cc, bcc, subject: composeSubject, html });
        composeNotice = auto ? t('compose.autosaved') : `Borrador guardado en «${draftsFolder}».`;
      } else {
        composeNotice = auto ? t('compose.autosaved') : 'Borrador guardado en este dispositivo.';
      }
    } catch (error) { composeNotice = `Borrador local guardado, pero no en el servidor: ${String(error)}`; }
  }

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
  function handleMenuKeydown(event: KeyboardEvent) {    event.stopPropagation();
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
  // Atajos estilo Outlook: Ctrl/Cmd+N redactar, F buscar, R responder, 1/2/3 vistas.
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 'n') { event.preventDefault(); openCompose(); return; }
      if (key === 'f') { event.preventDefault(); document.querySelector<HTMLInputElement>('.top-search input')?.focus(); return; }
      if (key === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('.top-search input')?.focus(); return; }
      if (key === 'r') { event.preventDefault(); if (activeProvider === 'microsoft-graph' && activeGraphMessage) openReply('graph'); else if (activeRealMessage) openReply('imap'); return; }
      if (key === '1') { event.preventDefault(); activeView = 'mail'; return; }
      if (key === '2') { event.preventDefault(); activeView = 'calendar'; return; }
      if (key === '3') { event.preventDefault(); activeView = 'contacts'; return; }
      if (key === '4') { event.preventDefault(); settingsOpen = true; return; }
    }
    if (event.key !== 'Escape') return;
    if (sortMenuOpen) sortMenuOpen = false;
    if (contextMenu) contextMenu = null;
    else if (settingsOpen) settingsOpen = false;
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
  let microsoftClientId = $state(MICROSOFT_CLIENT_ID);
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
  let activeContentMode = $state<'text' | 'html'>('text');
  let unifiedInbox = $state(false);
  // --- Hilos de conversación ------------------------------------------------
  let threadView = $state(false);
  let expandedThreads = $state<Set<string>>(new Set());
  function normalizeSubject(subject: string): string {
    return subject.replace(/^(re|fwd|fw|rv|res|respuesta|reenviado)\s*:\s*/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  interface ThreadGroup { key: string; messages: any[]; latest: any; count: number; unreadCount: number; }
  function groupThreads(list: any[], keyOf: (item: any) => string, dateOf: (item: any) => number): ThreadGroup[] {
    const groups = new Map<string, any[]>();
    for (const item of list) {
      const key = keyOf(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    const threads: ThreadGroup[] = [];
    for (const [key, messages] of groups) {
      messages.sort((a, b) => dateOf(b) - dateOf(a));
      threads.push({ key, messages, latest: messages[0], count: messages.length, unreadCount: messages.filter((m) => m.unread ?? m.mail?.unread).length });
    }
    threads.sort((a, b) => dateOf(b.latest) - dateOf(a.latest));
    return threads;
  }
  function toggleThread(key: string) {
    const next = new Set(expandedThreads);
    if (next.has(key)) next.delete(key); else next.add(key);
    expandedThreads = next;
  }
  // --- Snooze: posponer un mensaje y despertarlo después -----------------
  let snoozedKeys = $state<Set<string>>(new Set(JSON.parse(localStorage.getItem('emeil-snoozed') || '[]')));
  let snoozeMenuOpen = $state(false);
  function snoozeMessage(hours: number) {
    const mail = activeRealMessage ?? activeGraphMessage;
    if (!mail) return;
    const key = 'imap' in mail ? `imap:${(mail as any).uid}` : `graph:${(mail as any).id}`;
    const entry = { key, wakeAt: Date.now() + hours * 3600_000 };
    snoozedKeys = new Set([...snoozedKeys, key]);
    localStorage.setItem('emeil-snoozed', JSON.stringify([...snoozedKeys]));
    localStorage.setItem(`emeil-snooze-${key}`, String(entry.wakeAt));
    snoozeMenuOpen = false;
    activeRealMessage = null; activeGraphMessage = null; mobileReadingOpen = false;
    syncMessage = `Pospuesto por ${hours >= 24 ? '1 día' : hours + ' hora(s)'}.`;
  }
  async function applyRulesToMessages(messages: any[]) {
    if (!messages.length) return;
    const rules = loadRules().filter(r=>r.enabled);
    if (!rules.length) return;
    const toArchive: any[] = [];
    const toDelete: any[] = [];
    for (const mail of messages) {
      const matches = getMatchingRules(mail, rules);
      for (const rule of matches) {
        for (const act of rule.actions) {
          if (act.type === 'archive') toArchive.push(mail);
          else if (act.type === 'delete') toDelete.push(mail);
          else if (act.type === 'markRead') { try { const saved = await listAccounts(); const record = saved.find(r=>r.emailAddress === activeAccount?.email); if (record && activeProvider !== 'microsoft-graph') await setImapSeen({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: mail.mailbox || selectedMailbox, uid: mail.uid, seen: true }); } catch {} }
        }
      }
    }
    // Best-effort: archive/delete for IMAP
    for (const mail of toArchive) {
      try {
        const saved = await listAccounts();
        const record = saved.find(r=>r.emailAddress === activeAccount?.email);
        if (!record || activeProvider === 'microsoft-graph') continue;
        if (!archiveFolder) continue;
        await moveImapMessage({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: mail.mailbox || selectedMailbox, destination: archiveFolder, uid: mail.uid });
        syncedMessages = syncedMessages.filter(m=>m.uid !== mail.uid);
      } catch {}
    }
    for (const mail of toDelete) {
      try {
        const saved = await listAccounts();
        const record = saved.find(r=>r.emailAddress === activeAccount?.email);
        if (!record || activeProvider === 'microsoft-graph') continue;
        await deleteImapMessage({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: mail.mailbox || selectedMailbox, uid: mail.uid });
        syncedMessages = syncedMessages.filter(m=>m.uid !== mail.uid);
      } catch {}
    }
  }

function wakeSnoozed() {
    const now = Date.now();
    const expired: string[] = [];
    for (const key of snoozedKeys) {
      const wakeAt = Number(localStorage.getItem(`emeil-snooze-${key}`) || 0);
      if (wakeAt > 0 && wakeAt <= now) {
        expired.push(key);
        localStorage.removeItem(`emeil-snooze-${key}`);
      }
    }
    if (expired.length) {
      snoozedKeys = new Set([...snoozedKeys].filter((key) => !expired.includes(key)));
      localStorage.setItem('emeil-snoozed', JSON.stringify([...snoozedKeys]));
      syncActiveAccount(); // refresca la lista con los mensajes despertados
      syncMessage = `${expired.length} mensaje(s) despertado(s) del snooze.`;
    }
  }
  $effect(() => { const id = window.setInterval(wakeSnoozed, 30_000); return () => window.clearInterval(id); });
  function isSnoozed(key: string): boolean { return snoozedKeys.has(key); }
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
  let suggestField = $state<'' | 'to' | 'cc' | 'bcc'>('');
  let suggestIndex = $state(0);
  const suggestions = $derived((() => {
    if (!suggestField) return [];
    const query = (suggestField === 'to' ? composeTo : suggestField === 'cc' ? composeCc : composeBcc).split(/[;,]/).pop()?.trim().toLowerCase() ?? '';
    if (query.length < 1) return [];
    return contacts
      .map((contact) => ({ name: contact.displayName, email: contact.emailAddresses[0]?.address ?? '' }))
      .filter((contact) => contact.email && (!query || contact.email.toLowerCase().includes(query) || contact.name.toLowerCase().includes(query)))
      .slice(0, 6);
  })());
  function openSuggestions(field: 'to' | 'cc' | 'bcc') { suggestField = field; suggestIndex = 0; }
  function closeSuggestions() { suggestField = ''; }
  function pickSuggestion(email: string) {
    const current = suggestField === 'to' ? composeTo : suggestField === 'cc' ? composeCc : composeBcc;
    const parts = current.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
    parts.pop();
    parts.push(email);
    if (suggestField === 'to') composeTo = parts.join(', ');
    else if (suggestField === 'cc') composeCc = parts.join(', ');
    else composeBcc = parts.join(', ');
    closeSuggestions();
  }
  function handleSuggestKeydown(event: KeyboardEvent) {
    if (!suggestField || !suggestions.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); suggestIndex = (suggestIndex + 1) % suggestions.length; }
    else if (event.key === 'ArrowUp') { event.preventDefault(); suggestIndex = (suggestIndex - 1 + suggestions.length) % suggestions.length; }
    else if (event.key === 'Enter' && suggestions[suggestIndex]) { event.preventDefault(); pickSuggestion(suggestions[suggestIndex].email); }
    else if (event.key === 'Escape') { closeSuggestions(); }
  }

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
  let helpOpen = $state(false);
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
  let configuredAccounts = $state<{ name: string; email: string; provider: string }[]>([]);
  let activeAccount = $state<{ name: string; email: string; provider: string } | null>(null);
  async function loadSavedAccounts() {
    try {
      const saved = await listAccounts();
      if (saved.length) {
        configuredAccounts = saved.map((account) => ({ name: account.displayName, email: account.emailAddress, provider: account.provider.toUpperCase() }));
        const remembered = localStorage.getItem('emeil-active-account');
        activeAccount = configuredAccounts.find((account) => account.email === remembered) ?? configuredAccounts[0];
      } else {
        // Onboarding: sin cuentas configuradas, el asistente se abre solo.
        setupOpen = true; setupStep = 'provider';
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
    // Nueva cuenta: la primera sincronización marca la línea base de notificaciones.
    knownMessageIds = new Set(); notifyBaselineReady = false; serverSearchActive = false;
    if (account.provider === 'MICROSOFT-GRAPH') syncGraphAccount(); else if (account.provider === 'POP3') syncPop3Account(); else syncImapAccount();
  }
  function chooseProvider(provider: MailProvider) { setup = initialSetup(provider); setupStep = 'details'; setupError = ''; setupInfo = ''; }
  function displayTime(date: string | null) { return date ? new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(new Date(date)) : '—'; }
  async function toggleCachedState(mail: CachedMessage, field: 'unread' | 'starred') {
    mail[field] = !mail[field];
    await updateCachedMessageState({ accountId: mail.accountId, mailbox: mail.mailbox, uid: mail.uid, [field]: mail[field] });
    void updateTrayBadge();
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
        activeRealMessage = { uid: mail.uid, subject: content.subject || mail.subject, from: content.from || '(remitente desconocido)', toRecipients: null, ccRecipients: null, receivedAt: content.receivedAt, text: content.text, html: null, hasAttachments: false, attachments: [] };
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
    try { const messages = await listGraphMessages(`microsoft:${clientId}`, clientId, 'common', 30); unifiedMessages = messages.map((message) => ({ id: message.id, accountId: record.id, provider: 'microsoft-graph', mailbox: 'INBOX', subject: message.subject, sender: message.sender, preview: message.preview, receivedAt: message.receivedAt, unread: !message.isRead, starred: false, hasAttachments: message.hasAttachments, conversationId: message.conversationId })); const freshOnes = reportNewMessages(messages.map((message) => ({ id: `graph:${message.id}`, author: message.sender, subject: message.subject, preview: message.preview }))); if (freshOnes.length > 0) notifyNewMail(freshOnes); syncMessage = `Microsoft Graph: ${unifiedMessages.length} mensajes.`; } catch (error) { syncMessage = String(error); } finally { syncing = false; void updateTrayBadge(); }
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
        if (fresh.length) void applyRulesToMessages(fresh);
        await upsertCachedMessages(syncedMessages);
        const freshOnes = reportNewMessages(syncedMessages.map((message) => ({ id: `imap:${message.uid}`, author: message.from, subject: message.subject, preview: message.preview })));
        if (freshOnes.length > 0) notifyNewMail(freshOnes);
      }
      syncMessage = `Sincronizado: ${syncedFolders.length} carpetas y ${syncedMessages.length} mensajes.`;
    } catch (error) { syncMessage = String(error); }
    finally { syncing = false; void updateTrayBadge(); }
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
      const freshOnes = reportNewMessages(rows.map((row) => ({ id: `pop3:${row.pop3Uidl}`, author: row.from, subject: row.subject, preview: row.preview })));
      if (freshOnes.length > 0) notifyNewMail(freshOnes);
      // POP3 solo expone la bandeja: las carpetas especiales no aplican.
      syncedFolders = [{ name: 'INBOX', delimiter: null, flags: [], specialUse: 'Inbox' }];
      sentFolder = null; draftsFolder = null; archiveFolder = 'Archive';
      selectedMailbox = 'INBOX';
      syncMessage = `POP3: ${rows.length} mensajes.`;
    } catch (error) { syncMessage = String(error); }
    finally { syncing = false; void updateTrayBadge(); }
  }
  // --- Sincronización automática y notificaciones ---------------------------
  // Cada N minutos (localStorage "emeil-sync-interval-min", por defecto 5) y
  // al enfocar la ventana se sincroniza la cuenta activa si no hay una en curso.
  let lastAutoSyncAt = 0;
  function syncActiveAccount() {
    if (!activeAccount) return;
    if (activeProvider === 'microsoft-graph') syncGraphAccount();
    else if (activeProvider === 'pop3') syncPop3Account();
    else syncImapAccount();
  }
  function maybeAutoSync() {
    if (!activeAccount || syncing || syncIntervalMin === 0) return;
    if (Date.now() - lastAutoSyncAt < syncIntervalMin * 60_000) return;
    lastAutoSyncAt = Date.now();
    syncActiveAccount();
  }
  $effect(() => { const id = window.setInterval(maybeAutoSync, 30_000); return () => window.clearInterval(id); });
  // Al abrir Ajustes se refresca la lista real de cuentas guardadas.
  $effect(() => { if (settingsOpen) void loadSettingsAccounts(); });

  // Detección de correo nuevo: la primera sincronización de cada cuenta es la
  // línea base; a partir de ahí, los ids nuevos notifican si la app no está
  // en foco (si el usuario está mirando la app, el banner ya lo informa).
  let knownMessageIds = new Set<string>();
  let notifyBaselineReady = false;
  function reportNewMessages(messages: NewMailSummary[]): NewMailSummary[] {
    const fresh = messages.filter((message) => !knownMessageIds.has(message.id));
    for (const message of fresh) knownMessageIds.add(message.id);
    if (!notifyBaselineReady) { notifyBaselineReady = true; return []; }
    return fresh;
  }
  function notifyNewMail(messages: NewMailSummary[]) {
    if (!notificationsEnabled || !document.hidden) return;
    void notifyNewMailDesktop(messages);
  }

  // --- Búsqueda en el servidor (IMAP SEARCH / Graph $search) -----------------
  let serverSearchActive = $state(false);
  let serverSearching = $state(false);
  async function runServerSearch() {
    const query = search.trim();
    if (query.length < 2 || !activeAccount || serverSearching) return;
    serverSearching = true;
    try {
      const saved = await listAccounts(); const record = saved.find((item) => item.emailAddress === activeAccount!.email);
      if (!record) { syncMessage = 'No se encontró la configuración de la cuenta.'; return; }
      if (activeProvider === 'imap') {
        const results = await searchImapMessages({ accountId: record.id, host: record.incomingHost, port: record.incomingPort, security: record.incomingSecurity, username: record.incomingUsername, mailbox: selectedMailbox, query });
        serverSearchActive = true;
        // Los resultados reemplazan la vista (sin tocar la caché local).
        syncedMessages = results.map((message) => ({ ...message, accountId: record.id, mailbox: selectedMailbox, text: null, starred: false, cachedAt: new Date().toISOString() }));
        syncMessage = t('search.results', { count: results.length, query, mailbox: selectedMailbox });
      } else if (activeProvider === 'microsoft-graph') {
        const clientKey = record.oauthClientId || microsoftClientId;
        if (!clientKey) { syncMessage = 'Falta el Client ID de Microsoft para buscar en el servidor.'; return; }
        const messages = await listGraphMessages(`microsoft:${clientKey}`, clientKey, 'common', 30, query);
        unifiedMessages = messages.map((message) => ({ id: message.id, accountId: record.id, provider: 'microsoft-graph' as const, mailbox: 'INBOX', subject: message.subject, sender: message.sender, preview: message.preview, receivedAt: message.receivedAt, unread: !message.isRead, starred: false, hasAttachments: message.hasAttachments, conversationId: message.conversationId }));
        serverSearchActive = true;
        syncMessage = t('search.results', { count: messages.length, query, mailbox: 'Microsoft 365' });
      } else {
        syncMessage = 'La búsqueda en el servidor no está disponible para POP3 (protocolo de solo descarga).';
      }
    } catch (error) { syncMessage = String(error); }
    finally { serverSearching = false; }
  }
  function exitServerSearch() { serverSearchActive = false; syncActiveAccount(); }
  // --- Integración con el sistema ---------------------------------------------
  function escapeHtml(text: string) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // mailto: (deep link del SO) → abre el redactor precargado, como Outlook.
  function handleMailto(raw: string) {
    if (!/^mailto:/i.test(raw)) return;
    const [toPart, queryPart = ''] = raw.slice(7).split('?');
    const params = new URLSearchParams(queryPart);
    composeTo = decodeURIComponent(toPart);
    composeCc = params.get('cc') ?? '';
    composeBcc = params.get('bcc') ?? '';
    composeSubject = params.get('subject') ?? '';
    const body = params.get('body') ?? '';
    composeHtml = body ? body.split(/\r?\n/).map(escapeHtml).join('<br>') : '';
    composeAttachments = [];
    composeNotice = '';
    composeOpen = true;
    mobileReadingOpen = false;
  }
  if (isTauri()) {
    void onOpenUrl((urls) => { for (const url of urls) handleMailto(url); });
    void listen<string>('tray-action', (event) => {
      if (event.payload === 'compose') openCompose();
      if (event.payload === 'sync') syncActiveAccount();
    });
  }
  // Tooltip de la bandeja con los no leídos de la cuenta activa.
  async function updateTrayBadge() {
    if (!isTauri()) return;
    const unread = syncedMessages.filter((message) => message.unread).length + unifiedMessages.filter((message) => message.unread).length;
    try { await tauriInvoke('set_tray_badge', { unread }); } catch { /* la bandeja es opcional */ }
  }
  // Autoguardado del borrador cada 30 s mientras el redactor está abierto.
  let lastDraftSnapshot = '';
  let autoSavingDraft = false;
  $effect(() => {
    if (!composeOpen) return;
    const id = window.setInterval(async () => {
      const snapshot = JSON.stringify([composeTo, composeCc, composeBcc, composeSubject, composeHtml]);
      if (snapshot === lastDraftSnapshot || autoSavingDraft) return;
      lastDraftSnapshot = snapshot; autoSavingDraft = true;
      try { await saveDraft(true); } catch { /* el guardado manual sigue disponible */ } finally { autoSavingDraft = false; }
    }, 30_000);
    return () => window.clearInterval(id);
  });

// --- Panel de configuración (ventana flotante, estilo del asistente) ------
  let settingsOpen = $state(false);
  let rules = $state<MailRule[]>(loadRules());
  let rulesDirty = $state(false);
  let savedAccountRecords = $state<AccountRecord[]>([]);
  let syncIntervalMin = $state(Math.max(0, parseInt(localStorage.getItem('emeil-sync-interval-min') ?? '5', 10) || 0));
  let notificationsEnabled = $state(localStorage.getItem('emeil-notifications') !== 'off');
  let settingsNotice = $state('');
  let locale = $state<Locale>(getLocale());
  async function loadSettingsAccounts() {
    try { savedAccountRecords = await listAccounts(); } catch { savedAccountRecords = []; }
  }
  async function removeAccount(record: AccountRecord) {
    if (!confirm(t('settings.deleteConfirm', { email: record.emailAddress }))) return;
    try {
      await deleteAccount(record.id);
      await deleteCredential(record.id).catch(() => undefined);
      if (activeAccount?.email === record.emailAddress) { activeAccount = null; localStorage.removeItem('emeil-active-account'); }
      await loadSavedAccounts();
      await loadSettingsAccounts();
      settingsNotice = t('settings.deleted');
    } catch (error) { settingsNotice = String(error); }
  }
  function persistSyncInterval() { localStorage.setItem('emeil-sync-interval-min', String(syncIntervalMin)); settingsNotice = t('settings.saved'); }
  let updateInfo = $state<UpdateInfo | null>(null);
  let updateBusy = $state(false);
  async function checkUpdates() {
    if (updateBusy) return;
    updateBusy = true; updateInfo = null; settingsNotice = '';
    try {
      updateInfo = await checkAppUpdate();
      settingsNotice = updateInfo.available ? t('settings.updateAvailable', { version: updateInfo.version, current: updateInfo.currentVersion }) : t('settings.upToDate', { version: updateInfo.currentVersion });
    } catch (error) { settingsNotice = t('settings.updatesFailed') + ' ' + String(error); }
    finally { updateBusy = false; }
  }
  async function installUpdate() {
    if (updateBusy || !updateInfo?.available) return;
    updateBusy = true; settingsNotice = t('settings.installing');
    try {
      await installAppUpdate();
      // Si retorna sin reiniciar, el flujo de instalación no completó:
      // se rehabilita el botón para reintentar.
      settingsNotice = t('settings.updatesFailed');
    } catch (error) { settingsNotice = String(error); }
    finally { updateBusy = false; }
  }
  function persistNotifications() { localStorage.setItem('emeil-notifications', notificationsEnabled ? 'on' : 'off'); settingsNotice = t('settings.saved'); }
  function saveSignature() { localStorage.setItem('emeil-signature', signature); settingsNotice = t('settings.signatureSaved'); }
  function applyLanguage(next: Locale) { setLocale(next); window.location.reload(); }
  function resetLocalPreferences() {
    if (!confirm(t('settings.resetConfirm'))) return;
    for (const key of ['emeil-theme', 'emeil-dark-mode', 'emeil-locale', 'emeil-sync-interval-min', 'emeil-notifications', 'emeil-signature', 'emeil-draft']) localStorage.removeItem(key);
    window.location.reload();
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
    const attempt = ++oauthAttempt;
    const clientId = (microsoftClientId || MICROSOFT_CLIENT_ID).trim();
    oauthBusy = true; setupError = ''; setupInfo = 'Abriendo la ventana de inicio de sesión de Microsoft…';
    try {
      const result = await startMicrosoftLoginWindow(clientId, MICROSOFT_TENANT);
      oauthState = result.state;
      setupInfo = 'Inicia sesión con tu cuenta de Hotmail, Outlook, Live o Microsoft 365. La ventana se cerrará sola al terminar.';
      const status = await waitForMicrosoftAuthorization(clientId, MICROSOFT_TENANT, result.state, {
        isCurrent: () => attempt === oauthAttempt,
        onTick: (elapsed) => { if (attempt === oauthAttempt) setupInfo = `Esperando la autorización de Microsoft… (${Math.round(elapsed / 1000)} s)`; }
      });
      if (status.status === 'stale') return;
      if (status.status !== 'authorized') { setupError = status.message; return; }
      if (!status.email) { setupError = 'Microsoft no informó el correo de la cuenta autorizada.'; return; }
      setup.displayName = 'Microsoft 365'; setup.emailAddress = status.email; setup.provider = 'microsoft-graph';
      await saveMicrosoftAccount({ emailAddress: status.email, displayName: 'Microsoft 365', clientId, tenant: MICROSOFT_TENANT });
      await loadSavedAccounts();
      const connected = configuredAccounts.find((account) => account.email === status.email);
      if (connected) selectAccount(connected);
      setupOpen = false; setupStep = 'provider'; setupInfo = '';
      syncMessage = `Cuenta Microsoft conectada: ${status.email}`;
    }
    catch (error) { setupError = String(error); }
    finally { if (attempt === oauthAttempt) oauthBusy = false; }
  }
  async function startGoogleLogin() {
    const attempt = ++oauthAttempt;
    oauthBusy = true; setupError = ''; setupInfo = 'Abriendo el navegador para la sesión de Google…';
    try {
      const result = await startGoogleOauth();
      oauthState = result.state;
      setupInfo = 'Inicia sesión con tu cuenta de Gmail en el navegador que se abrió.';
      const status = await waitForGoogleAuthorization(result.state, {
        isCurrent: () => attempt === oauthAttempt,
        onTick: (elapsed) => { if (attempt === oauthAttempt) setupInfo = `Esperando la autorización de Google… (${Math.round(elapsed / 1000)} s)`; }
      });
      if (status.status === 'stale') return;
      if (status.status !== 'authorized') { setupError = status.message; return; }
      if (!status.email) { setupError = 'Google no informó el correo de la cuenta autorizada.'; return; }
      setup.displayName = 'Gmail'; setup.emailAddress = status.email; setup.provider = 'google';
      await saveGoogleAccount({ emailAddress: status.email, displayName: 'Gmail' });
      await loadSavedAccounts();
      const connected = configuredAccounts.find((account) => account.email === status.email);
      if (connected) selectAccount(connected);
      setupOpen = false; setupStep = 'provider'; setupInfo = '';
      syncMessage = `Cuenta Gmail conectada: ${status.email}`;
    }
    catch (error) { setupError = String(error); }
    finally { if (attempt === oauthAttempt) oauthBusy = false; }
  }
  async function saveAccount(event: SubmitEvent) {
    event.preventDefault();
    if (setup.provider !== 'microsoft-graph' && setup.provider !== 'google') {
      const incomingError = validateServerSettings(setup.incoming, 'entrada');
      const outgoingError = setup.outgoing ? validateServerSettings(setup.outgoing, 'salida') : 'Configura el servidor SMTP de salida.';
      if (incomingError || outgoingError) { setupError = incomingError ?? outgoingError!; return; }
    }
    if (setup.provider === 'microsoft-graph') { setupOpen = false; setupStep = 'provider'; await loadSavedAccounts(); setupInfo = 'Cuenta Microsoft disponible tras la autorización OAuth.'; return; }
    if (setup.provider === 'google') { setupInfo = 'La cuenta de Gmail ya quedó guardada por el inicio de sesión de Google.'; return; }
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
  // Carpetas base reales: las carpetas del servidor aparecen en la sección nativa tras sincronizar.
  const folders = [
    { name: 'Bandeja de entrada', icon: 'inbox' },
    { name: 'Favoritos', icon: 'star' },
  ];
  
  const graphMails = $derived(unifiedMessages.map((message) => ({ sender: message.sender, address: message.sender, subject: message.subject, preview: message.preview, time: message.receivedAt || '', initials: message.sender.slice(0, 2).toUpperCase(), color: 'lavender', unread: message.unread, starred: message.starred, mailbox: message.mailbox, tag: 'Microsoft 365', hasAttachments: message.hasAttachments, uid: message.id, conversationId: message.conversationId ?? null })));
  const visibleMails = $derived(graphMails.map((mail, i) => ({ mail, i })).filter(({ mail }) => {
    const matchesQuery = `${mail.sender} ${mail.address} ${mail.subject} ${mail.preview}`.toLowerCase().includes(search.toLowerCase());
    const matchesFolder = currentFolder === 'Favoritos' ? mail.starred : true;
    const matchesUnread = filterUnread ? mail.unread : true;
    const matchesAttachments = filterHasAttachments ? mail.hasAttachments : true;
    return matchesQuery && matchesFolder && matchesUnread && matchesAttachments;
  }));
  function buildImapThreadKeyResolver(list: any[]) {
    const parentOf = new Map<string, string>();
    for (const mail of list) {
      if (mail.messageId) {
        parentOf.set(String(mail.messageId).toLowerCase(), String(mail.inReplyTo ?? '').toLowerCase());
      }
    }
    const rootOf = (id: string): string => {
      let current = id;
      const seen = new Set<string>();
      while (!seen.has(current)) {
        seen.add(current);
        const parent = parentOf.get(current);
        if (!parent) return current;
        current = parent;
      }
      return current;
    };
    return (mail: any) => mail.messageId ? `mid:${rootOf(String(mail.messageId).toLowerCase())}` : `subj:${normalizeSubject(mail.subject)}`;
  }
  const imapThreads = $derived.by(() => {
    if (!threadView) return [] as ThreadGroup[];
    const list = syncedMessages.filter((m) => !snoozedKeys.has(`imap:${m.uid}`));
    return groupThreads(list, buildImapThreadKeyResolver(list), (m) => m.receivedAt ? new Date(m.receivedAt).getTime() || 0 : 0);
  });
  const graphThreads = $derived(threadView ? groupThreads(visibleMails.filter((item) => !snoozedKeys.has(`graph:${item.mail.uid}`)), (item) => item.mail.conversationId ? `conv:${item.mail.conversationId}` : `subj:${normalizeSubject(item.mail.subject)}`, (item) => item.mail.time ? new Date(item.mail.time).getTime() || 0 : 0) : []);
  const todayLabel = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('es-CL');
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

<svelte:window oncontextmenu={(event) => openContextMenu(event)} onclick={closeContextMenu} onkeydown={handleWindowKeydown} onfocus={maybeAutoSync} /><div class="app-shell theme-{theme}" class:dark={dark} class:drawer-open={drawerOpen}>
  <a href="#main-content" class="skip-link">{t('app.skipContent')}</a>
  <a href="#sidebar" class="skip-link">{t('app.skipSidebar')}</a>
  <header class="topbar">
    <button class="menu-button" type="button" aria-label={t('topbar.menu')} aria-expanded={drawerOpen} aria-controls="sidebar" onclick={() => drawerOpen = !drawerOpen}><span class="menu-icon" aria-hidden="true"></span><span class="menu-icon" aria-hidden="true"></span><span class="menu-icon" aria-hidden="true"></span></button>
    <div class="brand"><div class="brand-mark"><span></span><span></span></div><span class="brand-name">e-meil</span></div>
    <div class="top-search"><span class="search-icon"><Icon name="search" size={15} /></span><input bind:value={search} placeholder="Buscar en todos los mensajes" aria-label="Buscar mensajes"/>{#if activeAccount && search.trim().length >= 2 && (activeProvider === 'imap' || activeProvider === 'microsoft-graph') && !serverSearchActive}<button class="search-server" type="button" onclick={runServerSearch} disabled={serverSearching} aria-label={t('search.server')}>{serverSearching ? '…' : t('search.server')}</button>{/if}<kbd>⌘ K</kbd></div>
    <div class="top-actions"><button class="icon-button" use:tooltip={t('topbar.help')} aria-label={t('topbar.help')} onclick={() => helpOpen = true}><Icon name="help" size={15} /></button><button class="icon-button settings" aria-label={t('topbar.theme')} use:tooltip={t('topbar.theme')} onclick={() => themeOpen = !themeOpen}><Icon name="palette" size={15} /></button>{#if themeOpen}<div class="theme-menu" role="dialog" aria-label="Elegir tema"><div class="theme-menu-title">{t('theme.title')}</div>{#each themes as option}<button class:theme-selected={theme === option.id} class="theme-option" onclick={() => setTheme(option.id)}><span class="theme-swatch" style={`--swatch:${option.color}`}></span><span><strong>{option.label}</strong><small>{option.description}</small></span>{#if theme === option.id}<b><Icon name="check" size={12} /></b>{/if}</button>{/each}<p class="theme-menu-note">{t('theme.note')}</p><button class="theme-option" role="switch" aria-checked={dark} onclick={() => setDark(!dark)}><span class="theme-swatch dark-swatch" aria-hidden="true"></span><span><strong>{t('theme.dark')}</strong><small>{dark ? t('theme.darkOn') : t('theme.darkOff')}</small></span>{#if dark}<b><Icon name="check" size={12} /></b>{/if}</button></div>{/if}{#if activeAccount}<button class="account" use:tooltip={activeAccount.email} onclick={() => themeOpen = false} onkeydown={(e) => { if (e.key === 'Enter') themeOpen = false; }}><div class="account-avatar">{activeAccount.email.slice(0,1).toUpperCase()}</div><div class="account-meta"><strong>{activeAccount.name}</strong><span>{activeAccount.email}</span><small>{activeAccount.provider === 'MICROSOFT-GRAPH' ? 'Microsoft 365' : activeAccount.provider === 'POP3' ? 'POP3' : 'IMAP'}</small></div></button>{/if}</div>
  </header>
  {#if drawerOpen}<div class="drawer-backdrop" role="presentation" aria-hidden="true" onclick={() => drawerOpen = false}></div>{/if}
  <div class="workspace">
    <nav class="rail" aria-label={t('rail.apps')}><button class="rail-item" class:active={activeView === 'mail'} use:tooltip={t('rail.mail')} aria-label={t('rail.mail')} onclick={() => activeView = 'mail'}><Icon name="mail" size={17} /><i></i></button><button class="rail-item" class:active={activeView === 'calendar'} use:tooltip={t('rail.calendar')} aria-label={t('rail.calendar')} onclick={() => activeView = 'calendar'}><Icon name="calendar" size={17} /></button><button class="rail-item" class:active={activeView === 'contacts'} use:tooltip={t('rail.contacts')} aria-label={t('rail.contacts')} onclick={() => activeView = 'contacts'}><Icon name="contacts" size={17} /></button><button class="rail-item" class:active={settingsOpen} use:tooltip={t('rail.settings')} aria-label={t('rail.settings')} onclick={() => settingsOpen = true}><Icon name="sliders" size={17} /></button><div class="rail-spacer"></div></nav>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-heading"><span>{t('sidebar.folders')}</span><button use:tooltip={t('sidebar.foldersOptions')} aria-label={t('sidebar.foldersOptions')}><Icon name="dots" size={13} /></button></div>
      <button class="compose-button" onclick={() => composeOpen = true}><Icon name="plus" size={14} /> {t('sidebar.compose')} <kbd>Ctrl N</kbd></button>
      <div class="folder-list">{#each folders as folder}<button class:folder-active={currentFolder === folder.name} class="folder" onclick={() => { currentFolder = folder.name; if (folder.name === 'Elementos enviados' && sentFolder) { selectedMailbox = sentFolder; syncImapAccount(sentFolder); } if (folder.name === 'Borradores' && draftsFolder) { selectedMailbox = draftsFolder; syncImapAccount(draftsFolder); } }}><span class="folder-icon"><Icon name={folder.icon} size={13} /></span><span>{folder.name}</span></button>{/each}{#if syncedFolders.length}<div class="native-folder-label">{t('sidebar.imapFolders')}</div>{#each syncedFolders as folder}<button class:folder-active={selectedMailbox === folder.name} class="folder native-folder" onclick={() => { selectedMailbox = folder.name; currentFolder = folder.name === sentFolder ? 'Elementos enviados' : folder.name; syncImapAccount(folder.name); }}><span class="folder-icon"><Icon name={folder.specialUse === 'Sent' ? 'send' : folder.specialUse === 'Archive' ? 'archive' : 'inbox'} size={13} /></span><span>{folder.name}</span>{#if folder.specialUse}<small class="special-folder-badge">{folder.specialUse}</small>{/if}</button>{/each}{/if}</div>
      <div class="sidebar-section"><div class="sidebar-heading"><span>{t('sidebar.accounts')}</span><button use:tooltip={t('sidebar.addAccount')} aria-label={t('sidebar.addAccount')}><Icon name="plus" size={13} /></button></div>{#each configuredAccounts as account}<div class="mail-account" class:mail-account-active={activeAccount?.email === account.email} onclick={() => selectAccount(account)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAccount(account); } }} role="button" tabindex="0" aria-label={`Activar cuenta ${account.email}`}><span class="provider-dot">{account.provider === 'MICROSOFT-GRAPH' ? 'ms' : account.provider === 'POP3' ? 'pop' : 'imap'}</span><span>{account.name}</span>{#if activeAccount?.email === account.email}<small class="active-badge"></small>{/if}</div><span class="account-email">{account.email}</span>{/each}<button class="add-account" onclick={() => { setupOpen = true; setupStep = 'provider'; }}>{t('sidebar.addAccountFull')}</button></div>
      
    </aside>
    <main class="mail-area" id="main-content">
      {#if activeView === 'mail'}
      <section class="message-list">
        <div class="list-header"><div><div class="eyebrow">{todayLabel}</div><h1>{currentFolder}{#if unifiedInbox} <span class="unified-chip">{t('list.unified')}</span>{/if}</h1><div class="inbox-subtitle">{t('list.subtitle')}</div></div><div class="list-header-actions"><label class="unified-toggle"><input type="checkbox" bind:checked={unifiedInbox} /> {t('list.unifiedLabel')}</label><label class="unified-toggle"><input type="checkbox" bind:checked={threadView} /> {t('list.threadView')}</label></div><div class="filter-dropdown"><button class="filter-button" aria-haspopup="menu" aria-expanded={filterMenuOpen} onclick={() => filterMenuOpen = !filterMenuOpen} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filterMenuOpen = !filterMenuOpen; } }}><Icon name="funnel" size={13} /> <span>{t('filters.trigger')}</span><Icon name="chevron-down" size={12} /></button>{#if filterMenuOpen}<div class="filter-menu" role="group" aria-label={t('filters.group')}><div class="filter-section"><label><input type="checkbox" bind:checked={filterUnread} onchange={() => filterMenuOpen = false} /> <span>No leídos</span></label></div><div class="filter-section"><label><input type="checkbox" bind:checked={filterHasAttachments} onchange={() => filterMenuOpen = false} /> <span>Con adjuntos</span></label></div>{#if filterUnread || filterHasAttachments}<button class="filter-clear" onclick={() => { filterUnread = false; filterHasAttachments = false; filterMenuOpen = false; }}>{t('filters.clear')}</button>{/if}</div>{/if}</div></div>
        <div class="list-tools">{#if selectionMode}<div class="batch-bar"><button class="batch-btn" onclick={() => { selectedUids.clear(); selectionMode = false; }} aria-label="Cancelar selección">{t('common.cancel')}</button><span class="batch-count">{selectedUids.size} seleccionados</span><button class="batch-btn danger" onclick={() => batchAction('archive')}>{t('batch.archive')}</button><button class="batch-btn danger" onclick={() => batchAction('delete')}>{t('batch.delete')}</button></div>{:else}<button class="select-all" aria-label="Seleccionar" onclick={() => { selectionMode = true; selectedUids.clear(); visibleMails.forEach(({ mail }) => { const key = (mail as any).uid ?? (mail as any).id; selectedUids.add(key); }); }}></button><span>{t('list.select')}</span>{/if}{#if filterUnread || filterHasAttachments}<div class="active-filters" style="margin-left:auto;display:flex;gap:6px;align-items:center;font-size:10px;color:var(--muted)">{#if filterUnread}<span class="filter-pill"><Icon name="mail" size={12} /> {t('filters.unread')}</span>{/if}{#if filterHasAttachments}<span class="filter-pill"><Icon name="paperclip" size={12} /> {t('filters.attachments')}</span>{/if}</div>{/if}<div class="tool-spacer"></div><span class="list-count">{selectionMode ? selectedUids.size + ' seleccionados de ' : ''}{syncedMessages.length || visibleMails.length} mensajes</span><span class="sort-wrap"><button class="tool-icon" aria-haspopup="menu" aria-expanded={sortMenuOpen} aria-label="Ordenar" onclick={() => sortMenuOpen = !sortMenuOpen}><Icon name="sort" size={14} /></button>{#if sortMenuOpen}<div class="sort-menu" role="menu" aria-label="Ordenar lista"><button role="menuitem" class:sort-selected={sortKey === 'date-desc'} onclick={() => { sortKey = 'date-desc'; sortMenuOpen = false; }}>{t('sort.dateDesc')}</button><button role="menuitem" class:sort-selected={sortKey === 'date-asc'} onclick={() => { sortKey = 'date-asc'; sortMenuOpen = false; }}>{t('sort.dateAsc')}</button><button role="menuitem" class:sort-selected={sortKey === 'sender'} onclick={() => { sortKey = 'sender'; sortMenuOpen = false; }}>{t('sort.sender')}</button><button role="menuitem" class:sort-selected={sortKey === 'unread'} onclick={() => { sortKey = 'unread'; sortMenuOpen = false; }}>{t('sort.unread')}</button></div>{/if}</span><button class="tool-icon" title={t('common.refresh')} onclick={() => activeProvider === 'microsoft-graph' ? syncGraphAccount() : activeProvider === 'pop3' ? syncPop3Account() : syncImapAccount()} disabled={syncing}><Icon name="refresh" size={14} /></button></div>{#if syncMessage}<div class="sync-banner">{syncMessage}{#if serverSearchActive}<button class="search-exit" type="button" onclick={exitServerSearch}>{t('search.exit')}</button>{/if}</div>{/if}
        <div class="messages">{#if threadView && activeProvider !== 'microsoft-graph' && imapThreads.length}{#each imapThreads as thread (thread.key)}<div class="thread-card" class:thread-unread={thread.unreadCount > 0}><button class="thread-header" onclick={() => toggleThread(thread.key)}><span class="sender">{thread.latest.from}</span><span class="subject-line">{thread.latest.subject}</span><span class="thread-meta"><span class="thread-count">{thread.count}</span>{#if thread.unreadCount > 0}<span class="unread-dot"></span>{/if}<Icon name={expandedThreads.has(thread.key) ? 'chevron-down' : 'chevron-right'} size={12} /></span></button>{#if expandedThreads.has(thread.key)}<div class="thread-body">{#each thread.messages as mail (mail.uid)}<div class="thread-message"><button class="message-open" onclick={() => openRealMessage(mail)} aria-label={t('reading.open')}><span class="sender-avatar lavender">{messageInitials(mail.from)}</span><span class="message-content"><span class="message-top"><span class="sender">{mail.from}</span><span class="message-time">{displayTime(mail.receivedAt)}</span></span><span class="preview">{mail.preview}</span></span></button></div>{/each}</div>{:else}<div class="thread-preview">{thread.latest.preview || '(sin contenido)'}</div>{/if}</div>{/each}{:else if threadView && activeProvider === 'microsoft-graph' && graphThreads.length}{#each graphThreads as thread (thread.key)}<div class="thread-card" class:thread-unread={thread.unreadCount > 0}><button class="thread-header" onclick={() => toggleThread(thread.key)}><span class="sender">{thread.latest.mail?.sender}</span><span class="subject-line">{thread.latest.mail?.subject}</span><span class="thread-meta"><span class="thread-count">{thread.count}</span>{#if thread.unreadCount > 0}<span class="unread-dot"></span>{/if}<Icon name={expandedThreads.has(thread.key) ? 'chevron-down' : 'chevron-right'} size={12} /></span></button>{#if expandedThreads.has(thread.key)}<div class="thread-body">{#each thread.messages as item (item.i)}<div class="thread-message"><button class="message-open" onclick={() => openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage)} aria-label={t('reading.open')}><span class="sender-avatar lavender">{item.mail.initials}</span><span class="message-content"><span class="message-top"><span class="sender">{item.mail.sender}</span><span class="message-time">{item.mail.time}</span></span><span class="preview">{item.mail.preview}</span></span></button></div>{/each}</div>{:else}<div class="thread-preview">{thread.latest.mail?.preview || '(sin contenido)'}</div>{/if}</div>{/each}{:else if unifiedInbox && configuredAccounts.length > 1}{#each sortMessages([...syncedMessages.filter((m) => !snoozedKeys.has(`imap:${m.uid}`)).map((m) => ({ ...m, _origin: 'imap' as const })), ...visibleMails.filter((item) => !snoozedKeys.has(`graph:${item.mail.uid}`)).map((item) => ({ ...item.mail, _origin: 'graph' as const, _uid: item.mail.uid }))].filter((m) => (m as any).subject)) as mail ((mail as any).uid ?? (mail as any)._uid)}<article class:unread={(mail as any).unread} class="message-row"><button class="message-open" aria-label={t('reading.open')} onclick={() => { const target = (mail as any)._origin === 'graph' ? unifiedMessages.find((m) => m.id === (mail as any)._uid) : syncedMessages.find((m) => m.uid === (mail as any).uid); if (target) { if ((mail as any)._origin === 'graph') openGraphMessage(target as unknown as import('./lib/graph').GraphMessage); else openRealMessage(target as any); } }}><span class="row-check"></span></button><button type="button" class="star" aria-label={t('reading.favorite')}><Icon name="star" size={13} /></button><span class="sender-avatar lavender">{messageInitials((mail as any).from ?? (mail as any).sender)}</span><button class="message-open message-body-open" aria-label={t('reading.open')} onclick={() => { const target = (mail as any)._origin === 'graph' ? unifiedMessages.find((m) => m.id === (mail as any)._uid) : syncedMessages.find((m) => m.uid === (mail as any).uid); if (target) { if ((mail as any)._origin === 'graph') openGraphMessage(target as unknown as import('./lib/graph').GraphMessage); else openRealMessage(target as any); } }}><span class="sender-avatar lavender">{messageInitials((mail as any).from ?? (mail as any).sender)}</span><span class="message-content"><span class="message-top"><span class="sender">{(mail as any).from ?? (mail as any).sender}</span><span class="message-time">{displayTime((mail as any).receivedAt)}</span></span><span class="subject-line">{(mail as any).subject}</span><span class="preview">{(mail as any).preview}</span></span></button>{#if (mail as any)._origin}<span class="provider-dot" style="margin-left:auto;flex:none">{(mail as any)._origin === 'graph' ? 'ms' : 'imap'}</span>{/if}{#if (mail as any).unread}<span class="unread-dot"></span>{/if}</article>{/each}{:else if syncedMessages.length}{#each sortMessages(syncedMessages.filter((m) => !snoozedKeys.has(`imap:${m.uid}`))) as mail (mail.uid)}<article class:unread={mail.unread} class="message-row" oncontextmenu={(event) => openContextMenu(event, mail.uid)}>{#if selectionMode}<input type="checkbox" class="select-checkbox" checked={selectedUids.has(mail.uid)} onchange={() => { if (selectedUids.has(mail.uid)) selectedUids.delete(mail.uid); else selectedUids.add(mail.uid); }} />{:else}<button class="message-open" onclick={() => openRealMessage(mail)} aria-label={t('reading.open')}><span class="row-check"></span></button>{/if}<button type="button" class:starred={mail.starred} class="star" aria-label={t('reading.favorite')} onclick={(event) => { event.stopPropagation(); toggleCachedState(mail, 'starred'); }}><Icon name="star" size={13} /></button><span class="sender-avatar lavender">{messageInitials(mail.from)}</span><button class="message-open message-body-open" onclick={() => openRealMessage(mail)} aria-label={t('reading.open')}><span class="sender-avatar lavender">{messageInitials(mail.from)}</span><span class="message-content"><span class="message-top"><span class="sender">{mail.from}</span><span class="message-time">{displayTime(mail.receivedAt)}</span></span><span class="subject-line">{mail.subject}</span><span class="preview">{mail.preview || 'Sin vista previa disponible.'}</span></span></button>{#if mail.unread}<span class="unread-dot"></span>{/if}</article>{/each}{:else if visibleMails.length}{#each sortMessages(visibleMails.filter((item) => !snoozedKeys.has(`graph:${item.mail.uid}`))) as item (item.i)}<article class:unread={item.mail.unread} class="message-row">{#if selectionMode}<input type="checkbox" class="select-checkbox" checked={selectedUids.has(item.mail.uid ?? item.i)} onchange={() => { const key = item.mail.uid ?? item.i; if (selectedUids.has(key)) selectedUids.delete(key); else selectedUids.add(key); }} />{:else}<button class="message-open" aria-label="Abrir mensaje: {item.mail.subject}" onclick={() => openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage)}><span class="row-check"></span></button>{/if}<button type="button" class:starred={item.mail.starred} class="star" aria-label={item.mail.starred ? 'Quitar de favoritos' : 'Añadir a favoritos'} onclick={(event) => { event.stopPropagation(); unifiedMessages[item.i].starred = !unifiedMessages[item.i].starred; }}><Icon name="star" size={13} /></button><button class="message-open message-body-open" aria-label="Abrir mensaje: {item.mail.subject}" onclick={() => openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage)}><span class="sender-avatar {item.mail.color}">{item.mail.initials}</span><span class="message-content"><span class="message-top"><span class="sender">{item.mail.sender}</span><span class="message-time">{item.mail.time}</span></span><span class="subject-line">{item.mail.subject}{#if item.mail.tag}<span class="tag">{item.mail.tag}</span>{/if}</span><span class="preview">{item.mail.preview}</span></span></button>{#if item.mail.unread}<span class="unread-dot"></span>{/if}</article>{/each}{:else}<div class="empty-state">{t('list.emptyNoMessages')}</div>{/if}</div>
       
     
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
      <section class="reading-pane" class:reading-open={mobileReadingOpen}>{#if activeRealMessage}<div class="reading-toolbar"><div class="toolbar-left"><button class="pane-tool" title={t('common.backToList')} onclick={() => { activeRealMessage = null; mobileReadingOpen = false; }}><Icon name="back" size={14} /></button><span class="toolbar-divider"></span><span class="real-badge">IMAP</span></div><div class="toolbar-right"><span>{loadingMessage ? 'Cargando…' : 'Mensaje real'}</span></div></div><article class="email"><div class="email-category"><span class="category-dot"></span> {t('reading.imapAccount')} <span class="category-line"></span></div><div class="email-subject-row"><h2>{activeRealMessage.subject}</h2><span class="real-attachment">{activeRealMessage.hasAttachments ? t('reading.attachments') : ''}</span></div><div class="email-from"><div class="sender-avatar large lavender">{messageInitials(activeRealMessage.from)}</div><div class="from-info"><div class="from-name">{activeRealMessage.from}</div><span class="to-line">{t('reading.syncedFrom', { mailbox: selectedMailbox })}</span></div></div><div class="email-body real-body">{#if activeRealMessage.html && activeContentMode === 'html'}<div class="safe-content-notice">{t('reading.htmlSecureNotice')}</div>{:else}<div class="safe-content-notice">{t('reading.plainTextNotice')}</div>{/if}{#if activeRealMessage.attachments.length}<div class="real-attachments">{#each activeRealMessage.attachments as attachment}<div class="real-attachment-card"><Icon name="paperclip" size={14} /><div><strong>{attachment.filename}</strong><small>{attachment.contentType} · límite 25 MB</small></div><button class="download-attachment" onclick={() => downloadAttachment(attachment)} title={t('reading.saveAttachment')}><Icon name="download" size={14} /></button></div>{/each}</div>{/if}{#if activeRealMessage.html}{#if activeContentMode === 'html'}<div class="html-view" role="document">{@html sanitizeGraphHtml(activeRealMessage.html)}</div><button class="reply-button html-toggle" onclick={() => activeContentMode = 'text'}>{t('reading.viewText')}</button>{:else}<pre>{activeRealMessage.text || 'Este mensaje no contiene texto visible.'}</pre><button class="reply-button html-toggle" onclick={() => activeContentMode = 'html'}>{t('reading.viewHtml')}</button>{/if}{:else}<pre>{activeRealMessage.text || 'Este mensaje no contiene texto visible.'}</pre>{/if}<div class="email-actions"><span class="snooze-wrap"><button class="reply-button snooze-btn" aria-haspopup="menu" aria-expanded={snoozeMenuOpen} onclick={() => snoozeMenuOpen = !snoozeMenuOpen}><Icon name="clock" size={13} /> <span>{t('snooze.title')}</span></button>{#if snoozeMenuOpen}<div class="sort-menu snooze-menu" role="menu"><button role="menuitem" onclick={() => snoozeMessage(1)}>{t('snooze.1h')}</button><button role="menuitem" onclick={() => snoozeMessage(3)}>{t('snooze.3h')}</button><button role="menuitem" onclick={() => snoozeMessage(24)}>{t('snooze.tomorrow')}</button></div>{/if}</span><button class="reply-button" onclick={() => openReply('imap')}><Icon name="reply" size={13} /> <span>{t('common.reply')}</span></button><button class="reply-button reply-all" onclick={() => openReply('imap', true)}><Icon name="reply" size={13} /><b>+</b> <span>{t('compose.replyAll')}</span></button><button class="forward-button" onclick={() => openForward('imap')}><Icon name="forward" size={13} /> <span>{t('common.forward')}</span></button></div></div></article>{:else if activeGraphMessage}<div class="reading-toolbar"><div class="toolbar-left"><button class="pane-tool" title={t('common.backToList')} onclick={() => { activeGraphMessage = null; mobileReadingOpen = false; }}><Icon name="back" size={14} /></button><span class="toolbar-divider"></span><span class="real-badge">GRAPH</span><button class="pane-tool" title={t('batch.archive')} onclick={() => graphAction('archive')}><Icon name="archive" size={14} /></button><button class="pane-tool" title={t('batch.delete')} onclick={() => graphAction('delete')}><Icon name="trash" size={14} /></button></div></div><article class="email"><div class="email-category"><span class="category-dot"></span> {t('reading.ms365')} <span class="category-line"></span></div><div class="email-subject-row"><h2>{activeGraphMessage.subject}</h2><span class="real-attachment">{activeGraphMessage.hasAttachments ? t('reading.attachments') : ''}</span></div><div class="email-from"><div class="sender-avatar large lavender">{messageInitials(activeGraphMessage.sender)}</div><div class="from-info"><div class="from-name">{activeGraphMessage.sender}</div><span class="to-line">{t('reading.syncedFromGraph')}</span></div></div><div class="email-body real-body"><div class="safe-content-notice">{t('reading.graphSecureNotice')}</div>{#if activeGraphMessage.body && activeContentMode === 'html'}<div class="html-view" role="document">{@html sanitizeGraphHtml(activeGraphMessage.body)}</div><button class="reply-button html-toggle" onclick={() => activeContentMode = 'text'}>{t('reading.viewText')}</button>{:else}<pre>{activeGraphMessage.body && activeContentMode === 'text' ? stripHtmlToText(activeGraphMessage.body).slice(0, 2000) : (activeGraphMessage.body || activeGraphMessage.preview || 'Este mensaje no contiene texto visible.')}</pre>{#if activeGraphMessage.body}<button class="reply-button html-toggle" onclick={() => activeContentMode = 'html'}>{t('reading.viewHtml')}</button>{/if}{/if}</div><div class="email-actions"><span class="snooze-wrap"><button class="reply-button snooze-btn" aria-haspopup="menu" aria-expanded={snoozeMenuOpen} onclick={() => snoozeMenuOpen = !snoozeMenuOpen}><Icon name="clock" size={13} /> <span>{t('snooze.title')}</span></button>{#if snoozeMenuOpen}<div class="sort-menu snooze-menu" role="menu"><button role="menuitem" onclick={() => snoozeMessage(1)}>{t('snooze.1h')}</button><button role="menuitem" onclick={() => snoozeMessage(3)}>{t('snooze.3h')}</button><button role="menuitem" onclick={() => snoozeMessage(24)}>{t('snooze.tomorrow')}</button></div>{/if}</span><button class="reply-button" onclick={() => openReply('graph')}><Icon name="reply" size={13} /> <span>{t('common.reply')}</span></button><button class="reply-button reply-all" onclick={() => openReply('graph', true)}><Icon name="reply" size={13} /><b>+</b> <span>{t('compose.replyAll')}</span></button><button class="forward-button" onclick={() => openForward('graph')}><Icon name="forward" size={13} /> <span>{t('common.forward')}</span></button></div></article>{:else}<div class="empty-state">{t('common.emptyReading')}</div>{/if}</section>
    </main>
  </div>
</div>
{#if helpOpen}<Modal open={helpOpen} title={t('help.title')} onclose={() => helpOpen = false}><div class="help-shortcuts"><h4>{t('help.sectionKeys')}</h4><ul><li><kbd>Ctrl N</kbd> {t('help.newMail')}</li><li><kbd>Ctrl K</kbd> {t('help.search')}</li><li><kbd>Ctrl R</kbd> {t('help.reply')}</li><li><kbd>Ctrl 1-4</kbd> {t('help.views')}</li><li><kbd>Esc</kbd> {t('help.closePopups')}</li></ul><h4>{t('help.sectionMouse')}</h4><ul><li>{t('help.tray')}</li><li>{t('help.mailto')}</li><li>{t('help.sortTip')}</li></ul></div></Modal>{/if}
{#if sent}<div class="toast"><Icon name="check" size={13} /> <span>{t('reading.sent')}</span><button onclick={() => sent = false}>{t('common.undo')}</button></div>{/if}
{#if setupOpen}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) setupOpen = false; }}><section class="setup-window" aria-label={t('setup.windowLabel')}><aside class="setup-brand"><div class="setup-brand-mark"><svg width="22" height="19" viewBox="0 0 24 20" fill="none" aria-hidden="true"><path d="M3 5.5 12 12l9-6.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span class="setup-brand-name">e-meil</span><p class="setup-brand-tagline">{t('setup.tagline')}</p><ol class="setup-steps"><li class:active={setupStep === 'provider'} class:done={setupStep !== 'provider'}><span>01</span>{t('setup.step1')}</li><li class:active={setupStep === 'details'}><span>02</span>{t('setup.step2')}</li></ol><span class="setup-brand-version">v0.1.0 · MIT</span></aside><div class="setup-main"><header class="setup-header"><div><span class="setup-kicker">{t('setup.title')}</span><h2>{setupStep === 'provider' ? t('setup.pickTitle') : t('setup.detailsTitle')}</h2><p>{setupStep === 'provider' ? t('setup.pickSub') : t('setup.detailsSub')}</p></div><button class="setup-close" type="button" onclick={() => setupOpen = false} aria-label={t('common.close')}><Icon name="close" size={14} /></button></header>{#if setupStep === 'provider'}<div class="provider-options"><button class="provider-choice" onclick={() => chooseProvider('microsoft-graph')}><span class="provider-mark"><svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="2" y="10.5" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="10.5" width="7.5" height="7.5" rx="1.6"/></svg></span><strong>{t('setup.providerMs')}</strong><small>{t('setup.msLogin')}</small></button><button class="provider-choice" onclick={() => chooseProvider('google')}><span class="provider-mark"><svg width="18" height="14" viewBox="52 42 88 66" aria-hidden="true"><path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/><path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/><path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/></svg></span><strong>Gmail</strong><small>{t('setup.googleDesc')}</small></button><button class="provider-choice" onclick={() => chooseProvider('imap')}><span class="provider-mark"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="2.5"/><path d="M3.5 6.5 10 11l6.5-4.5"/></svg></span><strong>IMAP</strong><small>{t('setup.imapDesc')}</small></button><button class="provider-choice" onclick={() => chooseProvider('pop3')}><span class="provider-mark"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3.5" width="12.5" height="9.5" rx="2"/><path d="M3.5 5.5 8.25 9l4.75-3.5"/><path d="M16 8.5v7M13.5 13l2.5 2.5 2.5-2.5"/></svg></span><strong>POP3</strong><small>{t('setup.pop3Desc')}</small></button></div><p class="setup-note">{t('setup.note')}</p>{:else}<form class="account-form" onsubmit={saveAccount}><button type="button" class="back-link" onclick={() => setupStep = 'provider'}>{t('setup.changeType')}</button><div class="provider-badge">{#if setup.provider === 'microsoft-graph'}<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="2" y="10.5" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="10.5" width="7.5" height="7.5" rx="1.6"/></svg>{t('setup.badgeMs')}{:else if setup.provider === 'google'}<svg width="18" height="14" viewBox="52 42 88 66" aria-hidden="true"><path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/><path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/><path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/></svg>Gmail · {t('setup.badgeOauth')}{:else if setup.provider === 'imap'}<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="2.5"/><path d="M3.5 6.5 10 11l6.5-4.5"/></svg>IMAP · {t('setup.badgeManual')}{:else}<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3.5" width="12.5" height="9.5" rx="2"/><path d="M3.5 5.5 8.25 9l4.75-3.5"/><path d="M16 8.5v7M13.5 13l2.5 2.5 2.5-2.5"/></svg>POP3 · {t('setup.badgeManual')}{/if}</div>{#if setup.provider === 'imap' || setup.provider === 'pop3'}<div class="setup-grid"><label>{t('setup.displayName')}<input bind:value={setup.displayName} placeholder="Mi cuenta personal"/></label><label>{t('setup.email')}<input type="email" bind:value={setup.emailAddress} placeholder="nombre@ejemplo.com" required onblur={applySuggestions}/></label></div>{/if}{#if setup.provider === 'google'}<div class="oauth-explainer"><span><svg width="18" height="14" viewBox="52 42 88 66" aria-hidden="true"><path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/><path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/><path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/></svg></span><div><strong>{t('setup.secureLogin')}</strong><p>{t('setup.googleOauthExplainer')}</p><button type="button" class="oauth-button" onclick={startGoogleLogin} disabled={oauthBusy}>{oauthBusy ? t('common.loading') : t('setup.googleLoginButton')}</button><p class="oauth-privacy">{t('setup.googleOauthPrivacy')}</p></div></div>{:else if setup.provider !== 'microsoft-graph'}<div class="server-block"><h3>{t('setup.incomingServer', { provider: setup.provider.toUpperCase() })}</h3><div class="server-fields"><label>{t('setup.server')}<input bind:value={setup.incoming.host} placeholder="imap.ejemplo.com" required/></label><label>{t('setup.port')}<input type="number" bind:value={setup.incoming.port} required/></label></div><label>{t('setup.security')}<select bind:value={setup.incoming.security}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label><h3>{t('setup.outgoing')}</h3><div class="server-fields"><label>{t('setup.server')}<input bind:value={setup.outgoing!.host} placeholder="smtp.ejemplo.com" required/></label><label>{t('setup.port')}<input type="number" bind:value={setup.outgoing!.port} required/></label></div><label>{t('setup.security')}<select bind:value={setup.outgoing!.security}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label></div><div class="setup-grid"><label>{t('setup.user')}<input bind:value={setup.incoming.username} placeholder="Normalmente tu dirección de correo"/></label><label>{t('setup.password')}<input type="password" bind:value={setup.secret} autocomplete="new-password" placeholder={t('setup.passwordPlaceholder')}/></label></div><p class="security-hint">{t('setup.passwordHint')}</p>{:else}<div class="oauth-explainer"><span><svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="2" y="10.5" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="10.5" width="7.5" height="7.5" rx="1.6"/></svg></span><div><strong>{t('setup.secureLogin')}</strong><p>{t('setup.msOauthExplainer')}</p><button type="button" class="oauth-button" onclick={startMicrosoftLogin} disabled={oauthBusy}>{oauthBusy ? t('common.loading') : t('setup.msLoginButton')}</button><p class="oauth-privacy">{t('setup.msOauthPrivacy')}</p></div></div>{/if}{#if setupError}<p class="setup-error">{setupError}</p>{/if}{#if setupInfo}<p class="setup-message">{setupInfo}</p>{/if}<footer class="setup-footer"><button type="button" class="cancel-setup" onclick={() => setupStep = 'provider'}>{t('setup.changeType')}</button>{#if setup.provider === 'imap' || setup.provider === 'pop3'}<button type="button" class="cancel-setup" onclick={testConnection} disabled={testingConnection}>{testingConnection ? t('common.loading') : t('setup.testConnection')}</button>{/if}<button type="button" class="cancel-setup" onclick={() => setupOpen = false}>{t('common.cancel')}</button>{#if setup.provider === 'imap' || setup.provider === 'pop3'}<button class="setup-submit" type="submit">{t('setup.addAccount')}</button>{/if}</footer></form>{/if}</div></section></div>{/if}

{#if settingsOpen}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) settingsOpen = false; }}><div class="setup-window settings-window" role="dialog" aria-modal="true" aria-label={t('settings.title')}><aside class="setup-brand"><div class="setup-brand-mark"><svg width="22" height="19" viewBox="0 0 24 20" fill="none" aria-hidden="true"><path d="M3 5.5 12 12l9-6.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span class="setup-brand-name">e-meil</span><p class="setup-brand-tagline">{t('settings.title')}</p><ol class="settings-nav"><li><a href="#settings-accounts">{t('settings.accounts')}</a></li><li><a href="#settings-sync">{t('settings.sync')}</a></li><li><a href="#settings-compose">{t('settings.composeTitle')}</a></li><li><a href="#settings-appearance">{t('settings.appearance')}</a></li><li><a href="#settings-rules">{t('settings.rulesTitle')}</a></li><li><a href="#settings-data">{t('settings.dataTitle')}</a></li><li><a href="#settings-about">{t('settings.about')}</a></li></ol><span class="setup-brand-version">v0.1.0 · MIT</span></aside><div class="setup-main"><header class="setup-header"><div><span class="setup-kicker">e-MEIL</span><h2>{t('settings.title')}</h2><p>{t('settings.subtitle')}</p></div><button class="setup-close" type="button" onclick={() => settingsOpen = false} aria-label={t('common.close')}><Icon name="close" size={14} /></button></header><div class="settings-body">
          {#if settingsNotice}<div class="sync-banner">{settingsNotice}<button class="search-exit" type="button" onclick={() => settingsNotice = ''}>OK</button></div>{/if}
          <div class="settings-card" id="settings-accounts">
            <h3>{t('settings.accounts')}</h3>
            {#if !savedAccountRecords.length}<p class="settings-hint">{t('settings.accountsEmpty')}</p>{/if}
            {#each savedAccountRecords as record (record.id)}
              <div class="settings-account">
                <span class="provider-dot">{record.provider === 'microsoft-graph' ? 'ms' : record.provider === 'pop3' ? 'pop' : 'imap'}</span>
                <div class="settings-account-meta"><strong>{record.displayName}</strong><span>{record.emailAddress}</span></div>
                <div class="settings-account-actions">
                  {#if activeAccount?.email === record.emailAddress}<small class="settings-active">{t('settings.active')}</small>{:else}<button class="btn-secondary" onclick={() => { const account = configuredAccounts.find((item) => item.email === record.emailAddress); if (account) selectAccount(account); activeView = 'mail'; }}>{t('settings.use')}</button>{/if}
                  <button class="btn-secondary settings-danger" onclick={() => removeAccount(record)}>{t('settings.delete')}</button>
                </div>
              </div>
            {/each}
            <button class="btn-primary" onclick={() => { settingsOpen = false; setupOpen = true; setupStep = 'provider'; }}>{t('settings.addAccount')}</button>
          </div>
          <div class="settings-card" id="settings-sync">
            <h3>{t('settings.sync')}</h3>
            <label class="settings-row">{t('settings.syncInterval')}
              <select bind:value={syncIntervalMin} onchange={persistSyncInterval} aria-label={t('settings.syncInterval')}>
                <option value={0}>{t('settings.syncManual')}</option>
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
            <label class="settings-row"><input type="checkbox" bind:checked={notificationsEnabled} onchange={persistNotifications} /> {t('settings.notifications')}</label>
            <p class="settings-hint">{t('settings.syncHint')}</p>
          </div>
          <div class="settings-card" id="settings-updates">
            <h3>{t('settings.updatesTitle')}</h3>
            <p class="settings-hint">{t('settings.updatesHint')}</p>
            <button class="btn-primary" onclick={checkUpdates} disabled={updateBusy}>{updateBusy ? t('settings.checking') : t('settings.checkUpdates')}</button>
            {#if updateInfo?.available}
              {#if updateInfo.notes}<p class="settings-hint">{updateInfo.notes}</p>{/if}
              <button class="btn-primary" onclick={installUpdate} disabled={updateBusy}>{updateBusy ? t('settings.installing') : t('settings.installUpdate')}</button>
            {/if}
          </div>
          <div class="settings-card" id="settings-compose">
            <h3>{t('settings.composeTitle')}</h3>
            <label class="settings-column">{t('settings.signature')}
              <textarea bind:value={signature} rows="4" placeholder={t('settings.signaturePlaceholder')}></textarea>
            </label>
            <button class="btn-primary" onclick={saveSignature}>{t('settings.saveSignature')}</button>
            <p class="settings-hint">{t('settings.signatureHint')}</p>
          </div>
          <div class="settings-card" id="settings-appearance">
            <h3>{t('settings.appearance')}</h3>
            <label class="settings-row"><input type="checkbox" bind:checked={dark} onchange={() => setDark(dark)} /> {t('theme.dark')}</label>
            <div class="settings-row settings-themes" role="group" aria-label={t('topbar.theme')}>
              {#each themes as option}<button class="theme-swatch" class:theme-selected={theme === option.id} style={`--swatch:${option.color}`} onclick={() => setTheme(option.id)} aria-label={option.label}></button>{/each}
            </div>
            <label class="settings-row">{t('settings.language')}
              <select bind:value={locale} onchange={() => applyLanguage(locale)} aria-label={t('settings.language')}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          
          <div class="settings-card" id="settings-rules">
            <h3>{t('settings.rulesTitle')}</h3>
            <p class="settings-hint">{t('settings.rulesHint')}</p>
            {#each rules as rule, rindex (rule.id)}
              <div class="rule-card">
                <div class="rule-header">
                  <label class="rule-toggle"><input type="checkbox" bind:checked={rule.enabled} /> {rule.name || t('settings.ruleUntitled')}</label>
                  <div class="rule-actions">
                    <button class="btn-secondary settings-danger" onclick={() => { rules = rules.filter((r,i)=> i!==rindex); saveRules(rules); }}>{t('common.delete')}</button>
                  </div>
                </div>
                <div class="rule-grid">
                  <label class="settings-column">{t('settings.ruleName')}<input bind:value={rule.name} /></label>
                  <label class="settings-row"><input type="checkbox" bind:checked={rule.matchAll} /> {rule.matchAll ? t('settings.ruleMatchAll') : t('settings.ruleMatchAny')}</label>
                </div>
                <div class="rule-section">
                  <div class="rule-section-head"><span>{t('settings.ruleConditions')}</span><button class="btn-secondary" onclick={() => { rule.conditions = [...rule.conditions, {field:'from', op:'contains', value:''}]; rules = [...rules]; }}>+</button></div>
                  {#each rule.conditions as cond, cindex}
                    <div class="rule-row">
                      <select bind:value={cond.field}><option value="from">{t('settings.ruleFieldFrom')}</option><option value="to">{t('settings.ruleFieldTo')}</option><option value="subject">{t('settings.ruleFieldSubject')}</option><option value="body">{t('settings.ruleFieldBody')}</option></select>
                      <select bind:value={cond.op}><option value="contains">{t('settings.ruleOpContains')}</option><option value="notContains">{t('settings.ruleOpNotContains')}</option><option value="equals">{t('settings.ruleOpEquals')}</option><option value="startsWith">{t('settings.ruleOpStartsWith')}</option><option value="endsWith">{t('settings.ruleOpEndsWith')}</option></select>
                      <input bind:value={cond.value} placeholder={t('settings.ruleValue')} />
                      <button class="btn-secondary" onclick={() => { rule.conditions = rule.conditions.filter((_,i)=>i!==cindex); rules=[...rules]; }}><Icon name="close" size={12} /></button>
                    </div>
                  {/each}
                </div>
                <div class="rule-section">
                  <div class="rule-section-head"><span>{t('settings.ruleActions')}</span><button class="btn-secondary" onclick={() => { rule.actions = [...rule.actions, {type:'markRead'}]; rules=[...rules]; }}>+</button></div>
                  {#each rule.actions as act, aindex}
                    <div class="rule-row">
                      <select bind:value={act.type}><option value="markRead">{t('settings.ruleActMarkRead')}</option><option value="star">{t('settings.ruleActStar')}</option><option value="archive">{t('settings.ruleActArchive')}</option><option value="delete">{t('settings.ruleActDelete')}</option><option value="moveTo">{t('settings.ruleActMoveTo')}</option></select>
                      {#if act.type === 'moveTo'}<select bind:value={act.folder}>{#each syncedFolders as folder}<option value={folder.name}>{folder.name}</option>{/each}</select>{/if}
                      <button class="btn-secondary" onclick={() => { rule.actions = rule.actions.filter((_,i)=>i!==aindex); rules=[...rules]; }}><Icon name="close" size={12} /></button>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
            <div class="rule-footer">
              <button class="btn-secondary" onclick={() => { const r = createEmptyRule(); rules = [...rules, r]; }}>{t('settings.ruleAdd')}</button>
              <button class="btn-primary" onclick={() => { saveRules(rules); settingsNotice = t('settings.rulesSaved'); }}>{t('settings.rulesSave')}</button>
            </div>
          </div>
<div class="settings-card" id="settings-data">
            <h3>{t('settings.dataTitle')}</h3>
            <p class="settings-hint">{t('settings.dataHint')}</p>
            <button class="btn-secondary settings-danger" onclick={resetLocalPreferences}>{t('settings.reset')}</button>
          </div>
          <div class="settings-card" id="settings-about">
            <h3>{t('settings.about')}</h3>
            <p class="settings-hint">e-Meil v0.1.0 · MIT · Tauri 2 + Rust + Svelte 5</p>
            <p class="settings-hint">{t('settings.aboutHint')}</p>
          </div>
        
</div></div></div></div>{/if}
{#if contextMenu}<div class="context-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px`} role="menu" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={handleMenuKeydown}><div class="context-title">{contextMenu.kind === 'message' ? t('context.messageTitle') : 'e-MEIL'}</div>{#if contextMenu.kind === 'message'}<button role="menuitem" onclick={() => contextAction('open')}><Icon name="mail" size={13} /> <span>{t('context.open')}</span></button><button role="menuitem" onclick={() => contextAction('read')}><Icon name="seen" size={13} /> <span>{t('context.read')}</span></button><button role="menuitem" onclick={() => contextAction('star')}><Icon name="star" size={13} /> <span>{t('context.star')}</span></button><button role="menuitem" onclick={() => contextAction('delete')} class="danger"><Icon name="trash" size={13} /> <span>{t('context.delete')}</span></button>{:else}<button role="menuitem" onclick={() => contextAction('compose')}><Icon name="plus" size={13} /> <span>{t('context.compose')}</span></button><button role="menuitem" onclick={() => syncImapAccount()}><Icon name="refresh" size={13} /> <span>{t('context.sync')}</span></button>{/if}</div>{/if}{#if composeOpen}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) composeOpen = false; }}><form class="compose-window compose-expanded" onsubmit={sendMail}><div class="compose-header"><div><span class="compose-kicker">{t('compose.kicker')}</span><strong>{t('compose.headerTitle')}</strong></div><div><button type="button" class="window-action" title={t('compose.saveDraft')} onclick={() => saveDraft()}><Icon name="save" size={14} /></button><button type="button" class="window-action" onclick={() => composeOpen = false} aria-label={t('common.close')}><Icon name="close" size={14} /></button></div></div><div class="compose-ribbon"><div class="ribbon-group"><button type="button" class="ribbon-main" onclick={() => addAttachments()}><Icon name="paperclip" size={14} /><small>{t('compose.attach')}</small></button><button type="button" onclick={() => showCcBcc = !showCcBcc}>{t('compose.ccBcc')}</button></div><span class="ribbon-divider"></span><div class="ribbon-group"><button type="button" onclick={() => execFormat('bold')}><b>B</b><small>{t('compose.bold')}</small></button><button type="button" onclick={() => execFormat('italic')}><i>I</i><small>{t('compose.italic')}</small></button><button type="button" onclick={() => execFormat('underline')}><u>U</u><small>{t('compose.underline')}</small></button><button type="button" onclick={() => execFormat('insertUnorderedList')}><Icon name="list" size={14} /><small>{t('compose.list')}</small></button><button type="button" onclick={() => execFormat('justifyLeft')}><Icon name="align" size={14} /><small>{t('compose.align')}</small></button></div><span class="ribbon-divider"></span><div class="ribbon-group"><button type="button" onclick={() => { document.execCommand('insertText', false, '\n' + signature); }}><Icon name="pen" size={14} /><small>{t('compose.signature')}</small></button><button type="button" onclick={() => execFormat('undo')}><Icon name="undo" size={14} /><small>{t('common.undo')}</small></button><button type="button" onclick={() => execFormat('redo')}><Icon name="redo" size={14} /><small>{t('compose.redo')}</small></button></div></div><label class="compose-field">{t('compose.to')} <input type="email" bind:value={composeTo} placeholder="nombre@ejemplo.com" required onfocus={() => openSuggestions('to')} oninput={() => openSuggestions('to')} onkeydown={handleSuggestKeydown} onblur={() => window.setTimeout(closeSuggestions, 120)}/></label>{#if suggestField === 'to' && suggestions.length}<div class="suggest-list" role="listbox">{#each suggestions as suggestion, i}<button type="button" class:suggest-active={i === suggestIndex} role="option" aria-selected={i === suggestIndex} onmousedown={(e) => { e.preventDefault(); pickSuggestion(suggestion.email); }}><strong>{suggestion.name}</strong><span>{suggestion.email}</span></button>{/each}</div>{/if}{#if showCcBcc}<label class="compose-field">{t('compose.cc')} <input bind:value={composeCc} placeholder="personas adicionales" onfocus={() => openSuggestions('cc')} oninput={() => openSuggestions('cc')} onkeydown={handleSuggestKeydown} onblur={() => window.setTimeout(closeSuggestions, 120)}/></label>{#if suggestField === 'cc' && suggestions.length}<div class="suggest-list" role="listbox">{#each suggestions as suggestion, i}<button type="button" class:suggest-active={i === suggestIndex} role="option" aria-selected={i === suggestIndex} onmousedown={(e) => { e.preventDefault(); pickSuggestion(suggestion.email); }}><strong>{suggestion.name}</strong><span>{suggestion.email}</span></button>{/each}</div>{/if}<label class="compose-field">{t('compose.bcc')} <input bind:value={composeBcc} placeholder="destinatarios ocultos" onfocus={() => openSuggestions('bcc')} oninput={() => openSuggestions('bcc')} onkeydown={handleSuggestKeydown} onblur={() => window.setTimeout(closeSuggestions, 120)}/></label>{#if suggestField === 'bcc' && suggestions.length}<div class="suggest-list" role="listbox">{#each suggestions as suggestion, i}<button type="button" class:suggest-active={i === suggestIndex} role="option" aria-selected={i === suggestIndex} onmousedown={(e) => { e.preventDefault(); pickSuggestion(suggestion.email); }}><strong>{suggestion.name}</strong><span>{suggestion.email}</span></button>{/each}</div>{/if}{/if}<label class="compose-field">{t('compose.subject')} <input bind:value={composeSubject} placeholder="Añade un asunto"/></label><div class="rich-editor" contenteditable="true" role="textbox" aria-label="Cuerpo del mensaje" onpaste={handlePaste} oninput={(event) => composeHtml = (event.currentTarget as HTMLElement).innerHTML}> {@html composeHtml}</div>{#if composeAttachments.length}<div class="compose-attachments">{#each composeAttachments as attachment}<div><Icon name="paperclip" size={12} /><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small><button type="button" onclick={() => removeAttachment(attachment.name)}><Icon name="close" size={12} /></button></div>{/each}</div>{/if}{#if composeNotice}<div class="compose-notice">{composeNotice}</div>{/if}<div class="compose-footer"><button class="send-button" type="submit" disabled={sending}>{sending ? 'Enviando…' : 'Enviar'} <Icon name="send" size={14} /></button><button type="button" class="draft-button" onclick={() => saveDraft()}>Guardar borrador</button><button type="button" class="discard-button" onclick={() => composeOpen = false}>{t('compose.discard')}</button></div></form></div>{/if}
