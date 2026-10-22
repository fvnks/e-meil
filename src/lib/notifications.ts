import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, onAction, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { t } from './i18n';

/** Resumen mínimo de un mensaje nuevo para componer el toast. */
export interface NewMailSummary { id: string; author: string; subject: string; preview?: string }

/** Solicita el permiso de notificaciones si aún no fue otorgado. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    return granted;
  } catch {
    return false;
  }
}

let clickWired = false;
function wireClickToFocus() {
  if (clickWired) return;
  clickWired = true;
  // Como Outlook: tocar el toast (actionId "tap") trae la ventana al frente.
  onAction((event) => {
    if (event.actionId === 'tap') void getCurrentWindow().setFocus().catch(() => undefined);
  }).catch(() => undefined);
}

/**
 * Toast de correo nuevo estilo Outlook:
 *  - 1 mensaje:  título = remitente, cuerpo = asunto.
 *  - Varios:     título = "Remitente y N más", cuerpo = "N mensajes nuevos".
 * El sonido e icono los aporta el sistema; el clic enfoca la app.
 */
export async function notifyNewMail(messages: NewMailSummary[]): Promise<void> {
  if (!messages.length || !(await ensureNotificationPermission())) return;
  wireClickToFocus();
  const [first, ...rest] = messages;
  const title = rest.length === 0
    ? first.author
    : t('notify.andMore', { author: first.author, count: rest.length });
  const body = rest.length === 0
    ? first.subject || t('notify.noSubject')
    : t('notify.manyBody', { count: messages.length });
  try {
    sendNotification({ title, body });
  } catch {
    /* El sistema puede rechazar notificaciones duplicadas; no es crítico. */
  }
}
