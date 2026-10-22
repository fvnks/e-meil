#!/usr/bin/env node
/**
 * Auditoría de contraste WCAG 2.1 para e-Meil (scripts/contrast-audit.mjs).
 *
 * Extrae cada regla de styles.css que declara `color:` y resuelve el fondo
 * efectivo (propio, heredado del selector ancestral o :root) para calcular el
 * ratio de contraste. Reporta los pares que no alcanzan AA:
 *   - 4.5:1 texto normal
 *   - 3:1   texto grande (>= 18.66px bold o >= 24px) y componentes UI
 *
 * Uso: node scripts/contrast-audit.mjs
 */

import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// ---------- utilidades de color ----------
function parseColor(token) {
  token = token.trim();
  if (NAMED[token.toLowerCase()]) token = NAMED[token.toLowerCase()];
  if (token.startsWith('#')) {
    let h = token.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const m = token.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map((v) => parseFloat(v));
    return { r, g, b, a };
  }
  return null;
}

const THEMES = {
  default: { '--accent': '#6557d9', '--accent-ink': '#6557d9', '--accent-soft': '#efeffa', '--ink': '#292b30', '--muted': '#67696f', '--line': '#e9eaed', '--paper': '#ffffff', '--surface': '#f4f5f7', '--surface-raised': '#fafafc', '--surface-input': '#f5f5f7' },
  ocean: { '--accent': '#26718c', '--accent-ink': '#26718c', '--accent-soft': '#e7f2f5' },
  forest: { '--accent': '#357a5c', '--accent-ink': '#357a5c', '--accent-soft': '#e8f4ed' },
  sunset: { '--accent': '#a3523a', '--accent-ink': '#a3523a', '--accent-soft': '#faeee9' },
  graphite: { '--accent': '#4e5868', '--accent-ink': '#4e5868', '--accent-soft': '#edf0f3' },
  'dark-violet': { '--accent': '#6557d9', '--accent-ink': '#9c91f7', '--accent-soft': '#262044', '--ink': '#e8e9ec', '--muted': '#a0a3ab', '--line': '#30323a', '--paper': '#1f2126', '--surface': '#141519', '--surface-raised': '#1a1c21', '--surface-input': '#23252b' },
  'dark-ocean': { '--accent': '#26718c', '--accent-ink': '#7fc0dc', '--accent-soft': '#14313d', '--ink': '#e8e9ec', '--muted': '#a0a3ab', '--line': '#30323a', '--paper': '#1f2126', '--surface': '#141519', '--surface-raised': '#1a1c21', '--surface-input': '#23252b' },
  'dark-forest': { '--accent': '#357a5c', '--accent-ink': '#7cc4a4', '--accent-soft': '#143428', '--ink': '#e8e9ec', '--muted': '#a0a3ab', '--line': '#30323a', '--paper': '#1f2126', '--surface': '#141519', '--surface-raised': '#1a1c21', '--surface-input': '#23252b' },
  'dark-sunset': { '--accent': '#a3523a', '--accent-ink': '#e5a08b', '--accent-soft': '#3d241d', '--ink': '#e8e9ec', '--muted': '#a0a3ab', '--line': '#30323a', '--paper': '#1f2126', '--surface': '#141519', '--surface-raised': '#1a1c21', '--surface-input': '#23252b' },
  'dark-graphite': { '--accent': '#4e5868', '--accent-ink': '#b3bcc9', '--accent-soft': '#262b33', '--ink': '#e8e9ec', '--muted': '#a0a3ab', '--line': '#30323a', '--paper': '#1f2126', '--surface': '#141519', '--surface-raised': '#1a1c21', '--surface-input': '#23252b' },
};

const NAMED = { white: '#ffffff', black: '#000000', transparent: 'rgba(0,0,0,0)' };

function resolveVar(token, vars) {
  const m = token.match(/var\((--[a-z0-9-]+)\)/);
  if (!m) return token;
  const name = m[1];
  for (const scope of vars) {
    if (scope[name]) return scope[name];
  }
  return null;
}

function luminance({ r, g, b }) {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- parse de reglas ----------
// Divide el CSS en reglas top-level (sin @media anidado complejo; suficiente aquí).
function splitRules(text) {
  const rules = [];
  let depth = 0;
  let start = 0;
  let headerStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        rules.push({ header: text.slice(headerStart, start).trim(), body: text.slice(start + 1, i) });
        headerStart = i + 1;
      }
    }
  }
  return rules;
}

const rules = splitRules(css);

// Mapa selector -> declaraciones, para resolver herencia de background.
const declared = []; // { selectors: [sel...], decl: {prop: value}, media }
for (const rule of rules) {
  if (rule.header.startsWith('@media')) {
    for (const inner of splitRules(rule.body)) {
      declared.push({ selectors: inner.header.split(',').map((s) => s.trim()), decl: parseDecls(inner.body), media: rule.header });
    }
  } else if (rule.header.startsWith('@keyframes') || rule.header.startsWith('@import')) {
    continue;
  } else {
    declared.push({ selectors: rule.header.split(',').map((s) => s.trim()), decl: parseDecls(rule.body), media: null });
  }
}

