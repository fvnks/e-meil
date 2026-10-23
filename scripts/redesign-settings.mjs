/**
 * Convierte Ajustes en ventana flotante con el estilo del asistente (sesión 15).
 * - Extrae las tarjetas de la vista `activeView === 'settings'`.
 * - Crea un modal con el shell del asistente (lomo + main) y las mismas clases.
 * Uso: node scripts/redesign-settings.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const appFile = new URL('../src/App.svelte', import.meta.url);
let app = readFileSync(appFile, 'utf8');

// ---------- 1. Extraer el contenido actual de la vista settings ----------
const viewStart = app.indexOf("{:else if activeView === 'settings'}");
const viewEnd = app.indexOf('      {/if}\n      <section class="reading-pane"', viewStart);
if (viewStart < 0 || viewEnd < 0) throw new Error('No se encontró la vista de ajustes: ' + viewStart + ',' + viewEnd);
const block = app.slice(viewStart, viewEnd);
// El bloque tiene: {:else if ...}<section class="settings-view" ...> ... </section>\n
const secStart = block.indexOf('<section class="settings-view"');
const secEnd = block.lastIndexOf('</section>');
const inner = block.slice(block.indexOf('>', secStart) + 1, secEnd).trim();
// Dentro: calendar-header + settings-body(+notice) → solo nos quedamos con settings-body
const bodyStart = inner.indexOf('<div class="settings-body">');
const cards = inner.slice(bodyStart, inner.lastIndexOf('</div>'));
console.log('tarjetas extraídas:', cards.length, 'chars');

// ---------- 2. Quitar la vista del main ----------
app = app.slice(0, viewStart) + app.slice(viewEnd);
console.log('vista de ajustes removida del main');

// ---------- 3. Nuevo modal flotante ----------
const NAV = `<ol class="settings-nav"><li><a href="#settings-accounts">{t('settings.accounts')}</a></li><li><a href="#settings-sync">{t('settings.sync')}</a></li><li><a href="#settings-compose">{t('settings.composeTitle')}</a></li><li><a href="#settings-appearance">{t('settings.appearance')}</a></li><li><a href="#settings-data">{t('settings.dataTitle')}</a></li><li><a href="#settings-about">{t('settings.about')}</a></li></ol>`;
const NEW_MODAL = `{#if settingsOpen}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) settingsOpen = false; }}><section class="setup-window settings-window" role="dialog" aria-modal="true" aria-label={t('settings.title')}><aside class="setup-brand"><div class="setup-brand-mark">${''}<svg width="22" height="19" viewBox="0 0 24 20" fill="none" aria-hidden="true"><path d="M3 5.5 12 12l9-6.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span class="setup-brand-name">e-meil</span><p class="setup-brand-tagline">{t('settings.title')}</p>${NAV}<span class="setup-brand-version">v0.1.0 · MIT</span></aside><div class="setup-main"><header class="setup-header"><div><span class="setup-kicker">e-MEIL</span><h2>{t('settings.title')}</h2><p>{t('settings.subtitle')}</p></div><button class="setup-close" type="button" onclick={() => settingsOpen = false} aria-label={t('common.close')}>×</button></header><div class="settings-body" onkeydown={(e) => e.stopPropagation()}>${''}
__CARDS__
</div></div></section></div>{/if}
`;

// Anclas por tarjeta: envolver cada settings-card con id
let cardsWithAnchors = cards
  .replace('<div class="settings-card">\n            <h3>{t(\'settings.accounts\')}', '<div class="settings-card" id="settings-accounts">\n            <h3>{t(\'settings.accounts\')}')
  .replace('<div class="settings-card">\n            <h3>{t(\'settings.sync\')}', '<div class="settings-card" id="settings-sync">\n            <h3>{t(\'settings.sync\')}')
  .replace('<div class="settings-card">\n            <h3>{t(\'settings.composeTitle\')}', '<div class="settings-card" id="settings-compose">\n            <h3>{t(\'settings.composeTitle\')}')
  .replace('<div class="settings-card">\n            <h3>{t(\'settings.appearance\')}', '<div class="settings-card" id="settings-appearance">\n            <h3>{t(\'settings.appearance\')}')
  .replace('<div class="settings-card">\n            <h3>{t(\'settings.dataTitle\')}', '<div class="settings-card" id="settings-data">\n            <h3>{t(\'settings.dataTitle\')}')
  .replace('<div class="settings-card">\n            <h3>{t(\'settings.about\')}', '<div class="settings-card" id="settings-about">\n            <h3>{t(\'settings.about\')}');
if (cardsWithAnchors === cards) console.log('WARN: no se insertaron anclas (revisar formato de tarjetas)');

const modal = NEW_MODAL.replace('__CARDS__', cardsWithAnchors);

// Insertar el modal después del bloque del asistente de cuentas.
const insertAt = app.indexOf('{#if contextMenu}');
if (insertAt < 0) throw new Error('No se encontró el bloque del menú contextual');
app = app.slice(0, insertAt) + modal + app.slice(insertAt);
console.log('modal de ajustes insertado');

writeFileSync(appFile, app);
console.log('App.svelte actualizado');
