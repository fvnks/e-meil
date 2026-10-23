import { invoke, isTauri } from '@tauri-apps/api/core';

/** Informe del canal de releases de GitHub (releases/latest/download/latest.json). */
export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version: string;
  notes: string;
}

export async function checkAppUpdate(): Promise<UpdateInfo> {
  if (!isTauri()) throw new Error('El actualizador solo está disponible en la aplicación de escritorio.');
  return invoke<UpdateInfo>('check_app_update');
}

/** Descarga el paquete firmado, lo verifica y reinicia la app. */
export async function installAppUpdate(): Promise<void> {
  if (!isTauri()) throw new Error('El actualizador solo está disponible en la aplicación de escritorio.');
  await invoke('install_app_update');
}
