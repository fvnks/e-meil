/**
 * Migración de glifos unicode → sistema Icon.svelte (sesión 16).
 * Uso: node scripts/icon-migrate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const appFile = new URL('../src/App.svelte', import.meta.url);
let app = readFileSync(appFile, 'utf8');
const report = [];

// [buscar, reemplazo, etiqueta, todas?]
const EXACT = [
  // --- rail ---
  [`<span>\u2709</span><i></i>`, `<Icon name="mail" size={17} /><i></i>`, 'rail mail'],
  [`onclick={() => activeView = 'calendar'}><span>\u25A6</span>`, `onclick={() => activeView = 'calendar'}><Icon name="calendar" size={17} />`, 'rail calendar'],
  [`onclick={() => activeView = 'contacts'}><span>\u2659</span>`, `onclick={() => activeView = 'contacts'}><Icon name="contacts" size={17} />`, 'rail contacts'],
  [`onclick={() => settingsOpen = true}><span>\u2699</span>`, `onclick={() => settingsOpen = true}><Icon name="sliders" size={17} />`, 'rail settings'],
  [`use:tooltip={t('rail.more')} aria-label={t('rail.more')}><span>\u229E</span>`, `use:tooltip={t('rail.more')} aria-label={t('rail.more')}><Icon name="grid" size={17} />`, 'rail more'],
  // --- topbar ---
  [`<span class="search-icon">\u2315</span>`, `<span class="search-icon"><Icon name="search" size={15} /></span>`, 'topbar search'],
  [`aria-label={t('topbar.help')}>?</button>`, `aria-label={t('topbar.help')}><Icon name="help" size={15} /></button>`, 'topbar help'],
  [`onclick={() => themeOpen = !themeOpen}>\u2699</button>`, `onclick={() => themeOpen = !themeOpen}><Icon name="palette" size={15} /></button>`, 'topbar theme'],
  // --- sidebar ---
  [`onclick={() => composeOpen = true}><span>\uFF0B</span> {t('sidebar.compose')}`, `onclick={() => composeOpen = true}><Icon name="plus" size={14} /> {t('sidebar.compose')}`, 'sidebar compose'],
  [`aria-label={t('sidebar.foldersOptions')}>\u00B7\u00B7\u00B7</button>`, `aria-label={t('sidebar.foldersOptions')}><Icon name="dots" size={13} /></button>`, 'sidebar foldersOptions'],
  [`aria-label={t('sidebar.addAccount')}>\uFF0B</button>`, `aria-label={t('sidebar.addAccount')}><Icon name="plus" size={13} /></button>`, 'sidebar addAccount'],
  // --- carpetas base ---
  [`icon: '\u25A3'`, `icon: 'inbox'`, 'folder inbox icon'],
  [`icon: '\u2606'`, `icon: 'star'`, 'folder star icon'],
  [`<span class="folder-icon">{folder.icon}</span>`, `<span class="folder-icon"><Icon name={folder.icon} size={13} /></span>`, 'folder icon render'],
  // --- herramientas de lista ---
  [`aria-label="Ordenar">\u2195</button>`, `aria-label="Ordenar"><Icon name="sort" size={14} /></button>`, 'tool sort'],
  [`{syncing ? '\u2026' : '\u27F3'}`, `<Icon name="refresh" size={14} />`, 'tool refresh'],
  // --- pills de filtros ---
  [`<span class="filter-pill">\u2709 {t('filters.unread')}</span>`, `<span class="filter-pill"><Icon name="mail" size={12} /> {t('filters.unread')}</span>`, 'pill unread'],
  [`<span class="filter-pill">\u2301 {t('filters.attachments')}</span>`, `<span class="filter-pill"><Icon name="paperclip" size={12} /> {t('filters.attachments')}</span>`, 'pill attachments'],
  // --- panel de lectura: volver ---
  [`mobileReadingOpen = false; }}>\u2190</button>`, `mobileReadingOpen = false; }}><Icon name="back" size={14} /></button>`, 'imap back'],
  // --- herramientas Graph ---
  [`onclick={() => graphAction('archive')}>\u25A3</button>`, `onclick={() => graphAction('archive')}><Icon name="archive" size={14} /></button>`, 'graph archive'],
  [`onclick={() => graphAction('delete')}>\u2672</button>`, `onclick={() => graphAction('delete')}><Icon name="trash" size={14} /></button>`, 'graph delete'],
  // --- estrellas de filas ---
  [`{mail.starred ? '\u2605' : '\u2606'}`, `<Icon name="star" size={13} />`, 'row star imap'],
  [`{item.mail.starred ? '\u2605' : '\u2606'}`, `<Icon name="star" size={13} />`, 'row star graph'],
  // --- descarga de adjunto ---
  [`title={t('reading.saveAttachment')}>\u2193</button>`, `title={t('reading.saveAttachment')}><Icon name="download" size={14} /></button>`, 'download attachment'],
  // --- toast ---
  [`<div class="toast">\u2713 <span>`, `<div class="toast"><Icon name="check" size={13} /> <span>`, 'toast check'],
  // --- ribbon del redactor ---
  [`onclick={() => addAttachments()}><span>\u2301</span><small>`, `onclick={() => addAttachments()}><Icon name="paperclip" size={14} /><small>`, 'ribbon attach'],
  [`execFormat('undo')}>\u2936<small>`, `execFormat('undo')}><Icon name="undo" size={14} /><small>`, 'ribbon undo'],
  [`execFormat('redo')}>\u2937<small>`, `execFormat('redo')}><Icon name="redo" size={14} /><small>`, 'ribbon redo'],
  [`title={t('compose.saveDraft')} onclick={saveDraft}>\u2304</button>`, `title={t('compose.saveDraft')} onclick={saveDraft}><Icon name="save" size={14} /></button>`, 'compose save draft'],
  [`'Enviar'} <span>\u2197</span>`, `'Enviar'} <Icon name="send" size={14} />`, 'compose send'],
  // --- menú contextual ---
  [`contextAction('open')}>\u25A3 <span>`, `contextAction('open')}><Icon name="mail" size={13} /> <span>`, 'ctx open'],
  [`contextAction('read')}>\u2709 <span>`, `contextAction('read')}><Icon name="seen" size={13} /> <span>`, 'ctx read'],
  [`contextAction('star')}>\u2606 <span>`, `contextAction('star')}><Icon name="star" size={13} /> <span>`, 'ctx star'],
  [`contextAction('delete')} class="danger">\u2672 <span>`, `contextAction('delete')} class="danger"><Icon name="trash" size={13} /> <span>`, 'ctx delete'],
  [`contextAction('compose')}>\uFF0B <span>`, `contextAction('compose')}><Icon name="plus" size={13} /> <span>`, 'ctx compose'],
  [`syncImapAccount()}>\u27F3 <span>`, `syncImapAccount()}><Icon name="refresh" size={13} /> <span>`, 'ctx sync'],
];

// Reemplazos por regex: [regex, reemplazo, etiqueta, todas?]
const REGEX = [
  // Botón "Filtrar" (glifo variable antes del span).
  [/\}(?:\s?)([^\x00-\x7F]{1,3}) <span>\{t\('filters\.trigger'\)\}/, `}<Icon name="funnel" size={13} /> <span>{t('filters.trigger')}`, 'filter trigger', false],
  // Chevron ⌄ en spans.
  [/<span class="chevron">\u2304<\/span>/g, `<Icon name="chevron-down" size={12} />`, 'chevron spans', true],
  // Carpetas nativas: ternario de glifos → nombres de icono.
  [/<span class="folder-icon">\{folder\.specialUse === 'Sent' \? '[^']*' : folder\.specialUse === 'Archive' \? '[^']*' : '[^']*'\}<\/span>/, `<span class="folder-icon"><Icon name={folder.specialUse === 'Sent' ? 'send' : folder.specialUse === 'Archive' ? 'archive' : 'inbox'} size={13} /></span>`, 'native folder ternary', false],
  // Responder / reenviar (2 ramas cada uno).
  [/>(?:\s?)([^\x00-\x7F]{1,3}) <span>\{t\('common\.reply'\)\}/g, `><Icon name="reply" size={13} /> <span>{t('common.reply')}`, 'reply buttons', true],
  [/>(?:\s?)([^\x00-\x7F]{1,3}) <span>\{t\('common\.forward'\)\}/g, `><Icon name="forward" size={13} /> <span>{t('common.forward')}`, 'forward buttons', true],
  // Ribbon: lista / alinear / firma (glifo variable antes de <small>).
  [/execFormat\('list'\)\}>(?:\s?)([^\x00-\x7F]{1,3})<small>/, `execFormat('list')}><Icon name="list" size={14} /><small>`, 'ribbon list', false],
  [/execFormat\('align'\)\}>(?:\s?)([^\x00-\x7F]{1,3})<small>/, `execFormat('align')}><Icon name="align" size={14} /><small>`, 'ribbon align', false],
  [/insertText', false, '\\n' \+ signature\);\s*\}\}>(?:\s?)([^\x00-\x7F]{1,3})<small>/, `insertText', false, '\\n' + signature); }}><Icon name="pen" size={14} /><small>`, 'ribbon signature', false],
];

let total = 0;
for (const [from, to, label, all] of EXACT) {
  const n = app.split(from).length - 1;
  if (n > 0) {
    app = app.split(from).join(to);
    report.push(`OK   ${label} (${n}${n > 1 && !all ? ' — revisar cantidad' : 'x'})`);
    total += n;
  } else {
    report.push(`MISS ${label}`);
  }
}
for (const [re, to, label, all] of REGEX) {
  const matches = app.match(re);
  if (matches) {
    app = all ? app.replace(re, to) : app.replace(re, to);
    report.push(`OK   ${label} (${matches.length}x${all ? '' : ' primera'})`);
    total += matches.length;
  } else {
    report.push(`MISS ${label}`);
  }
}

writeFileSync(appFile, app);
console.log(report.join('\n'));
console.log('\nTotal reemplazos:', total);
