/**
 * Verificación responsive del asistente rediseñado (≤600px).
 * Requiere Chrome headless con CDP en 9222. Uso: node scripts/verify-setup-responsive.mjs [url]
 */
import { setTimeout as sleep } from 'node:timers/promises';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:5173/';
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('No hay pestaña en Chrome headless.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.addEventListener('open', res); socket.addEventListener('error', rej); });
let nextId = 0; const pending = new Map();
socket.addEventListener('message', (e) => {
  const p = JSON.parse(e.data);
  if (p.id && pending.has(p.id)) { const { resolve, reject } = pending.get(p.id); pending.delete(p.id); p.error ? reject(new Error(p.error.message)) : resolve(p.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: APP_URL });
await sleep(2500);

const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const state = await evaluate(`(() => ({
  setupOpen: !!document.querySelector('.setup-window'),
  brandHidden: getComputedStyle(document.querySelector('.setup-brand')).display === 'none',
  singleColumn: getComputedStyle(document.querySelector('.setup-window')).gridTemplateColumns.split(' ').length === 1,
  tilesStacked: getComputedStyle(document.querySelector('.provider-options')).gridTemplateColumns.split(' ').length === 1,
  formSingleCol: !document.querySelector('.setup-grid') || getComputedStyle(document.querySelector('.setup-grid')).gridTemplateColumns.split(' ').length === 1
}))()`);
record('Asistente abre (onboarding) y lomo oculto en móvil', state.setupOpen && state.brandHidden, JSON.stringify(state));
record('Tarjeta y tiles a una columna', state.singleColumn && state.tilesStacked);
record('Grilla del formulario a una columna', state.formSingleCol);

socket.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas.`);
process.exit(failed.length === 0 ? 0 : 1);
