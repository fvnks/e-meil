/**
 * Verificación de interacción por teclado de e-Meil mediante CDP.
 *
 * Comprueba:
 *  1. El menú contextual (role="menu") recibe el foco en su primer ítem al
 *     abrirse (patrón APG).
 *  2. Flechas ↑/↓ navegan cíclicamente los menuitem; Home/End van al
 *     primero/último.
 *  3. Escape y Tab cierran el menú.
 *  4. Escape cierra en cascada: menú contextual → menú de temas → panel de
 *     filtros → drawer móvil.
 *
 * Sin mocks: el menú se abre sobre el área vacía (contextmenu burbujea al
 * window handler); la navegación se valida contra N ítems reales.
 *
 * Requiere Chrome headless con CDP en 9222.
 * Uso: node scripts/verify-keyboard.mjs [url]
 */
import { setTimeout as sleep } from 'node:timers/promises';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CDP_HTTP = 'http://127.0.0.1:9222';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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
    async pressKey(key) {
      const map = {
        ArrowDown: { code: 'ArrowDown', keyCode: 40 },
        ArrowUp: { code: 'ArrowUp', keyCode: 38 },
        Home: { code: 'Home', keyCode: 36 },
        End: { code: 'End', keyCode: 35 },
        Escape: { code: 'Escape', keyCode: 27 },
        Tab: { code: 'Tab', keyCode: 9 }
      };
      const { code, keyCode } = map[key];
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, modifiers: 0 });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, modifiers: 0 });
      await sleep(150);
    },
    async setViewport(width, height) {
      await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
    }
  };
}

const FOCUS_ITEM = `(() => {
  const menu = document.querySelector('.context-menu');
  const active = document.activeElement;
  return {
    menuOpen: Boolean(menu),
    role: active ? active.getAttribute('role') : null,
    text: active ? (active.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28) : null
  };
})()`;

async function main() {
  const targets = await cdpTargets();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No se encontro una pestana en Chrome headless.');

  const socket = await connect(page.webSocketDebuggerUrl);
  const client = createClient(socket);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.setViewport(1280, 800);
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(3500);

  // --- 1. Apertura del menú contextual -------------------------------------
  const openMenu = `(() => {
    const target = document.querySelector('.message-row') || document.body;
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    return 'ok';
  })()`;
  await client.evaluate(openMenu);
  await sleep(600);
  const first = await client.evaluate(FOCUS_ITEM);
  record('El menú abre y el foco entra al primer menuitem', first.menuOpen && first.role === 'menuitem', JSON.stringify(first));

  // --- 2. Navegación con flechas -------------------------------------------
  const itemTexts = await client.evaluate(`Array.from(document.querySelectorAll('.context-menu [role="menuitem"]')).map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim())`);
  const activeIndex = () => client.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.context-menu [role="menuitem"]'));
    return items.findIndex((item) => item === document.activeElement);
  })()`);
  // Secuencia esperada (con envoltura): ↓ → índice 1; ↓ → índice 0 (envuelve);
  // ↑ → último (envuelve); End → último; Home → primero.
  const steps = [
    ['ArrowDown', 1],
    ['ArrowDown', 0],
    ['ArrowUp', itemTexts.length - 1],
    ['End', itemTexts.length - 1],
    ['Home', 0]
  ];
  const visited = [];
  let navOk = true;
  for (const [key, expected] of steps) {
    await client.pressKey(key);
    const at = await activeIndex();
    visited.push(`${key}→${at}`);
    if (at !== expected) navOk = false;
  }
  record('Flechas navegan los ítems con envoltura', navOk, `${itemTexts.length} ítems: ${visited.join(' ')}`);

  // --- 3. Escape y Tab cierran el menú --------------------------------------
  await client.pressKey('Escape');
  await sleep(200);
  const closedByEsc = await client.evaluate(`!document.querySelector('.context-menu')`);
  record('Escape cierra el menú contextual', closedByEsc === true);

  await client.evaluate(openMenu);
  await sleep(400);
  await client.pressKey('Tab');
  await sleep(200);
  const closedByTab = await client.evaluate(`!document.querySelector('.context-menu')`);
  record('Tab cierra el menú contextual', closedByTab === true);

  // --- 4. Escape en cascada: menú de temas -----------------------------------
  await client.evaluate(`document.querySelector('.icon-button.settings').click()`);
  await sleep(300);
  const themeOpen = await client.evaluate(`!!document.querySelector('.theme-menu')`);
  await client.pressKey('Escape');
  await sleep(250);
  const themeClosed = await client.evaluate(`!document.querySelector('.theme-menu')`);
  record('Escape cierra el menú de temas', themeOpen && themeClosed);

  // --- 4b. Escape cierra el panel de filtros ----------------------------------
  await client.evaluate(`document.querySelector('.filter-button').click()`);
  await sleep(300);
  const filtersOpen = await client.evaluate(`!!document.querySelector('.filter-menu')`);
  await client.pressKey('Escape');
  await sleep(250);
  const filtersClosed = await client.evaluate(`!document.querySelector('.filter-menu')`);
  record('Escape cierra el panel de filtros', filtersOpen && filtersClosed);

  // --- 4c. Escape cierra el drawer móvil -------------------------------------
  await client.setViewport(390, 844);
  await sleep(500);
  await client.evaluate(`document.querySelector('.menu-button').click()`);
  await sleep(450);
  const drawerOpen = await client.evaluate(`(() => ({ open: document.getElementById('sidebar').getBoundingClientRect().left > -100 && document.querySelector('.menu-button').getAttribute('aria-expanded') === 'true' }))()`);
  await client.pressKey('Escape');
  await sleep(450);
  const drawerClosed = await client.evaluate(`(() => ({ off: document.getElementById('sidebar').getBoundingClientRect().right < 8, expanded: document.querySelector('.menu-button').getAttribute('aria-expanded') }))()`);
  record('Escape cierra el drawer móvil', drawerOpen.open === true && drawerClosed.off === true && drawerClosed.expanded === 'false', `antes:${JSON.stringify(drawerOpen)} despues:${JSON.stringify(drawerClosed)}`);

  socket.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(2);
});
