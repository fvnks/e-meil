import { invoke, isTauri } from '@tauri-apps/api/core';

export interface OAuthStart { authorizationUrl: string; state: string; redirectUri: string; }
export interface OAuthStatus { status: string; email: string | null; message: string; }
export interface WaitForOptions {
  /** Milisegundos entre sondeos (por defecto 2000). */
  intervalMs?: number;
  /** Milisegundos máximos antes de abandonar (por defecto 300000 = 5 min). */
  timeoutMs?: number;
  /** Retorna true si este intento sigue siendo el vigente; si no, se cancela. */
  isCurrent?: () => boolean;
  /** Recibe el mensaje de estado en cada sondeo (para feedback en la UI). */
  onTick?: (elapsedMs: number) => void;
}

export async function startMicrosoftOAuth(clientId: string, tenant = 'common'): Promise<OAuthStart> {
  if (!isTauri()) throw new Error('El inicio de sesión Microsoft solo está disponible en la aplicación de escritorio.');
  return invoke<OAuthStart>('start_microsoft_oauth', { clientId, tenant });
}

export async function pollMicrosoftOAuth(clientId: string, tenant: string, state: string): Promise<OAuthStatus> {
  if (!isTauri()) throw new Error('OAuth solo está disponible en escritorio.');
  return invoke('poll_microsoft_oauth', { clientId, tenant, oauthState: state });
}

/**
 * Sondea la autorización de Microsoft hasta que se complete, falle o caduque.
 *
 * Cada sondeo consulta el estado identificado por `state`; si `isCurrent`
 * retorna false (el usuario reinició el flujo), el ciclo se cancela y
 * resuelve con `{ status: 'stale' }` para que el intento anterior no
 * compita con el nuevo. El backend solo canjea el token del intento cuyo
 * estado coincide con el último `startMicrosoftOAuth` lanzado.
 */
export async function waitForMicrosoftAuthorization(
  clientId: string,
  tenant: string,
  state: string,
  { intervalMs = 2000, timeoutMs = 300_000, isCurrent, onTick }: WaitForOptions = {}
): Promise<OAuthStatus> {
  const startedAt = Date.now();
  for (;;) {
    if (isCurrent && !isCurrent()) {
      return { status: 'stale', email: null, message: 'Este intento de autorización fue reemplazado por uno más reciente.' };
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      return { status: 'timeout', email: null, message: 'Se agotó el tiempo de espera de la autorización de Microsoft. Vuelve a intentarlo.' };
    }
    let status: OAuthStatus;
    try {
      status = await pollMicrosoftOAuth(clientId, tenant, state);
    } catch (error) {
      // Los errores de red son transitorios: se reintenta hasta el plazo máximo.
      onTick?.(elapsed);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    if (status.status === 'authorized' || status.status === 'error') return status;
    onTick?.(elapsed);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
