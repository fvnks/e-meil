/**
 * Eliminación de todos los mocks/datos demo de e-Meil (sesión 9).
 *
 * La app pasa a mostrar estados vacíos reales:
 *  - Sin cuenta → estados vacíos + "Añadir cuenta".
 *  - Sin mensajes → "Sin mensajes" (antes: correos falsos de Sofía/Linear/Figma…).
 *  - Carpetas: lista real mínima (Bandeja/Favoritos) + carpetas nativas sincronizadas.
 *
 * Uso: node scripts/remove-mocks.mjs
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

const file = new URL('../src/App.svelte', import.meta.url);
let src = readFileSync(file, 'utf8');
let removed = [];

function cut(from, to, label, replacement = '') {
  const i = src.indexOf(from);
  if (i < 0) { console.log('MISS inicio:', label); return false; }
  const j = src.indexOf(to, i + from.length);
  if (j < 0) { console.log('MISS fin:', label); return false; }
  const end = j + to.length;
  removed.push(`${label} (${end - i} chars)`);
  src = src.slice(0, i) + replacement + src.slice(end);
  return true;
}

function swap(from, to, label) {
  if (!src.includes(from)) { console.log('MISS swap:', label); return false; }
  src = src.split(from).join(to);
  removed.push(label);
  return true;
}

// --- 1. Rama demo del panel de lectura (correo de "Sofía" hardcodeado) ---
cut('{:else if activeMail}', '{/if}</article>{:else}<div class="empty-state">{t(\'common.emptyReading\')}</div>{/if}</section>',
  'rama demo del panel de lectura',
  '{/if}</article>{:else}<div class="empty-state">{t(\'common.emptyReading\')}</div>{/if}</section>');

// --- 2. Array de correos demo + activeMail ---
cut('let mails: Mail[] = $state([', ']);\n  const activeMail = $derived(mails[selected]);',
  'array de correos demo + activeMail');

// --- 3. visibleMails: solo datos reales de Graph ---
swap(
  "const graphMails = $derived(unifiedMessages.map((message) => ({ sender: message.sender, address: message.sender, subject: message.subject, preview: message.preview, time: message.receivedAt || '', initials: message.sender.slice(0, 2).toUpperCase(), color: 'lavender', unread: message.unread, starred: message.starred, mailbox: message.mailbox, tag: 'Microsoft 365', hasAttachments: message.hasAttachments, uid: message.id }))); const visibleMails = $derived((activeProvider === 'microsoft-graph' ? graphMails : mails).map((mail, i) => ({ mail, i })).filter(({ mail }) => { const matchesQuery = `${mail.sender} ${mail.address} ${mail.subject} ${mail.preview}`.toLowerCase().includes(search.toLowerCase()); const matchesFolder = currentFolder === 'Favoritos' ? mail.starred : currentFolder === 'Bandeja de entrada' ? true : currentFolder === 'Elementos enviados' ? mail.mailbox === sentFolder : currentFolder === 'Borradores' ? mail.mailbox === draftsFolder : false; const matchesUnread = filterUnread ? mail.unread : true; const matchesAttachments = filterHasAttachments ? mail.hasAttachments : true; return matchesQuery && matchesFolder && matchesUnread && matchesAttachments; }));",
  "const graphMails = $derived(unifiedMessages.map((message) => ({ sender: message.sender, address: message.sender, subject: message.subject, preview: message.preview, time: message.receivedAt || '', initials: message.sender.slice(0, 2).toUpperCase(), color: 'lavender', unread: message.unread, starred: message.starred, mailbox: message.mailbox, tag: 'Microsoft 365', hasAttachments: message.hasAttachments, uid: message.id })));\n  const visibleMails = $derived(graphMails.map((mail, i) => ({ mail, i })).filter(({ mail }) => { const matchesQuery = `${mail.sender} ${mail.address} ${mail.subject} ${mail.preview}`.toLowerCase().includes(search.toLowerCase()); const matchesFolder = currentFolder === 'Favoritos' ? mail.starred : true; const matchesUnread = filterUnread ? mail.unread : true; const matchesAttachments = filterHasAttachments ? mail.hasAttachments : true; return matchesQuery && matchesFolder && matchesUnread && matchesAttachments; }));",
  'visibleMails solo con datos reales de Graph');

// --- 4. Acciones demo ---
swap("  function openMail(i: number) { selected = i; mails[i].unread = false; mobileReadingOpen = true; }\n  function toggleStar(i: number, event: MouseEvent) { event.stopPropagation(); mails[i].starred = !mails[i].starred; }\n", '',
  'funciones openMail/toggleStar');
swap('let selected = $state(0);\n', '', 'estado selected');

// --- 5. Cuenta demo ---
swap("let configuredAccounts = $state<{ name: string; email: string; provider: string }[]>([{ name: 'Estudio Co.', email: 'camila@estudio.co', provider: 'MICROSOFT-GRAPH' }]);",
  "let configuredAccounts = $state<{ name: string; email: string; provider: string }[]>([]);",
  'cuenta demo camila@estudio.co');

// --- 6. Carpetas estáticas con conteos falsos → lista real mínima ---
swap(
  "const folders = [\n    { name: 'Bandeja de entrada', icon: '▣', count: '12' },\n    { name: 'Favoritos', icon: '☆' },\n    { name: 'Borradores', icon: '▤', count: '2' },\n    { name: 'Elementos enviados', icon: '↗' },\n    { name: 'Correo no deseado', icon: '⊘', count: '3' },\n    { name: 'Elementos eliminados', icon: '♲' },\n  ];",
  "// Carpetas base reales: las carpetas del servidor aparecen en la sección nativa tras sincronizar.\n  const folders = [\n    { name: 'Bandeja de entrada', icon: '▣' },\n    { name: 'Favoritos', icon: '☆' },\n  ];",
  'carpetas estáticas → lista real mínima');

// --- 7. Fila demo: solo rama Graph + toggle de estrella local ---
swap("onclick={() => activeProvider === 'microsoft-graph' ? openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage) : openMail(item.i)}",
  "onclick={() => openGraphMessage(unifiedMessages[item.i] as unknown as import('./lib/graph').GraphMessage)}",
  'onclick filas: solo Graph (2 apariciones)');
swap("onclick={(event) => toggleStar(item.i, event)}",
  "onclick={(event) => { event.stopPropagation(); unifiedMessages[item.i].starred = !unifiedMessages[item.i].starred; }}",
  'estrella de fila Graph local');
swap("class:selected={selected === item.i} ", '', 'clase selected en fila demo');

// --- 8. Estados vacíos en la lista ---
swap('{:else}{#each visibleMails as item (item.i)}',
  '{:else if visibleMails.length}{#each visibleMails as item (item.i)}',
  'ramificación de lista');
const emptyList = '</article>{/each}{/if}</div>';
const emptyListNew = `</article>{/each}{:else}<div class="empty-state">{t('list.emptyNoMessages')}</div>{/if}</div>`;
if (src.includes(emptyList)) {
  // Solo la primera aparición corresponde al cierre de la lista de mensajes.
  src = src.replace(emptyList, emptyListNew);
  removed.push('estado vacío de la lista');
} else {
  console.log('MISS estado vacío lista');
}

// --- 9. Pies falsos: "Todo sincronizado" (sidebar) y "Estás al día" duplicado ---
cut('<div class="sidebar-footer">', '</div>', 'pie falso de sincronización (sidebar)');
swap(' <div class="list-bottom"><span>Estás al día</span><span class="bottom-spark">✳</span></div>', '', 'pie falso Estás al día (1)');
swap('<div class="list-bottom"><span>Estás al día</span><span class="bottom-spark">✳</span></div>', '', 'pie falso Estás al día (2)');

writeFileSync(file, src);
console.log('Eliminado:');
for (const item of removed) console.log('  ✔ ' + item);

// --- 10. Archivo demo huérfano ---
const demoFile = new URL('../src/lib/demo-mail.ts', import.meta.url);
if (existsSync(demoFile)) {
  unlinkSync(demoFile);
  console.log('  ✔ src/lib/demo-mail.ts eliminado');
}

// Referencias restantes a verificar a mano.
const leftovers = src.match(/\bmails\b|activeMail|openMail|toggleStar/g);
console.log('Referencias restantes (mails/activeMail/openMail/toggleStar):', leftovers ? [...new Set(leftovers)] : 'ninguna');
