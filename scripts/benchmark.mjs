/**
 * Benchmark de rendimiento de e-Meil mediante Chrome DevTools Protocol.
 *
 * Mide (sobre la app en desarrollo):
 *  1. Arranque en frío: DOMContentLoaded, load y "app lista" (primera fila de
 *     mensajes renderizada) desde el inicio de la navegación.
 *  2. Métricas agregadas de la carga: ScriptDuration, LayoutDuration,
 *     RecalcStyleDuration y TaskDuration (Performance.getMetrics).
 *  3. Cambios de vista correo → calendario → contactos → correo (mediana de 3).
 *  4. Respuesta de la búsqueda: desde escribir hasta repintar la lista.
 *  5. Drawer móvil: abrir y cerrar (viewport 390×844).
 *  6. Tareas largas (>50 ms) durante la fase de interacción.
 *
 * Presupuestos (falla el script si se exceden):
 *  - App lista < 3000 ms · load < 2500 ms
 *  - Cambio de vista < 350 ms · búsqueda < 150 ms · drawer < 350 ms
 *  - Ninguna tarea larga > 250 ms en la fase de interacción
 *
 * Requiere Chrome headless con CDP:
 *   chrome --headless --remote-debugging-port=9222 --user-data-dir=<tmp>
 * Uso: node scripts/benchmark.mjs [url]
 */
import { setTimeout as sleep } from 'node:timers/promises';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CDP_HTTP = 'http://127.0.0.1:9222';

const BUDGETS = {
  appReadyMs: 3000,
  loadMs: 2500,
  viewSwitchMs: 350,
  searchMs: 150,
  drawerMs: 350,
  longTaskMs: 250
};

async function cdpTargets() {
  const response = await fetch(`${CDP_HTTP}/json/list`);
  return response.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('No se pudo abrir la conexion WebSocket de CDP')));
  });
}

function createClient(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'Error al evaluar en la pagina');
      }
      return result.result.value;
    },
    async setViewport(width, height) {
      await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
    }
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function waitFor(client, expression, timeoutMs = 10_000, stepMs = 50) {
  const start = Date.now();
  for (;;) {
    if (await client.evaluate(expression)) return Date.now() - start;
    if (Date.now() - start > timeoutMs) return -1;
    await sleep(stepMs);
  }
}

