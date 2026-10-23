/**
 * Lote "deliciosos v1": Snooze + Vista HTML + Bandeja unificada (sesión 18).
 *
 * Snooze: posponer un mensaje 1h/3h/mañana; vuelve arriba al despertar.
 * Vista HTML: toggle para mensajes Graph con cuerpo HTML (sanado en cliente).
 * Bandeja unificada: chip que mezcla los mensajes de todas las cuentas cacheadas.
 *
 * Uso: node scripts/delicious.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const appFile = new URL('../src/App.svelte', import.meta.url);
let app = readFileSync(appFile, 'utf8');
const report = [];
const ok = (l) => report.push('OK   ' + l);
const miss = (l) => report.push('MISS ' + l);

// ========== 1. SNOOZE ==========
// Estado + funciones + despertador
const snoozeAnchor = 'let activeContentMode = $state<\'text\' | \'html-blocked\'>(\'text\');';
const snoozeCode = snoozeAnchor + `
  // --- Snooze: posponer un mensaje y despertarlo después -----------------
  let snoozedKeys = $state<Set<string>>(new Set(JSON.parse(localStorage.getItem('emeil-snoozed') || '[]')));
  let snoozeMenuOpen = $state(false);
  function snoozeMessage(hours: number) {
    const mail = activeRealMessage ?? activeGraphMessage;
    if (!mail) return;
    const key = 'imap' in mail ? \`imap:\${(mail as any).uid}\` : \`graph:\${(mail as any).id}\`;
    const entry = { key, wakeAt: Date.now() + hours * 3600_000 };
    snoozedKeys = new Set([...snoozedKeys, key]);
    localStorage.setItem('emeil-snoozed', JSON.stringify([...snoozedKeys]));
    localStorage.setItem(\`emeil-snooze-\${key}\`, String(entry.wakeAt));
    snoozeMenuOpen = false;
    activeRealMessage = null; activeGraphMessage = null; mobileReadingOpen = false;
    syncMessage = \`Pospuesto por \${hours >= 24 ? '1 día' : hours + ' hora(s)'}.\`;
  }
  function wakeSnoozed() {
    const now = Date.now();
    const expired: string[] = [];
    for (const key of snoozedKeys) {
      const wakeAt = Number(localStorage.getItem(\`emeil-snooze-\${key}\`) || 0);
      if (wakeAt > 0 && wakeAt <= now) {
        expired.push(key);
        localStorage.removeItem(\`emeil-snooze-\${key}\`);
      }
    }
    if (expired.length) {
      snoozedKeys = new Set([...snoozedKeys].filter((key) => !expired.includes(key)));
      localStorage.setItem('emeil-snoozed', JSON.stringify([...snoozedKeys]));
      syncActiveAccount(); // refresca la lista con los mensajes despertados
      syncMessage = \`\${expired.length} mensaje(s) despertado(s) del snooze.\`;
    }
  }
  $effect(() => { const id = window.setInterval(wakeSnoozed, 30_000); return () => window.clearInterval(id); });
  function isSnoozed(key: string): boolean { return snoozedKeys.has(key); }`;
if (app.includes(snoozeAnchor)) {
  app = app.replace(snoozeAnchor, snoozeCode);
  ok('snooze estado + funciones');
} else miss('snooze anchor');

// Filtrar snoozed de las listas (aplicar en sortMessages o en cada each):
// Agregar filtro al each de IMAP y Graph
const eachImapOld = '{#each sortMessages(syncedMessages) as mail (mail.uid)}';
const eachImapNew = '{#each sortMessages(syncedMessages.filter((m) => !snoozedKeys.has(`imap:${m.uid}`))) as mail (mail.uid)}';
app.includes(eachImapOld) ? (app = app.split(eachImapOld).join(eachImapNew), ok('snooze filtro IMAP')) : miss('snooze filtro IMAP');

const eachGraphOld = '{#each sortMessages(visibleMails) as item (item.i)}';
const eachGraphNew = '{#each sortMessages(visibleMails.filter((item) => !snoozedKeys.has(`graph:${item.mail.uid}`))) as item (item.i)}';
app.includes(eachGraphOld) ? (app = app.split(eachGraphOld).join(eachGraphNew), ok('snooze filtro Graph')) : miss('snooze filtro Graph');

// Botón "Posponer" en el panel de lectura (ambos paneles, junto a responder).
const imapActionsOld = '<div class="email-actions"><button class="reply-button" onclick={() => openReply(\'imap\')}>';
const imapActionsNew = '<div class="email-actions"><span class="snooze-wrap"><button class="reply-button snooze-btn" aria-haspopup="menu" aria-expanded={snoozeMenuOpen} onclick={() => snoozeMenuOpen = !snoozeMenuOpen}><Icon name="clock" size={13} /> <span>{t(\'snooze.title\')}</span></button>{#if snoozeMenuOpen}<div class="sort-menu snooze-menu" role="menu"><button role="menuitem" onclick={() => snoozeMessage(1)}>{t(\'snooze.1h\')}</button><button role="menuitem" onclick={() => snoozeMessage(3)}>{t(\'snooze.3h\')}</button><button role="menuitem" onclick={() => snoozeMessage(24)}>{t(\'snooze.tomorrow\')}</button></div>{/if}</span><button class="reply-button" onclick={() => openReply(\'imap\')}>';
app.includes(imapActionsOld) ? (app = app.split(imapActionsOld).join(imapActionsNew), ok('snooze botón IMAP')) : miss('snooze botón IMAP');

const graphActionsOld = '<div class="email-actions"><button class="reply-button" onclick={() => openReply(\'graph\')}>';
const graphActionsNew = '<div class="email-actions"><span class="snooze-wrap"><button class="reply-button snooze-btn" aria-haspopup="menu" aria-expanded={snoozeMenuOpen} onclick={() => snoozeMenuOpen = !snoozeMenuOpen}><Icon name="clock" size={13} /> <span>{t(\'snooze.title\')}</span></button>{#if snoozeMenuOpen}<div class="sort-menu snooze-menu" role="menu"><button role="menuitem" onclick={() => snoozeMessage(1)}>{t(\'snooze.1h\')}</button><button role="menuitem" onclick={() => snoozeMessage(3)}>{t(\'snooze.3h\')}</button><button role="menuitem" onclick={() => snoozeMessage(24)}>{t(\'snooze.tomorrow\')}</button></div>{/if}</span><button class="reply-button" onclick={() => openReply(\'graph\')}>';
app.includes(graphActionsOld) ? (app = app.split(graphActionsOld).join(graphActionsNew), ok('snooze botón Graph')) : miss('snooze botón Graph');

// ========== 2. VISTA HTML (Graph) ==========
// Toggle en el panel Graph para ver el cuerpo HTML sanado
const graphBodyOld = '<pre>{activeGraphMessage.body || activeGraphMessage.preview || \'Este mensaje no contiene texto visible.\'}</pre>';
const graphBodyNew = `{#if activeGraphMessage.body && activeContentMode === 'html-blocked'}<div class="html-view" role="document">{@html sanitizeGraphHtml(activeGraphMessage.body)}</div><button class="reply-button html-toggle" onclick={() => activeContentMode = 'text'}>{t('reading.viewText')}</button>{:else}<pre>{activeGraphMessage.body && activeContentMode === 'text' ? stripHtmlToText(activeGraphMessage.body).slice(0, 2000) : (activeGraphMessage.body || activeGraphMessage.preview || 'Este mensaje no contiene texto visible.')}</pre>{#if activeGraphMessage.body}<button class="reply-button html-toggle" onclick={() => activeContentMode = 'html-blocked'}>{t('reading.viewHtml')}</button>{/if}{/if}`;
app.includes(graphBodyOld) ? (app = app.split(graphBodyOld).join(graphBodyNew), ok('vista HTML Graph')) : miss('vista HTML Graph');

// Agregar sanitizeGraphHtml cerca de stripHtmlToText
const sanitizeAnchor = 'function buildQuoteBody(source: string)';
const sanitizeFn = `function sanitizeGraphHtml(html: string): string {
    const container = document.createElement('div');
    container.innerHTML = html;
    const dangerous = container.querySelectorAll('script,iframe,object,embed,form,link,meta,base');
    dangerous.forEach((el) => el.remove());
    container.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || (name === 'src' && !attr.value.startsWith('data:'))) el.removeAttribute(attr.name);
        if (name === 'src' && !attr.value.startsWith('data:')) el.setAttribute('src', '');
      });
    });
    container.querySelectorAll('img').forEach((img) => { img.removeAttribute('src'); img.alt = img.alt || 'Imagen remota bloqueada'; });
    return container.innerHTML;
  }
  ` + sanitizeAnchor;
if (app.includes(sanitizeAnchor) && !app.includes('sanitizeGraphHtml')) {
  app = app.replace(sanitizeAnchor, sanitizeFn);
  ok('sanitizeGraphHtml');
} else miss('sanitizeGraphHtml');

// ========== 3. BANDEJA UNIFICADA ==========
// Chip toggle en el header de la lista
const unifiedAnchor = '<div class="list-header"><div><div class="eyebrow">{todayLabel}</div><h1>{currentFolder}</h1><div class="inbox-subtitle">{t(\'list.subtitle\')}</div></div>';
const unifiedNew = `<div class="list-header"><div><div class="eyebrow">{todayLabel}</div><h1>{currentFolder}{#if unifiedInbox} <span class="unified-chip">{t('list.unified')}</span>{/if}</h1><div class="inbox-subtitle">{t('list.subtitle')}</div></div><div class="list-header-actions"><label class="unified-toggle"><input type="checkbox" bind:checked={unifiedInbox} /> {t('list.unifiedLabel')}</label></div>`;
app.includes(unifiedAnchor) ? (app = app.split(unifiedAnchor).join(unifiedNew), ok('bandeja unificada header')) : miss('bandeja unificada header');

// Estado + función de fusión
const unifiedState = 'let activeContentMode = $state<\'text\' | \'html-blocked\'>(\'text\');';
const unifiedCode = unifiedState + '\n  let unifiedInbox = $state(false);';
app.includes(unifiedState) && !app.includes('unifiedInbox') ? (app = app.replace(unifiedState, unifiedCode), ok('unifiedInbox estado')) : miss('unifiedInbox estado');

// En la lista: cuando unifiedInbox, fusionar syncedMessages + unifiedMessages en una sola lista renderizada
// Cambiar la condición del if en messages:
const msgIfOld = '<div class="messages">{#if syncedMessages.length}{#each sortMessages(syncedMessages.filter((m) => !snoozedKeys.has(`imap:${m.uid}`))) as mail (mail.uid)}';
const msgIfNew = `<div class="messages">{#if unifiedInbox && configuredAccounts.length > 1}{#each sortMessages([...syncedMessages.filter((m) => !snoozedKeys.has(\`imap:\${m.uid}\`)).map((m) => ({ ...m, _origin: 'imap' as const })), ...visibleMails.filter((item) => !snoozedKeys.has(\`graph:\${item.mail.uid}\`)).map((item) => ({ ...item.mail, _origin: 'graph' as const, _uid: item.mail.uid }))].filter((m) => (m as any).subject)) as mail ((mail as any).uid ?? (mail as any)._uid)}<article class:unread={(mail as any).unread} class="message-row"><button class="message-open" aria-label={t('reading.open')} onclick={() => { const target = (mail as any)._origin === 'graph' ? unifiedMessages.find((m) => m.id === (mail as any)._uid) : syncedMessages.find((m) => m.uid === (mail as any).uid); if (target) { if ((mail as any)._origin === 'graph') openGraphMessage(target as unknown as import('./lib/graph').GraphMessage); else openRealMessage(target as any); } }}><span class="row-check"></span></button><button type="button" class="star" aria-label={t('reading.favorite')}><Icon name="star" size={13} /></button><span class="sender-avatar lavender">{messageInitials((mail as any).from ?? (mail as any).sender)}</span><button class="message-open message-body-open" aria-label={t('reading.open')} onclick={() => { const target = (mail as any)._origin === 'graph' ? unifiedMessages.find((m) => m.id === (mail as any)._uid) : syncedMessages.find((m) => m.uid === (mail as any).uid); if (target) { if ((mail as any)._origin === 'graph') openGraphMessage(target as unknown as import('./lib/graph').GraphMessage); else openRealMessage(target as any); } }}><span class="sender-avatar lavender">{messageInitials((mail as any).from ?? (mail as any).sender)}</span><span class="message-content"><span class="message-top"><span class="sender">{(mail as any).from ?? (mail as any).sender}</span><span class="message-time">{displayTime((mail as any).receivedAt)}</span></span><span class="subject-line">{(mail as any).subject}</span><span class="preview">{(mail as any).preview}</span></span></button>{#if (mail as any)._origin}<span class="provider-dot" style="margin-left:auto;flex:none">{(mail as any)._origin === 'graph' ? 'ms' : 'imap'}</span>{/if}{#if (mail as any).unread}<span class="unread-dot"></span>{/if}</article>{/each}{:if}`;
app.includes(msgIfOld) ? (app = app.split(msgIfOld).join(msgIfNew), ok('bandeja unificada fusión')) : miss('bandeja unificada fusión');

writeFileSync(appFile, app);

// ========== 4. i18n ==========
const i18nFile = new URL('../src/lib/i18n.ts', import.meta.url);
let i18n = readFileSync(i18nFile, 'utf8');
const i18nEsAnchor = "'help.sortTip': 'El botón de ordenar la lista ofrece fecha, remitente y no leídos.'";
const i18nEsAdd = i18nEsAnchor + `,
    // Snooze + HTML + bandeja unificada
    'snooze.title': 'Posponer',
    'snooze.1h': '1 hora',
    'snooze.3h': '3 horas',
    'snooze.tomorrow': 'Mañana',
    'reading.viewHtml': 'Ver HTML',
    'reading.viewText': 'Ver texto plano',
    'list.unified': '· todas las cuentas',
    'list.unifiedLabel': 'Bandeja unificada'`;
i18n.includes(i18nEsAnchor) ? (i18n = i18n.split(i18nEsAnchor).join(i18nEsAdd), ok('i18n es')) : miss('i18n es');

const i18nEnAnchor = "'help.sortTip': 'The sort button offers date, sender and unread ordering.'";
const i18nEnAdd = i18nEnAnchor + `,
    'snooze.title': 'Snooze',
    'snooze.1h': '1 hour',
    'snooze.3h': '3 hours',
    'snooze.tomorrow': 'Tomorrow',
    'reading.viewHtml': 'View HTML',
    'reading.viewText': 'View plain text',
    'list.unified': '· all accounts',
    'list.unifiedLabel': 'Unified inbox'`;
i18n.includes(i18nEnAnchor) ? (i18n = i18n.split(i18nEnAnchor).join(i18nEnAdd), ok('i18n en')) : miss('i18n en');
writeFileSync(i18nFile, i18n);

// ========== 5. CSS ==========
const cssFile = new URL('../src/styles.css', import.meta.url);
let css = readFileSync(cssFile, 'utf8');
const cssAnchor = '.help-shortcuts kbd{font-size:9px;background:var(--surface-input);border:1px solid var(--line);border-radius:4px;padding:2px 6px;white-space:nowrap;flex:none}';
const cssAdd = cssAnchor + `
/* --- Snooze + HTML + bandeja unificada --- */
.snooze-wrap{position:relative}
.snooze-menu{right:auto;left:0;width:120px}
.snooze-btn{color:var(--muted)}
.html-view{font-size:12px;line-height:1.65;color:var(--ink);padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow-x:auto;max-height:400px;overflow-y:auto}
.html-view img{filter:grayscale(1);opacity:.3}
.html-view a{color:var(--accent-ink)}
.html-toggle{margin-top:8px}
.list-header-actions{display:flex;align-items:center;gap:10px}
.unified-toggle{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap}
.unified-toggle input{accent-color:var(--accent)}
.unified-chip{font-size:10px;color:var(--accent-ink);background:var(--accent-soft);border-radius:4px;padding:2px 7px;margin-left:6px;font-weight:600;vertical-align:2px}`;
css.includes(cssAnchor) ? (css = css.split(cssAnchor).join(cssAdd), ok('CSS deliciosos')) : miss('CSS deliciosos');
writeFileSync(cssFile, css);

// ========== 6. Icono clock ==========
// Agregar 'clock' al icon system
const iconFile = new URL('../src/lib/Icon.svelte', import.meta.url);
let icons = readFileSync(iconFile, 'utf8');
if (!icons.includes('clock:')) {
  icons = icons.replace(
    "check: '",
    "clock: '<circle cx=\"10\" cy=\"10\" r=\"7.5\"/><path d=\"M10 6v4l2.5 2.5\"/>',\n    check: '"
  );
  writeFileSync(iconFile, icons);
  ok('icono clock');
} else ok('icono clock ya presente');

console.log(report.join('\n'));
