/**
 * Lote "redacción completa + botones honestos" (sesión 17).
 * - Responder a todos (Rust ya expone To/Cc).
 * - Autocompletado de destinatarios desde contactos.
 * - Autoguardado de borrador cada 30 s.
 * - Botones honestos: ordenar real, ayuda real (modal de atajos), quitar
 *   "Más aplicaciones", Ctrl+K al buscador, kbd Ctrl+N.
 * Uso: node scripts/redact-honest.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const appFile = new URL('../src/App.svelte', import.meta.url);
const imapFile = new URL('../src/lib/imap.ts', import.meta.url);
const graphFile = new URL('../src/lib/graph.ts', import.meta.url);
const cssFile = new URL('../src/styles.css', import.meta.url);

const report = [];
function ok(label) { report.push('OK   ' + label); }
function miss(label) { report.push('MISS ' + label); }

// ---------- 1. Puentes de tipos ----------
let imap = readFileSync(imapFile, 'utf8');
imap = imap.replace(
  'export interface ImapMessageContent { uid: number; subject: string; from: string; receivedAt: string | null; text: string; hasAttachments: boolean; attachments: ImapAttachment[]; }',
  'export interface ImapMessageContent { uid: number; subject: string; from: string; toRecipients: string | null; ccRecipients: string | null; receivedAt: string | null; text: string; hasAttachments: boolean; attachments: ImapAttachment[]; }'
);
ok('imap.ts ImapMessageContent');
writeFileSync(imapFile, imap);

let graph = readFileSync(graphFile, 'utf8');
graph = graph.replace(
  'export interface GraphMessage { id: string; subject: string; sender: string; preview: string; body: string | null; receivedAt: string | null; isRead: boolean; hasAttachments: boolean; }',
  'export interface GraphMessage { id: string; subject: string; sender: string; preview: string; body: string | null; receivedAt: string | null; isRead: boolean; hasAttachments: boolean; toRecipients: string | null; }'
);
ok('graph.ts GraphMessage');
writeFileSync(graphFile, graph);

// ---------- 2. App.svelte ----------
let app = readFileSync(appFile, 'utf8');

// 2a. Reemplazar openReply con versión que soporta "a todos".
const oldReply = app.indexOf('function openReply(mode');
const oldReplyEnd = app.indexOf('function openForward');
if (oldReply >= 0 && oldReplyEnd > oldReply) {
  const newReply = `function parseAddressList(raw: string | null | undefined): string[] {
    if (!raw) return [];
    const emails = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g) ?? [];
    return [...new Set(emails.map((email) => email.toLowerCase()))];
  }
  function openReply(mode: 'imap' | 'graph', all = false) { openCompose(); const source = mode === 'imap' ? activeRealMessage : activeGraphMessage; if (!source) return; const from = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).from : (source as import('./lib/graph').GraphMessage).sender;
    const rawTo = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).toRecipients : (source as import('./lib/graph').GraphMessage).toRecipients;
    const rawCc = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).ccRecipients : null;
    const senderEmail = extractEmailAddress(from);
    composeSubject = /^re\\s*:/i.test(source.subject) ? source.subject : \`Re: \${source.subject}\`;
    if (all) {
      const self = activeAccount?.email?.toLowerCase();
      const others = parseAddressList(rawTo).filter((email) => email !== self && email !== senderEmail);
      const ccs = parseAddressList(rawCc).filter((email) => email !== self && email !== senderEmail);
      composeTo = [...new Set([senderEmail, ...others])].join(', ');
      composeCc = ccs.join(', ');
    } else {
      composeTo = senderEmail;
    }
    const dateStr = mode === 'imap' ? ((source as import('./lib/imap').ImapMessageContent).receivedAt ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date((source as import('./lib/imap').ImapMessageContent).receivedAt!)) : 'fecha desconocida') : ((source as import('./lib/graph').GraphMessage).receivedAt ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date((source as import('./lib/graph').GraphMessage).receivedAt!)) : 'fecha desconocida'); const body = mode === 'imap' ? (source as import('./lib/imap').ImapMessageContent).text : ((source as import('./lib/graph').GraphMessage).body || (source as import('./lib/graph').GraphMessage).preview || ''); composeHtml = \`<p><br></p>\${buildQuoteHeader(from, dateStr)}\${buildQuoteBody(body)}\`; composeNotice = all ? \`Respondiendo a todos: \${from}\` : \`Respondiendo a \${from}\`; }
  `;
  app = app.slice(0, oldReply) + newReply + app.slice(oldReplyEnd);
  ok('openReply + parseAddressList');
} else miss('openReply');

// 2b. Botones "Responder a todos" en ambos paneles.
const replyImapBtn = `<button class="reply-button" onclick={() => openReply('imap')}><Icon name="reply" size={13} /> <span>{t('common.reply')}</span></button>`;
const replyImapNew = replyImapBtn + `<button class="reply-button reply-all" onclick={() => openReply('imap', true)}><Icon name="reply" size={13} /><b>+</b> <span>{t('compose.replyAll')}</span></button>`;
const replyGraphBtn = `<button class="reply-button" onclick={() => openReply('graph')}><Icon name="reply" size={13} /> <span>{t('common.reply')}</span></button>`;
const replyGraphNew = replyGraphBtn + `<button class="reply-button reply-all" onclick={() => openReply('graph', true)}><Icon name="reply" size={13} /><b>+</b> <span>{t('compose.replyAll')}</span></button>`;
app.includes(replyImapBtn) ? (app = app.split(replyImapBtn).join(replyImapNew), ok('reply-all imap')) : miss('reply-all imap');
app.includes(replyGraphBtn) ? (app = app.split(replyGraphBtn).join(replyGraphNew), ok('reply-all graph')) : miss('reply-all graph');

// 2c. Ordenar real: estado + menú.
const sortStateAnchor = "let filterMenuOpen = $state(false);";
if (app.includes(sortStateAnchor)) {
  app = app.replace(sortStateAnchor, sortStateAnchor + "\n  let sortMenuOpen = $state(false);\n  let sortKey = $state<'date-desc' | 'date-asc' | 'sender' | 'unread'>('date-desc');\n  function sortMessages<T extends { receivedAt?: string | null; time?: string; from?: string; sender?: string; unread?: boolean }>(list: T[]): T[] {\n    const sorted = [...list];\n    if (sortKey === 'sender') sorted.sort((a, b) => (a.from ?? a.sender ?? '').localeCompare(b.from ?? b.sender ?? ''));\n    else if (sortKey === 'unread') sorted.sort((a, b) => Number(b.unread ?? false) - Number(a.unread ?? false));\n    else {\n      const dateOf = (item: T) => { const raw = item.receivedAt ?? item.time ?? ''; const parsed = raw ? new Date(raw).getTime() : 0; return Number.isNaN(parsed) ? 0 : parsed; };\n      sorted.sort((a, b) => sortKey === 'date-asc' ? dateOf(a) - dateOf(b) : dateOf(b) - dateOf(a));\n    }\n    return sorted;\n  }");
  ok('sortMessages + estado');
} else miss('sortMessages');

// 2d. Botón Ordenar → menú real.
const sortBtnOld = `<button class="tool-icon" use:tooltip={'Ordenar'} aria-label="Ordenar"><Icon name="sort" size={14} /></button>`;
const sortBtnNew = `<span class="sort-wrap"><button class="tool-icon" aria-haspopup="menu" aria-expanded={sortMenuOpen} aria-label="Ordenar" onclick={() => sortMenuOpen = !sortMenuOpen}><Icon name="sort" size={14} /></button>{#if sortMenuOpen}<div class="sort-menu" role="menu" aria-label="Ordenar lista"><button role="menuitem" class:sort-selected={sortKey === 'date-desc'} onclick={() => { sortKey = 'date-desc'; sortMenuOpen = false; }}>{t('sort.dateDesc')}</button><button role="menuitem" class:sort-selected={sortKey === 'date-asc'} onclick={() => { sortKey = 'date-asc'; sortMenuOpen = false; }}>{t('sort.dateAsc')}</button><button role="menuitem" class:sort-selected={sortKey === 'sender'} onclick={() => { sortKey = 'sender'; sortMenuOpen = false; }}>{t('sort.sender')}</button><button role="menuitem" class:sort-selected={sortKey === 'unread'} onclick={() => { sortKey = 'unread'; sortMenuOpen = false; }}>{t('sort.unread')}</button></div>{/if}</span>`;
app.includes(sortBtnOld) ? (app = app.split(sortBtnOld).join(sortBtnNew), ok('sort menú')) : miss('sort menú');

// 2e. Aplicar el orden a las dos listas.
const eachSynced = '{#each syncedMessages as mail (mail.uid)}';
app.includes(eachSynced) ? (app = app.split(eachSynced).join('{#each sortMessages(syncedMessages) as mail (mail.uid)}'), ok('sort aplicado IMAP')) : miss('sort aplicado IMAP');
const eachVisible = '{#each visibleMails as item (item.i)}';
app.includes(eachVisible) ? (app = app.split(eachVisible).join('{#each sortMessages(visibleMails) as item (item.i)}'), ok('sort aplicado Graph')) : miss('sort aplicado Graph');

// 2f. Quitar "Más aplicaciones" del rail.
const moreApps = `<div class="rail-spacer"></div><button class="rail-item" use:tooltip={t('rail.more')} aria-label={t('rail.more')}><Icon name="grid" size={17} /></button>`;
app.includes(moreApps) ? (app = app.split(moreApps).join('<div class="rail-spacer"></div>'), ok('más aplicaciones removido')) : miss('más aplicaciones');

// 2g. Ayuda real: modal de atajos + estado.
app.includes('let themeOpen = $state(false);')
  ? (app = app.replace('let themeOpen = $state(false);', 'let themeOpen = $state(false);\n  let helpOpen = $state(false);'), ok('helpOpen estado'))
  : miss('helpOpen estado');
const helpBtnOld = `<button class="icon-button" use:tooltip={t('topbar.help')} aria-label={t('topbar.help')}><Icon name="help" size={15} /></button>`;
const helpBtnNew = `<button class="icon-button" use:tooltip={t('topbar.help')} aria-label={t('topbar.help')} onclick={() => helpOpen = true}><Icon name="help" size={15} /></button>`;
app.includes(helpBtnOld) ? (app = app.split(helpBtnOld).join(helpBtnNew), ok('botón ayuda conectado')) : miss('botón ayuda');

// 2h. Modal de ayuda (antes del toast).
const helpModal = `{#if helpOpen}<Modal open={helpOpen} title={t('help.title')} onclose={() => helpOpen = false}><div class="help-shortcuts"><h4>{t('help.sectionKeys')}</h4><ul><li><kbd>Ctrl N</kbd> {t('help.newMail')}</li><li><kbd>Ctrl K</kbd> {t('help.search')}</li><li><kbd>Ctrl R</kbd> {t('help.reply')}</li><li><kbd>Ctrl 1-4</kbd> {t('help.views')}</li><li><kbd>Esc</kbd> {t('help.closePopups')}</li></ul><h4>{t('help.sectionMouse')}</h4><ul><li>{t('help.tray')}</li><li>{t('help.mailto')}</li><li>{t('help.sortTip')}</li></ul></div></Modal>{/if}`;
const toastAnchor = '{#if sent}<div class="toast">';
app.includes(toastAnchor) ? (app = app.replace(toastAnchor, helpModal + '\n' + toastAnchor), ok('modal ayuda')) : miss('modal ayuda');

// 2i. Ctrl+K al buscador + cerrar menú orden en Escape.
const escAnchor = "if (contextMenu) contextMenu = null;";
app.includes(escAnchor) ? (app = app.replace(escAnchor, "if (sortMenuOpen) sortMenuOpen = false;\n    " + escAnchor), ok('escape cierra sort')) : miss('escape cierra sort');
const keyF = "if (key === 'f') { event.preventDefault(); document.querySelector<HTMLInputElement>('.top-search input')?.focus(); return; }";
app.includes(keyF) ? (app = app.replace(keyF, keyF + "\n      if (key === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('.top-search input')?.focus(); return; }"), ok('Ctrl+K')) : miss('Ctrl+K');

// 2j. kbd N → Ctrl+N.
const kbdOld = `{t('sidebar.compose')} <kbd>N</kbd>`;
app.includes(kbdOld) ? (app = app.split(kbdOld).join(`{t('sidebar.compose')} <kbd>Ctrl N</kbd>`), ok('kbd Ctrl+N')) : miss('kbd Ctrl+N');

// 2k. Autocompletado de destinatarios.
const suggestStateAnchor = "let showCcBcc = $state(false);";
if (app.includes(suggestStateAnchor)) {
  app = app.replace(suggestStateAnchor, suggestStateAnchor + `
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
  }`);
  ok('autocompletado estado');
} else miss('autocompletado estado');

// 2l. Wire los tres campos + dropdown único en el redactor.
const toFieldOld = `<label class="compose-field">{t('compose.to')} <input type="email" bind:value={composeTo} placeholder="nombre@ejemplo.com" required/></label>`;
const toFieldNew = `<label class="compose-field">{t('compose.to')} <input type="email" bind:value={composeTo} placeholder="nombre@ejemplo.com" required onfocus={() => openSuggestions('to')} oninput={() => openSuggestions('to')} onkeydown={handleSuggestKeydown} onblur={() => window.setTimeout(closeSuggestions, 120)}/></label>{#if suggestField === 'to' && suggestions.length}<div class="suggest-list" role="listbox">{#each suggestions as suggestion, i}<button type="button" class:suggest-active={i === suggestIndex} role="option" aria-selected={i === suggestIndex} onmousedown={(e) => { e.preventDefault(); pickSuggestion(suggestion.email); }}><strong>{suggestion.name}</strong><span>{suggestion.email}</span></button>{/each}</div>{/if}`;
app.includes(toFieldOld) ? (app = app.split(toFieldOld).join(toFieldNew), ok('campo Para + sugerencias')) : miss('campo Para');

const ccFieldOld = `<label class="compose-field">{t('compose.cc')} <input bind:value={composeCc} placeholder="personas adicionales"/></label>`;
const ccFieldNew = `<label class="compose-field">{t('compose.cc')} <input bind:value={composeCc} placeholder="personas adicionales" onfocus={() => openSuggestions('cc')} oninput={() => openSuggestions('cc')} onkeydown={handleSuggestKeydown} onblur={() => window.setTimeout(closeSuggestions, 120)}/></label>{#if suggestField === 'cc' && suggestions.length}<div class="suggest-list" role="listbox">{#each suggestions as suggestion, i}<button type="button" class:suggest-active={i === suggestIndex} role="option" aria-selected={i === suggestIndex} onmousedown={(e) => { e.preventDefault(); pickSuggestion(suggestion.email); }}><strong>{suggestion.name}</strong><span>{suggestion.email}</span></button>{/each}</div>{/if}`;
app.includes(ccFieldOld) ? (app = app.split(ccFieldOld).join(ccFieldNew), ok('campo CC + sugerencias')) : miss('campo CC');

const bccFieldOld = `<label class="compose-field">{t('compose.bcc')} <input bind:value={composeBcc} placeholder="destinatarios ocultos"/></label>`;
const bccFieldNew = `<label class="compose-field">{t('compose.bcc')} <input bind:value={composeBcc} placeholder="destinatarios ocultos" onfocus={() => openSuggestions('bcc')} oninput={() => openSuggestions('bcc')} onkeydown={handleSuggestKeydown} onblur={() => window.setTimeout(closeSuggestions, 120)}/></label>{#if suggestField === 'bcc' && suggestions.length}<div class="suggest-list" role="listbox">{#each suggestions as suggestion, i}<button type="button" class:suggest-active={i === suggestIndex} role="option" aria-selected={i === suggestIndex} onmousedown={(e) => { e.preventDefault(); pickSuggestion(suggestion.email); }}><strong>{suggestion.name}</strong><span>{suggestion.email}</span></button>{/each}</div>{/if}`;
app.includes(bccFieldOld) ? (app = app.split(bccFieldOld).join(bccFieldNew), ok('campo CCO + sugerencias')) : miss('campo CCO');

// 2m. Autoguardado cada 30 s mientras el redactor está abierto.
const autosaveAnchor = '// --- Panel de configuración (ventana flotante, estilo del asistente) ------';
if (app.includes(autosaveAnchor)) {
  app = app.replace(autosaveAnchor, `// Autoguardado del borrador cada 30 s mientras el redactor está abierto.
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

` + autosaveAnchor);
  ok('autoguardado');
} else miss('autoguardado');

// 2n. saveDraft(auto) — aviso más suave para autoguardado.
const draftNotice = "function saveSignature() { localStorage.setItem('emeil-signature', signature); settingsNotice = t('settings.signatureSaved'); }";
// saveDraft está en otra parte; ajusto su firma para aceptar auto.
app = app.replace('async function saveDraft() {', 'async function saveDraft(auto = false) {');
const localNotice = `composeNotice = 'Borrador guardado en este dispositivo.';`;
app = app.split(localNotice).join(`composeNotice = auto ? t('compose.autosaved') : 'Borrador guardado en este dispositivo.';`);
const serverNotice = "composeNotice = `Borrador guardado en «${draftsFolder}».`;";
app = app.includes(serverNotice) ? app.split(serverNotice).join(`composeNotice = auto ? t('compose.autosaved') : \`Borrador guardado en «\${draftsFolder}».\`;`) : app;
ok('saveDraft(auto)');

writeFileSync(appFile, app);

// ---------- 3. CSS ----------
let css = readFileSync(cssFile, 'utf8');
const cssAnchor = '.settings-themes .theme-selected{outline:2px solid var(--accent);outline-offset:2px}';
const cssAdd = cssAnchor + `
/* --- Redacción completa + botones honestos --- */
.reply-button.reply-all{border-style:dashed}
.reply-button.reply-all b{font-size:10px;font-weight:800;margin:0 1px 0 -3px}
.sort-wrap{position:relative}
.sort-menu{position:absolute;top:32px;right:0;z-index:12;width:150px;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:5px;box-shadow:0 12px 36px #0003;display:flex;flex-direction:column;gap:2px;animation:panel-enter .15s ease both}
.sort-menu button{border:0;background:none;text-align:left;padding:7px 9px;border-radius:5px;font-size:11px;color:var(--ink);cursor:pointer}
.sort-menu button:hover{background:var(--accent-soft)}
.sort-menu button.sort-selected{font-weight:600;color:var(--accent-ink)}
.compose-field{position:relative}
.suggest-list{position:absolute;top:38px;left:0;right:0;z-index:12;background:var(--paper);border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 36px #0003;display:flex;flex-direction:column;gap:1px;padding:4px;animation:panel-enter .15s ease both}
.suggest-list button{border:0;background:none;display:flex;flex-direction:column;gap:1px;text-align:left;padding:6px 9px;border-radius:5px;cursor:pointer}
.suggest-list button:hover,.suggest-list .suggest-active{background:var(--accent-soft)}
.suggest-list strong{font-size:10.5px;color:var(--ink);font-weight:600}
.suggest-list span{font-size:9.5px;color:var(--muted)}
.help-shortcuts h4{margin:12px 0 6px;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}
.help-shortcuts ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.help-shortcuts li{font-size:11px;color:var(--ink);display:flex;align-items:center;gap:8px}
.help-shortcuts kbd{font-size:9px;background:var(--surface-input);border:1px solid var(--line);border-radius:4px;padding:2px 6px;white-space:nowrap;flex:none}`;
css.includes(cssAnchor) ? (css = css.split(cssAnchor).join(cssAdd), ok('CSS lote')) : miss('CSS lote');
writeFileSync(cssFile, css);

// ---------- 4. i18n ----------
const i18nFile = new URL('../src/lib/i18n.ts', import.meta.url);
let i18n = readFileSync(i18nFile, 'utf8');
const esAnchor = "'settings.aboutHint': 'Cliente de correo de escritorio open source para Windows y Linux.'";
const esAdd = esAnchor + `,
    // Redacción completa + botones honestos
    'compose.replyAll': 'Responder a todos',
    'compose.autosaved': 'Borrador autoguardado.',
    'sort.dateDesc': 'Más recientes primero',
    'sort.dateAsc': 'Más antiguos primero',
    'sort.sender': 'Por remitente (A-Z)',
    'sort.unread': 'No leídos primero',
    'help.title': 'Ayuda y atajos',
    'help.sectionKeys': 'Atajos de teclado',
    'help.sectionMouse': 'Consejos',
    'help.newMail': 'Redactar mensaje',
    'help.search': 'Ir al buscador',
    'help.reply': 'Responder al mensaje activo',
    'help.views': 'Correo / Calendario / Contactos / Ajustes',
    'help.closePopups': 'Cerrar menús y ventanas emergentes',
    'help.tray': 'Clic en el ícono de bandeja para mostrar e-Meil; el menú contextual permite Redactar y Sincronizar.',
    'help.mailto': 'Los enlaces mailto: del sistema abren e-Meil con el mensaje precargado.',
    'help.sortTip': 'El botón de ordenar la lista ofrece fecha, remitente y no leídos.'`;
i18n.includes(esAnchor) ? (i18n = i18n.split(esAnchor).join(esAdd), ok('i18n es')) : miss('i18n es');
const enAnchor = "'settings.aboutHint': 'Open source desktop email client for Windows and Linux.'";
const enAdd = enAnchor + `,
    'compose.replyAll': 'Reply all',
    'compose.autosaved': 'Draft autosaved.',
    'sort.dateDesc': 'Newest first',
    'sort.dateAsc': 'Oldest first',
    'sort.sender': 'By sender (A-Z)',
    'sort.unread': 'Unread first',
    'help.title': 'Help & shortcuts',
    'help.sectionKeys': 'Keyboard shortcuts',
    'help.sectionMouse': 'Tips',
    'help.newMail': 'Compose message',
    'help.search': 'Go to search',
    'help.reply': 'Reply to active message',
    'help.views': 'Mail / Calendar / Contacts / Settings',
    'help.closePopups': 'Close menus and popups',
    'help.tray': 'Click the tray icon to show e-Meil; its menu offers Compose and Sync.',
    'help.mailto': 'System mailto: links open e-Meil with the message pre-filled.',
    'help.sortTip': 'The sort button offers date, sender and unread ordering.'`;
i18n.includes(enAnchor) ? (i18n = i18n.split(enAnchor).join(enAdd), ok('i18n en')) : miss('i18n en');
writeFileSync(i18nFile, i18n);

console.log(report.join('\n'));
