#!/usr/bin/env node
/**
 * Tokenización de superficies para el modo oscuro de e-Meil (scripts/dark-mode.mjs).
 *
 * Convierte los colores hardcodeados estructurales de src/styles.css en tokens
 * semánticos (--surface, --surface-raised, --surface-input, --paper, --ink,
 * --muted, --line, --accent-ink, --accent-soft) para que el bloque `.dark`
 * pueda redefinirlos. Los chips decorativos (avatares, logos de proveedor,
 * banners semánticos, celda "hoy") se mantienen claros en ambos modos: su
 * contraste interno ya fue verificado con scripts/contrast-audit.mjs.
 *
 * Los reemplazos usan límites de hex (lookahead) para no corromper valores
 * con prefijos compartidos (#fff vs #fff8e1).
 *
 * Uso: node scripts/dark-mode.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/styles.css', import.meta.file ? import.meta.url : import.meta.url);
let css = readFileSync(file, 'utf8');

// [patrón, reemplazo] — se aplican en orden.
const REPLACEMENTS = [
  // --- fondos: superficies estructurales ---
  [/background:#fff(?![0-9a-fA-F])/g, 'background:var(--paper)'],
  [/background:white(?![0-9a-fA-F])/g, 'background:var(--paper)'],
  [/background:#f4f5f7(?![0-9a-fA-F])/g, 'background:var(--surface)'],
  [/background:#f8f8fb(?![0-9a-fA-F])/g, 'background:var(--surface-raised)'],
  [/background:#f7f7fa(?![0-9a-fA-F])/g, 'background:var(--surface-raised)'],
  [/background:#fafafa(?![0-9a-fA-F])/g, 'background:var(--surface-raised)'],
  [/background:#f6f6f9(?![0-9a-fA-F])/g, 'background:var(--surface-input)'],
  [/background:#f5f4fc(?![0-9a-fA-F])/g, 'background:var(--surface-input)'],
  [/background:#f5f4fa(?![0-9a-fA-F])/g, 'background:var(--surface-input)'],
  [/background:#f5f5fa(?![0-9a-fA-F])/g, 'background:var(--surface-input)'],
  // --- fondos: tintes de acento (hover/chips interactivos) ---
  [/background:#f0eff8(?![0-9a-fA-F])/g, 'background:var(--accent-soft)'],
  [/background:#ede9ff(?![0-9a-fA-F])/g, 'background:var(--accent-soft)'],
  [/background:#f7f6fc(?![0-9a-fA-F])/g, 'background:var(--accent-soft)'],
  [/background:#f1f0fa(?![0-9a-fA-F])/g, 'background:var(--accent-soft)'],
  [/background:#f0eff9(?![0-9a-fA-F])/g, 'background:var(--accent-soft)'],
  [/background:#faf9ff(?![0-9a-fA-F])/g, 'background:var(--accent-soft)'],
  [/box-shadow:0 0 0 2px #efedfb(?![0-9a-fA-F])/g, 'box-shadow:0 0 0 2px var(--accent-soft)'],
  [/background:#e1e1e6(?![0-9a-fA-F])/g, 'background:var(--line)'],
  // --- bordes estructurales ---
  [/solid #e9e9ed(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #f0f0f2(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #eeeef1(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #ededf0(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e5e5e9(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e8e8ec(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #ebebee(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e7e7eb(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e2e2e8(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #efeff1(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e5e5eb(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e4e4e9(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #ececf0(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e7e7ea(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #f1f1f3(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #e5e4ec(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/solid #d9d9df(?![0-9a-fA-F])/g, 'solid var(--line)'],
  [/border-color:#9b92df(?![0-9a-fA-F])/g, 'border-color:var(--accent)'],
  [/border-color:#a9a1e8(?![0-9a-fA-F])/g, 'border-color:var(--accent)'],
  // --- texto: primario ---
  [/color:#444(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  [/color:#45464d(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  [/color:#42434b(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  [/color:#333(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  [/color:#303137(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  [/color:#35363c(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  [/color:#2d2e33(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  [/color:#393939(?![0-9a-fA-F])/g, 'color:var(--ink)'],
  // --- texto: secundario ---
  [/color:#55565e(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#555760(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#555(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#5e6068(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#666(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#65666e(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#686a72(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#6f7179(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#73747c(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  [/color:#74757d(?![0-9a-fA-F])/g, 'color:var(--muted)'],
  // --- texto: acento (token claro en modo oscuro) ---
  [/color:#6559c3(?![0-9a-fA-F])/g, 'color:var(--accent-ink)'],
  [/color:#5e52c9(?![0-9a-fA-F])/g, 'color:var(--accent-ink)'],
  [/color:#6557d9(?![0-9a-fA-F])/g, 'color:var(--accent-ink)'],
  [/color:#6257d1(?![0-9a-fA-F])/g, 'color:var(--accent-ink)'],
  [/color:#6a63b8(?![0-9a-fA-F])/g, 'color:var(--accent-ink)'],
  [/color:#5f56ae(?![0-9a-fA-F])/g, 'color:var(--accent-ink)'],
  [/color:#5b53b0(?![0-9a-fA-F])/g, 'color:var(--accent-ink)'],
  [/color:var\(--accent\)/g, 'color:var(--accent-ink)'],
  // --- celda "hoy" mantiene chip claro: texto oscuro fijo en ambos modos ---
  [/\.day\.today\{background:#fff8e1;border-color:var\(--accent\)\}/g, '.day.today{background:#fff8e1;border-color:var(--accent);color:#292b30}'],
];

let applied = 0;
let misses = [];
for (const [pattern, replacement] of REPLACEMENTS) {
  const found = css.match(pattern);
  if (found && found.length) {
    css = css.replace(pattern, replacement);
    applied += found.length;
  } else {
    misses.push(pattern.source);
  }
}

writeFileSync(file, css);
console.log(`Reemplazos aplicados: ${applied}`);
if (misses.length) console.log('Patrones sin coincidencia:\n  ' + misses.join('\n  '));
