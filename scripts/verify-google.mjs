/**
 * Sesión 23: verifica el tile/step de Gmail en el asistente (CDP por WebSocket).
 * Uso: node scripts/verify-google.mjs [url]
 */
const APP_URL = process.argv[2] ?? 'http://127.0.0.1:5199/';
const CDP_HTTP = 'http://127.0.0.1:9222';
const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickTarget() {
  const list = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  return list.find((t) => t.type === 'page');
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('No se pudo conectar a CDP')));
  });
}
function client(socket) {
  let id = 0; const pending = new Map();
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  return (method, params = {}) => new Promise((resolve) => {
    const callId = ++id; pending.set(callId, resolve);
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
}
async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text + ' ' + JSON.stringify(res.result.exceptionDetails.exception?.preview?.properties ?? ''));
  return res.result?.result?.value;
}

const target = await pickTarget();
const socket = await connect(target.webSocketDebuggerUrl);
const send = client(socket);
await send('Page.enable'); await send('Runtime.enable');
// Forzar viewport escritorio para que la grilla de 2 columnas esté activa.
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: APP_URL });
await sleep(2500);
// Cerrar onboarding si se abrió solo.
await evaluate(send, `(() => { const close = document.querySelector('.setup-close'); if (close) close.click(); return true; })()`);
await sleep(300);

// 1) Abrir Ajustes → Añadir cuenta → asistente.
await evaluate(send, `(() => { [...document.querySelectorAll('.rail-item')].find((b) => /ajustes|settings/i.test(b.getAttribute('aria-label') || ''))?.click(); return true; })()`);
await sleep(400);
await evaluate(send, `(() => { [...document.querySelectorAll('.settings-window button')].find((b) => /añadir cuenta|add account/i.test(b.textContent || ''))?.click(); return true; })()`);
await sleep(500);

// 2) Tiles del asistente: deben ser 4 e incluir Gmail.
const tiles = await evaluate(send, `(() => Array.from(document.querySelectorAll('.provider-choice')).map(b => (b.querySelector('strong')?.textContent || '').trim()))()`);
record('Asistente con 4 tiles de proveedor', Array.isArray(tiles) && tiles.length === 4, JSON.stringify(tiles));
record('Existen tile de Gmail', Array.isArray(tiles) && tiles.includes('Gmail'));

// 3) Grilla 2 columnas para 4 tiles.
const gridCols = await evaluate(send, `(() => getComputedStyle(document.querySelector('.provider-options')).gridTemplateColumns.split(' ').length)()`);
record('Grilla de proveedores a 2 columnas', gridCols === 2, String(gridCols));

// 4) Entrar al paso Gmail.
await evaluate(send, `(() => { Array.from(document.querySelectorAll('.provider-choice')).find(b => (b.querySelector('strong')?.textContent || '') === 'Gmail')?.click(); return true; })()`);
await sleep(300);
const state = await evaluate(send, `(() => ({
  badge: document.querySelector('.provider-badge')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  explainer: document.querySelector('.oauth-explainer')?.textContent ?? '',
  googleButton: document.querySelector('.oauth-button')?.textContent?.trim() ?? '',
  serverInputs: document.querySelectorAll('.server-block input, .setup-grid input').length,
  submitButton: !!document.querySelector('.setup-submit'),
  footerLabels: Array.from(document.querySelectorAll('footer button')).map(b => b.textContent.trim()),
}))()`);
record('Badge Gmail · OAuth', state.badge.includes('Gmail') && state.badge.includes('OAuth'), state.badge);
record('Explicador OAuth con aviso Thunderbird', state.explainer.includes('OAuth') && state.explainer.includes('Thunderbird'), state.explainer.slice(0, 110));
record('Botón de inicio de sesión de Google', state.googleButton.includes('Google'), state.googleButton);
record('Sin campos de servidor/contraseña', state.serverInputs === 0, String(state.serverInputs));
record('Sin botón de guardado manual', state.submitButton === false, JSON.stringify(state.footerLabels));
record('El pie mantiene Cancelar sin prueba de conexión', !state.footerLabels.some(t => /probar conexión|test connection/i.test(t)), JSON.stringify(state.footerLabels));

// 5) Volver al paso 1 intacto.
await evaluate(send, `(() => { document.querySelector('.back-link')?.click(); return true; })()`);
await sleep(250);
const back = await evaluate(send, `(() => Array.from(document.querySelectorAll('.provider-choice')).length)()`);
record('Vuelta al paso 1 con 4 tiles', back === 4, String(back));

const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} comprobaciones superadas.`);
socket.close();
process.exit(pass === results.length ? 0 : 1);
