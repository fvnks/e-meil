/**
 * Verificación de accesibilidad del modal de e-Meil mediante Chrome DevTools Protocol.
 *
 * Comprueba:
 *  1. El modal expone role="dialog" + aria-modal + aria-labelledby con nombre accesible.
 *  2. Al abrirse, el foco entra en el modal (focus trap).
 *  3. Tab / Shift+Tab nunca escapan del modal (teclas reales vía Input.dispatchKeyEvent).
 *  4. Escape cierra el modal.
 *
 * Uso: node scripts/verify-modal-a11y.mjs [url]
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
      const result = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'Error al evaluar en la pagina');
      }
      return result.result.value;
    },
    async pressKey(key, { shift = false } = {}) {
      const map = {
        Tab: { code: 'Tab', keyCode: 9 },
        Escape: { code: 'Escape', keyCode: 27 },
        Enter: { code: 'Enter', keyCode: 13 }
      };
      const { code, keyCode } = map[key];
      const base = {
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode
      };
      await this.send('Input.dispatchKeyEvent', { type: shift ? 'rawKeyDown' : 'keyDown', ...base, modifiers: shift ? 8 : 0 });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, modifiers: shift ? 8 : 0 });
      await sleep(60);
    }
  };
}

const FOCUS_SNAPSHOT = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  const active = document.activeElement;
  return {
    hasDialog: Boolean(dialog),
    inside: dialog ? dialog.contains(active) : false,
    tag: active ? active.tagName : 'null',
    type: active && active.getAttribute('type') ? active.getAttribute('type') : '',
    label: active ? (active.getAttribute('aria-label') || active.textContent || active.getAttribute('placeholder') || '').trim().slice(0, 24) : ''
  };
})()`;

async function main() {
  const targets = await cdpTargets();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No se encontro una pestana de la app en Chrome headless.');

  const socket = await connect(page.webSocketDebuggerUrl);
  const client = createClient(socket);

  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(2500);

  const opened = await client.evaluate(`(() => {
    const railButtons = Array.from(document.querySelectorAll('.rail-item'));
    const calendarButton = railButtons.find((button) => (button.getAttribute('aria-label') || button.getAttribute('title') || '') === 'Calendario');
    if (!calendarButton) return 'no-calendar-rail';
    calendarButton.click();
    return 'clicked';
  })()`);
  record('Se abre la vista de calendario', opened === 'clicked', opened);
  await sleep(600);

  const openResult = await client.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const newEvent = buttons.find((button) => /nuevo evento/i.test(button.textContent || ''));
    if (!newEvent) return 'no-button';
    newEvent.click();
    return 'clicked';
  })()`);
  record('Se abre el modal de evento', openResult === 'clicked', openResult);
  await sleep(700);

  const dialogInfo = await client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return null;
    const labelledBy = dialog.getAttribute('aria-labelledby');
    const label = labelledBy ? document.getElementById(labelledBy) : null;
    return {
      role: dialog.getAttribute('role'),
      ariaModal: dialog.getAttribute('aria-modal'),
      labelText: label ? label.textContent.trim() : null,
      focusInside: dialog.contains(document.activeElement)
    };
  })()`);
  record('El modal expone role="dialog" y aria-modal="true"', dialogInfo?.role === 'dialog' && dialogInfo?.ariaModal === 'true', JSON.stringify(dialogInfo));
  record('El modal tiene nombre accesible (aria-labelledby)', Boolean(dialogInfo?.labelText), dialogInfo?.labelText ?? 'sin nombre');
  record('El foco entra en el modal al abrirse', Boolean(dialogInfo?.focusInside));

  // Recorrido real con la tecla Tab.
  const visited = [];
  let escaped = false;
  for (let i = 0; i < 14; i++) {
    await client.pressKey('Tab');
    const snapshot = await client.evaluate(FOCUS_SNAPSHOT);
    visited.push(`${snapshot.tag}${snapshot.type ? `[${snapshot.type}]` : ''}`);
    if (!snapshot.inside) { escaped = true; break; }
  }
  record('El foco nunca escapa del modal con Tab', !escaped, `recorrido: ${visited.join(' → ')}`);
  record('El foco recorre varios controles distintos', new Set(visited).size >= 3, `${new Set(visited).size} controles distintos`);

  // Shift+Tab debe regresar al ultimo control y seguir dentro del modal.
  await client.pressKey('Tab', { shift: true });
  const shiftSnapshot = await client.evaluate(FOCUS_SNAPSHOT);
  record('Shift+Tab mantiene el foco dentro del modal', shiftSnapshot.inside === true, `activo: ${shiftSnapshot.tag}${shiftSnapshot.type ? `[${shiftSnapshot.type}]` : ''}`);

  // Escape debe cerrar el modal.
  await client.pressKey('Escape');
  await sleep(250);
  const closed = await client.evaluate(`!document.querySelector('[role="dialog"][aria-modal="true"]')`);
  record('Escape cierra el modal', closed === true);

  socket.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(2);
});
