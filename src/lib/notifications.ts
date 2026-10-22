import { isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

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

/** Muestra una notificación de escritorio (no-op en navegador). */
export async function notifyDesktop(title: string, body: string): Promise<void> {
  if (!(await ensureNotificationPermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* El sistema puede rechazar notificaciones duplicadas; no es crítico. */
  }
}