async function main() {
  const targets = await cdpTargets();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No se encontro una pestana en Chrome headless.');

  const socket = await connect(page.webSocketDebuggerUrl);
  const client = createClient(socket);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Performance.enable');
  await client.setViewport(1280, 800);

  console.log(`e-Meil benchmark — ${APP_URL}\n`);

  // --- 1-2. Arranque en frío ------------------------------------------------
  const navStart = Date.now();
  await client.send('Page.navigate', { url: APP_URL });
  // "App lista": la bandeja terminó de renderizar (filas reales o estado vacío).
  const readyMs = await waitFor(client, `document.querySelectorAll('.message-row, .messages .empty-state').length > 0`, 15_000, 40);
  const navigation = await client.evaluate(`(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    return entry ? { dcl: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd) } : null;
  })()`);
  const loadMetrics = await client.send('Performance.getMetrics');
  const metric = (name) => Math.round((loadMetrics.metrics.find((m) => m.name === name)?.value ?? 0) * 100) / 100;

  const results = [];
  const record = (name, value, budget, unit = 'ms') => {
    const ok = budget === null || value >= 0 ? (budget === null || value <= budget) : false;
    results.push({ name, value, budget, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${value < 0 ? 'n/d' : `${value}${unit === 'ms' ? ' ms' : ''}`} (presupuesto ${budget === null ? '—' : budget + ' ms'})`);
  };

  record('App lista (primera fila renderizada)', readyMs, BUDGETS.appReadyMs);
  record('DOMContentLoaded', navigation?.dcl ?? -1, BUDGETS.loadMs);
  record('load event', navigation?.load ?? -1, BUDGETS.loadMs);

  console.log(`      ScriptDuration=${metric('ScriptDuration')}s  LayoutDuration=${metric('LayoutDuration')}s  RecalcStyle=${metric('RecalcStyleDuration')}s  TaskDuration=${metric('TaskDuration')}s`);
  await sleep(600);

  // Observador de tareas largas para la fase de interacción.
  await client.evaluate(`(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); })
      .observe({ entryTypes: ['longtask'] });
    return 'observer';
  })()`);

  // --- 3. Cambios de vista --------------------------------------------------
  const switchTimings = { calendar: [], contacts: [], mail: [] };
  for (let run = 0; run < 3; run++) {
    let t = await client.evaluate(`performance.now()`);
    await client.evaluate(`(() => { const rail = Array.from(document.querySelectorAll('.rail-item')); rail[1].click(); return 'ok'; })()`);
    let elapsed = await waitFor(client, `document.querySelectorAll('.month-days .day').length > 0`, 5000, 20);
    switchTimings.calendar.push(Math.round(elapsed));
    t = await client.evaluate(`performance.now()`);
    await client.evaluate(`(() => { const rail = Array.from(document.querySelectorAll('.rail-item')); rail[2].click(); return 'ok'; })()`);
    elapsed = await waitFor(client, `document.querySelectorAll('.contacts-list, .contacts-view .empty-state, .contacts-view').length > 0 && !!document.querySelector('.contacts-view')`, 5000, 20);
    switchTimings.contacts.push(Math.round(elapsed));
    t = await client.evaluate(`performance.now()`);
    await client.evaluate(`(() => { const rail = Array.from(document.querySelectorAll('.rail-item')); rail[0].click(); return 'ok'; })()`);
    elapsed = await waitFor(client, `document.querySelectorAll('.message-row, .messages .empty-state').length > 0`, 5000, 20);
    switchTimings.mail.push(Math.round(elapsed));
  }
  record('Cambio de vista → calendario (mediana)', median(switchTimings.calendar), BUDGETS.viewSwitchMs);
  record('Cambio de vista → contactos (mediana)', median(switchTimings.contacts), BUDGETS.viewSwitchMs);
  record('Cambio de vista → correo (mediana)', median(switchTimings.mail), BUDGETS.viewSwitchMs);

  // --- 4. Búsqueda ----------------------------------------------------------
  const searchTimings = [];
  for (let run = 0; run < 3; run++) {
    searchTimings.push(await client.evaluate(`(async () => {
      const input = document.querySelector('.top-search input');
      input.focus();
      const before = document.querySelectorAll('.message-row').length;
      const start = performance.now();
      input.select();
      document.execCommand('insertText', false, 'identidad');
      let settled = start;
      for (let i = 0; i < 100; i++) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const now = document.querySelectorAll('.message-row').length;
        if (now !== before || input.value === '') { settled = performance.now(); break; }
      }
      input.select();
      document.execCommand('delete');
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      return Math.round(settled - start);
    })()`));
  }
  record('Búsqueda: tecla → lista repintada (mediana)', median(searchTimings), BUDGETS.searchMs);

  // --- 5. Drawer móvil ------------------------------------------------------
  await client.setViewport(390, 844);
  await sleep(400);
  const drawerTimings = [];
  for (let run = 0; run < 3; run++) {
    drawerTimings.push(await client.evaluate(`(async () => {
      const start = performance.now();
      document.querySelector('.menu-button').click();
      let settled = start;
      for (let i = 0; i < 100; i++) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const rect = document.getElementById('sidebar').getBoundingClientRect();
        if (rect.left >= -2) { settled = performance.now(); break; }
      }
      const closeStart = performance.now();
      document.querySelector('.drawer-backdrop').click();
      let closed = closeStart;
      for (let i = 0; i < 100; i++) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const rect = document.getElementById('sidebar').getBoundingClientRect();
        if (rect.right < 8) { closed = performance.now(); break; }
      }
      return Math.round(Math.max(settled - start, closed - closeStart));
    })()`));
  }
  record('Drawer móvil: abrir + cerrar (mediana)', median(drawerTimings), BUDGETS.drawerMs);
  await client.setViewport(1280, 800);

  // --- 6. Tareas largas de la fase de interacción ----------------------------
  await sleep(300);
  const longTasks = await client.evaluate(`window.__longTasks ?? []`);
  const worst = longTasks.length ? Math.max(...longTasks) : 0;
  console.log(`      Tareas largas (>50 ms) en interacción: ${longTasks.length}; peor = ${worst} ms`);
  record('Peor tarea larga en interacción', worst, BUDGETS.longTaskMs);

  socket.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} presupuestos superados.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(2);
});
