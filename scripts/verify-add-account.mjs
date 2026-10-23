/**
 * Verifica el flujo Ajustes → Añadir cuenta y el paso Microsoft sin Client ID.
 * Uso: node scripts/verify-add-account.mjs [url]
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
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  return (method, params = {}) => new Promise((resolve) => {
    const callId = ++id;
    pending.set(callId, resolve);
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
}

async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
  return res.result?.result?.value;
}

const target = await pickTarget();
const socket = await connect(target.webSocketDebuggerUrl);
const send = client(socket);
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: APP_URL });
await sleep(2500);

// Estado inicial: cerrar el asistente de onboarding si se abrió solo.
await evaluate(send, `(() => { const close = document.querySelector('.setup-close'); if (close) close.click(); return true; })()`);
await sleep(300);

// 1. Abrir Ajustes desde el rail.
const openedSettings = await evaluate(send, `(() => {
  const rail = [...document.querySelectorAll('.rail-item')];
  const settings = rail.find((b) => (b.getAttribute('aria-label') || '').match(/ajustes|settings/i));
  if (!settings) return false;
  settings.click();
  return true;
})()`);
await sleep(400);
record('Se abre Ajustes desde el rail', openedSettings && await evaluate(send, `!!document.querySelector('.settings-window')`));

// 2. Pulsar "Añadir cuenta" dentro de Ajustes.
const clicked = await evaluate(send, `(() => {
  const buttons = [...document.querySelectorAll('.settings-window button')];
  const add = buttons.find((b) => (b.textContent || '').match(/añadir cuenta|add account/i));
  if (!add) return false;
  add.click();
  return true;
})()`);
await sleep(500);

const state = await evaluate(send, `(() => ({
  settingsVisible: !!document.querySelector('.settings-window'),
  setupVisible: !!document.querySelector('.setup-window:not(.settings-window)'),
  providerTiles: document.querySelectorAll('.provider-tile, .provider-option, .setup-provider').length,
  hasText: document.body.innerText.includes('Conecta tu correo') || document.body.innerText.includes('Connect your mail')
}))()`);
record('El botón Añadir cuenta existe y responde', clicked);
record('Ajustes se cierra al abrir el asistente', state.settingsVisible === false, JSON.stringify(state));
record('El asistente de cuentas queda visible', state.setupVisible === true);

// 3. Entrar al paso Microsoft y comprobar que no pide Client ID.
const microsoft = await evaluate(send, `(() => {
  const tiles = [...document.querySelectorAll('button')];
  const ms = tiles.find((b) => /microsoft/i.test(b.textContent || '') && b.closest('.setup-window'));
  if (!ms) return false;
  ms.click();
  return true;
})()`);
await sleep(500);
const msState = await evaluate(send, `(() => {
  const window = document.querySelector('.setup-window:not(.settings-window)');
  if (!window) return { visible: false };
  const text = window.innerText;
  return {
    visible: true,
    asksClientId: /client id/i.test(text),
    hasLoginButton: [...window.querySelectorAll('button')].some((b) => /iniciar sesión con microsoft|sign in with microsoft/i.test(b.textContent || '')),
    privacy: /nunca ve tu contraseña|never sees your password/i.test(text)
  };
})()`);
record('Se entra al proveedor Microsoft', microsoft && msState.visible === true);
record('El paso Microsoft no pide Client ID', msState.asksClientId === false);
record('Hay un botón real de inicio de sesión', msState.hasLoginButton === true);
record('Se explica el tratamiento de la contraseña', msState.privacy === true);

socket.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} comprobaciones superadas.`);
process.exit(passed === results.length ? 0 : 1);
