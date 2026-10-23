/**
 * Frontend de hilos de conversación (sesión 19, parte 2).
 * Agrupar por asunto normalizado o conversationId, con expandir/colapsar.
 * Uso: node scripts/threads-frontend.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const appFile = new URL('../src/App.svelte', import.meta.url);
let app = readFileSync(appFile, 'utf8');
const report = [];
const ok = (l) => report.push('OK   ' + l);
const miss = (l) => report.push('MISS ' + l);

// ========== 1. Estado y lógica de hilos ==========
const threadStateAnchor = "let unifiedInbox = $state(false);";
const threadCode = threadStateAnchor + `
  // --- Hilos de conversación ------------------------------------------------
  let threadView = $state(false);
  let expandedThreads = $state<Set<string>>(new Set());
  function normalizeSubject(subject: string): string {
    return subject.replace(/^(re|fwd|fw|rv|res|respuesta|reenviado)\\s*:\\s*/gi, '').replace(/\\s+/g, ' ').trim().toLowerCase();
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
  const imapThreads = $derived(threadView ? groupThreads(syncedMessages.filter((m) => !snoozedKeys.has(\`imap:\${m.uid}\`)), (m) => m.messageId ? \`mid:\${m.inReplyTo ?? m.messageId}\` : \`subj:\${normalizeSubject(m.subject)}\`, (m) => m.receivedAt ? new Date(m.receivedAt).getTime() || 0 : 0) : []);
  const graphThreads = $derived(threadView ? groupThreads(visibleMails.filter((item) => !snoozedKeys.has(\`graph:\${item.mail.uid}\`)), (item) => item.mail.uid && unifiedMessages.find((m) => m.id === item.mail.uid)?.conversationId ? \`conv:\${unifiedMessages.find((m) => m.id === item.mail.uid)!.conversationId}\` : \`subj:\${normalizeSubject(item.mail.subject)}\`, (item) => item.mail.time ? new Date(item.mail.time).getTime() || 0 : 0) : []);`;
if (app.includes(threadStateAnchor)) {
  app = app.replace(threadStateAnchor, threadCode);
  ok('estado y lógica de hilos');
} else miss('estado de hilos');

// ========== 2. Toggle "Conversaciones" en el header ==========
const headerOld = '<label class="unified-toggle"><input type="checkbox" bind:checked={unifiedInbox} /> {t(\'list.unifiedLabel\')}</label>';
const headerNew = '<label class="unified-toggle"><input type="checkbox" bind:checked={unifiedInbox} /> {t(\'list.unifiedLabel\')}</label><label class="unified-toggle"><input type="checkbox" bind:checked={threadView} /> {t(\'list.threadView\')}</label>';
app.includes(headerOld) ? (app = app.split(headerOld).join(headerNew), ok('toggle conversaciones')) : miss('toggle conversaciones');

// ========== 3. Renderizado de hilos ==========
// En la sección messages: cuando threadView está activo, renderizar hilos
// Insertar después del if de bandeja unificada, como un nuevo branch.
const messagesAnchor = '<div class="messages">{#if unifiedInbox && configuredAccounts.length > 1}';
if (app.includes(messagesAnchor)) {
  const threadBranch = `<div class="messages">{#if threadView && activeProvider === 'imap' && imapThreads.length}{#each imapThreads as thread (thread.key)}<div class="thread-card" class:thread-unread={thread.unreadCount > 0}><button class="thread-header" onclick={() => toggleThread(thread.key)}><span class="sender">{thread.latest.from}</span><span class="subject-line">{thread.latest.subject}</span><span class="thread-meta"><span class="thread-count">{thread.count}</span>{#if thread.unreadCount > 0}<span class="unread-dot"></span>{/if}<Icon name={expandedThreads.has(thread.key) ? 'chevron-down' : 'back'} size={12} /></span></button>{#if expandedThreads.has(thread.key)}<div class="thread-body">{#each thread.messages as mail (mail.uid)}<div class="thread-message"><button class="message-open" onclick={() => openRealMessage(mail)} aria-label={t('reading.open')}><span class="sender-avatar lavender">{messageInitials(mail.from)}</span><span class="message-content"><span class="message-top"><span class="sender">{mail.from}</span><span class="message-time">{displayTime(mail.receivedAt)}</span></span><span class="preview">{mail.preview}</span></span></button></div>{/each}</div>{:else}<div class="thread-preview">{thread.latest.preview || '(sin contenido)'}</div>{/if}</div>{/each}{:else if threadView && activeProvider === 'microsoft-graph' && graphThreads.length}{#each graphThreads as thread (thread.key)}<div class="thread-card" class:thread-unread={thread.unreadCount > 0}><button class="thread-header" onclick={() => toggleThread(thread.key)}><span class="sender">{thread.latest.mail?.sender}</span><span class="subject-line">{thread.latest.mail?.subject}</span><span class="thread-meta"><span class="thread-count">{thread.count}</span>{#if thread.unreadCount > 0}<span class="unread-dot"></span>{/if}<Icon name={expandedThreads.has(thread.key) ? 'chevron-down' : 'back'} size={12} /></span></button>{#if expandedThreads.has(thread.key)}<div class="thread-body">{#each thread.messages as item (item.i)}<div class="thread-message"><button class="message-open" onclick={() => openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage)} aria-label={t('reading.open')}><span class="sender-avatar lavender">{item.mail.initials}</span><span class="message-content"><span class="message-top"><span class="sender">{item.mail.sender}</span><span class="message-time">{item.mail.time}</span></span><span class="preview">{item.mail.preview}</span></span></button></div>{/each}</div>{:else}<div class="thread-preview">{thread.latest.mail?.preview || '(sin contenido)'}</div>{/if}</div>{/each}{:if}`;
  // Reemplazar el inicio del messages div para insertar thread branches primero
  app = app.replace(messagesAnchor, threadBranch);
  ok('renderizado de hilos IMAP + Graph');
} else miss('renderizado de hilos');

writeFileSync(appFile, app);

// ========== 4. i18n ==========
const i18nFile = new URL('../src/lib/i18n.ts', import.meta.url);
let i18n = readFileSync(i18nFile, 'utf8');
const esAnchor = "'list.unifiedLabel': 'Bandeja unificada'";
const esAdd = esAnchor + `,\n    'list.threadView': 'Conversaciones'`;
i18n.includes(esAnchor) && !i18n.includes("'list.threadView'") ? (i18n = i18n.split(esAnchor).join(esAdd), ok('i18n es threadView')) : miss('i18n es');
const enAnchor = "'list.unifiedLabel': 'Unified inbox'";
const enAdd = enAnchor + `,\n    'list.threadView': 'Conversations'`;
i18n.includes(enAnchor) && !i18n.includes("'list.threadView'") ? (i18n = i18n.split(enAnchor).join(enAdd), ok('i18n en threadView')) : miss('i18n en');
writeFileSync(i18nFile, i18n);

// ========== 5. CSS ==========
const cssFile = new URL('../src/styles.css', import.meta.url);
let css = readFileSync(cssFile, 'utf8');
const cssAnchor = '.unified-chip{font-size:10px;color:var(--accent-ink);background:var(--accent-soft);border-radius:4px;padding:2px 7px;margin-left:6px;font-weight:600;vertical-align:2px}';
const cssAdd = cssAnchor + `
/* --- Hilos de conversación --- */
.thread-card{border:1px solid var(--line);border-radius:8px;margin-bottom:6px;overflow:hidden;background:var(--paper);transition:border-color .15s ease}
.thread-card:hover{border-color:var(--accent)}
.thread-card.thread-unread{border-left:3px solid var(--accent)}
.thread-header{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border:0;background:transparent;text-align:left;cursor:pointer;font:inherit}
.thread-header .sender{font-size:10.5px;font-weight:600;color:var(--ink);flex:none;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread-header .subject-line{flex:1;font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread-meta{display:flex;align-items:center;gap:6px;flex:none}
.thread-count{font-size:9px;font-weight:700;color:var(--paper);background:var(--accent);border-radius:8px;padding:1px 7px;min-width:14px;text-align:center}
.thread-card:not(.thread-unread) .thread-count{background:var(--muted)}
.thread-preview{padding:6px 12px 10px;font-size:9.5px;color:var(--muted);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread-body{border-top:1px solid var(--line);display:flex;flex-direction:column}
.thread-message{padding:6px 12px;border-bottom:1px solid var(--line)}
.thread-message:last-child{border-bottom:0}
.thread-message .message-open{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;text-align:left;padding:4px 0;cursor:pointer;font:inherit}
.thread-message .sender{font-size:10px;color:var(--ink);font-weight:600;flex:none}
.thread-message .message-time{font-size:8.5px;color:var(--muted)}
.thread-message .preview{font-size:9px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
css.includes(cssAnchor) ? (css = css.split(cssAnchor).join(cssAdd), ok('CSS hilos')) : miss('CSS hilos');
writeFileSync(cssFile, css);

console.log(report.join('\n'));
