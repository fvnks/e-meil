#!/usr/bin/env node
/**
 * Corrección de contraste WCAG AA para e-Meil (scripts/contrast-fix.mjs).
 *
 * Reemplaza solo valores de `color:` en src/styles.css según un mapa explícito
 * verificado con scripts/contrast-audit.mjs. Los tokens de tema (--accent)
 * se oscurecen para que el texto blanco sobre acento y el acento sobre
 * accent-soft alcancen 4.5:1 en todos los temas.
 *
 * Uso: node scripts/contrast-fix.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/styles.css', import.meta.url);
let css = readFileSync(file, 'utf8');

// --- 1. Tokens de tema -----------------------------------------------
// Blanco sobre acento y acento sobre accent-soft ≥ 4.5:1 en cada tema.
const tokenMap = [
  ['--muted:#91939b', '--muted:#67696f'],
  ['.theme-ocean{--accent:#2d7f9e', '.theme-ocean{--accent:#26718c'],
  ['.theme-forest{--accent:#3d8a69', '.theme-forest{--accent:#357a5c'],
  ['.theme-sunset{--accent:#c66b4f', '.theme-sunset{--accent:#a3523a'],
];

// --- 2. Colores de texto duros ----------------------------------------
// Orden importa: los hex largos antes que sus prefijos (#aaaab0 antes de #aaa).
// var(--muted) = #67696f → 5.49:1 sobre blanco, ≥ 4.5:1 sobre todos los
// fondos claros del sistema (#f5f5f7, #f7f7f9, #efeffa, #faf9ff…).
const colorMap = [
  ['color:#a58250', 'color:#7f5f33'], // pop-logo sobre #f7f1e9 → 5.2:1
  ['color:#a3a4aa', 'color:var(--muted)'],
  ['color:#a2a3aa', 'color:var(--muted)'],
  ['color:#a2a2a8', 'color:var(--muted)'],
  ['color:#a1a2a9', 'color:var(--muted)'],
  ['color:#a1a1a8', 'color:var(--muted)'],
  ['color:#a0a1a8', 'color:var(--muted)'],
  ['color:#a0a1a7', 'color:var(--muted)'],
  ['color:#a0a0a7', 'color:var(--muted)'],
  ['color:#aaaab0', 'color:var(--muted)'],
  ['color:#aaa', 'color:var(--muted)'],
  ['color:#b0b0b6', 'color:var(--muted)'],
  ['color:#b1b1b7', 'color:var(--muted)'],
  ['color:#b66d63', 'color:#a04a41'], // avatar coral sobre #fae7e5 → 5.0:1
  ['color:#b85c59', 'color:#a44a46'], // danger hover sobre #fff0ef → 5.1:1
  ['color:#b86b00', 'color:#965600'], // batch-bar sobre #fff8f0 → 5.5:1
  ['color:#c8c8ce', 'color:#8a8c94'], // estrella inactiva (interactiva) → 3.4:1 (≥3 UI)
  ['color:#e7b95c', 'color:#b8860b'], // estrella activa → 3.3:1 (≥3 UI)
  ['color:#8a744b', 'color:#6f5c35'], // safe-content-notice → 5.9:1
  ['color:#8c654b', 'color:#6f5338'], // avatar peach → 5.9:1
  ['color:#8c8d95', 'color:var(--muted)'],
  ['color:#888', 'color:var(--muted)'],
  ['color:#898a91', 'color:var(--muted)'],
  ['color:#8e88c5', 'color:#6a63b8'], // setup-kicker → 5.1:1
  ['color:#8f9098', 'color:var(--muted)'],
  ['color:#92713f', 'color:#6f5826'], // security-hint → 6.1:1
  ['color:#92939a', 'color:var(--muted)'],
  ['color:#92939b', 'color:var(--muted)'],
  ['color:#92949b', 'color:var(--muted)'],
  ['color:#94949b', 'color:var(--muted)'],
  ['color:#9899a0', 'color:var(--muted)'],
  ['color:#999aa2', 'color:var(--muted)'],
  ['color:#999', 'color:var(--muted)'],
  ['color:#9a9ba3', 'color:var(--muted)'],
  ['color:#9b95dd', 'color:#5f56ae'], // bottom-spark → 6.1:1
  ['color:#9b9ca3', 'color:var(--muted)'],
  ['color:#9b9ca4', 'color:var(--muted)'],
  ['color:#9c9da4', 'color:var(--muted)'],
  ['color:#9c9da5', 'color:var(--muted)'],
  ['color:#7770bd', 'color:#5b53b0'], // .tag sobre #f0eff9 → 5.6:1
  ['color:#7771b7', 'color:var(--accent)'], // back-link → 5.4:1 sobre blanco
  ['color:#777', 'color:var(--muted)'],
  ['color:#777982', 'color:var(--muted)'],
  ['color:#746082', 'color:#5d4a6b'], // mini-art → 6.9:1
  ['color:#7168bb', 'color:var(--accent)'], // provider-badge → 4.7:1
  ['color:#756bc5', 'color:var(--accent)'], // download → 4.7:1 sobre #f5f4fa
  ['color:#7f8089', 'color:var(--muted)'],
  ['color:#597a68', 'color:#48684f'], // sync-banner → 5.2:1
  ['color:#577492', 'color:#47617c'], // avatar blue → 5.4:1
  ['color:#537d66', 'color:#41694f'], // compose-notice → 5.7:1
  ['color:#5a8067', 'color:#48684f'], // avatar sage → 5.2:1
  ['color:#5a8980', 'color:#43736a'], // imap-logo → 4.8:1
  ['color:#4f806a', 'color:#3d6b56'], // setup-message → 5.5:1
];

let applied = 0;
let missed = [];
for (const [from, to] of [...tokenMap, ...colorMap]) {
  if (css.includes(from)) {
    css = css.split(from).join(to);
    applied++;
  } else {
    missed.push(from);
  }
}

writeFileSync(file, css);
console.log(`Reemplazos aplicados: ${applied}/${tokenMap.length + colorMap.length}`);
if (missed.length) console.log('No encontrados (ya corregidos o inexistentes):\n  ' + missed.join('\n  '));