function parseDecls(body) {
  const decl = {};
  for (const part of body.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    decl[prop] = part.slice(idx + 1).trim();
  }
  return decl;
}

// Encuentra el fondo efectivo subiendo por la cascada de selectores "ancestros".
// Heurística: si el selector es ".a .b" y existe ".a" con background, aplica.
function effectiveBackground(selectors, themeVars) {
  for (const sel of selectors) {
    // Ignora pseudo-clases/pseudo-elementos para hallar el fondo del elemento base.
    const chain = sel
      .replace(/::?[a-z-]+(\([^)]*\))?/gi, '')
      .replace(/>/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    // recorre del ancestro más lejano al propio
    for (let i = chain.length; i >= 1; i--) {
      const partial = chain.slice(0, i).join(' ');
      for (const rule of declared) {
        if (!rule.decl['background'] && !rule.decl['background-color']) continue;
        for (const rs of rule.selectors) {
          const rsBase = rs.replace(/::?[a-z-]+(\([^)]*\))?/gi, '').trim();
          if (rsBase === partial || rsBase === chain[i - 1]) {
            const bg = rule.decl['background'] ?? rule.decl['background-color'];
            const resolved = resolveColorToken(bg, themeVars);
            // Ignora fondos ausentes o translúcidos: el fondo efectivo está más arriba.
            if (resolved && resolved.a >= 0.5) return { bg: resolved, from: rs };
          }
        }
      }
    }
  }
  // Fondo heredado por defecto: el panel/superficie del tema (blanco en claro,
  // --paper oscuro en modo oscuro), no un blanco absoluto.
  const inherited = themeVars.map((scope) => scope['--paper']).find(Boolean);
  return { bg: parseColor(inherited ?? '#ffffff'), from: `paper heredado (${inherited ?? '#ffffff'})` };
}

function resolveColorToken(token, themeVars) {
  if (!token) return null;
  token = token.trim();
  if (token.includes('gradient')) return null; // no calculable, se omite
  if (token.startsWith('var(')) {
    const name = token.match(/var\((--[a-z0-9-]+)/)?.[1];
    for (const scope of themeVars) if (scope[name]) return parseColor(scope[name]);
    return null;
  }
  return parseColor(token);
}

// ---------- evaluación ----------
const DARK_SCOPES = new Set(['dark-violet', 'dark-ocean', 'dark-forest', 'dark-sunset', 'dark-graphite']);
const results = [];
for (const themeName of Object.keys(THEMES)) {
  const isDark = DARK_SCOPES.has(themeName);
  const themeVars = [THEMES[themeName], THEMES.default];
  for (const rule of declared) {
    // Las reglas con scope .dark solo aplican en modo oscuro; el resto, en claro.
    const ruleIsDark = rule.selectors.some((selector) => selector.includes('.dark'));
    if (ruleIsDark !== isDark) continue;
    const colorTok = rule.decl['color'];
    if (!colorTok || colorTok === 'inherit') continue;
    // Solo evalúa selectores que pueden contener texto en este tema
    const fg = resolveColorToken(colorTok, themeVars);
    if (!fg || fg.a < 0.5) continue;
    const { bg, from } = effectiveBackground(rule.selectors, themeVars);
    const r = ratio(fg, bg);
    const fs = parseFloat(rule.decl['font-size']);
    const fw = parseInt(rule.decl['font-weight']) || 400;
    const large = !Number.isNaN(fs) && (fs >= 24 || (fs >= 18.66 && fw >= 700));
    const threshold = large ? 3 : 4.5;
    if (r < threshold) {
      results.push({
        theme: themeName,
        selector: rule.selectors.join(', ').slice(0, 60),
        fg: colorTok.slice(0, 20),
        bgFrom: from.slice(0, 40),
        ratio: r.toFixed(2),
        need: threshold,
        fontSize: rule.decl['font-size'] || '',
      });
    }
  }
}

// Deduplica (mismo selector+par en varios temas comparte base blanca)
const seen = new Set();
const unique = results.filter((item) => {
  const key = `${item.selector}|${item.fg}|${item.bgFrom}|${item.need}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// Ordena por gravedad
unique.sort((a, b) => a.ratio - b.ratio);

console.log(`Pares bajo umbral WCAG AA: ${unique.length} (de ${declared.length} reglas con color)\n`);
for (const item of unique) {
  console.log(
    `[${item.theme}] ${item.selector}\n    color ${item.fg} sobre ${item.bgFrom} → ${item.ratio}:1 (necesita ${item.need}:1)${item.fontSize ? ` | font-size ${item.fontSize}` : ''}`
  );
}
