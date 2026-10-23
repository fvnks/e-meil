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

/**
 * Abre la ventana de inicio de sesión de Microsoft dentro de e-Meil.
 *
 * Es el flujo recomendado: no requiere Client ID visible ni servidor local,
 * porque la redirección nativa se intercepta en la propia ventana y el código
 * se canjea en segundo plano con PKCE. La ventana se cierra sola al terminar.
 */
export async function startMicrosoftLoginWindow(clientId: string, tenant = 'common'): Promise<OAuthStart> {
  if (!isTauri()) throw new Error('El inicio de sesión Microsoft solo está disponible en la aplicación de escritorio.');
  return invoke<OAuthStart>('start_microsoft_oauth_window', { clientId, tenant });
}

export async function pollMicrosoftOAuth(clientId: string, tenant: string, state: string): Promise<OAuthStatus> {
  if (!isTauri()) throw new Error('OAuth solo está disponible en escritorio.');
  return invoke('poll_microsoft_oauth', { clientId, tenant, oauthState: state });
}

/** Identidad de Google: Rust conoce todos los parámetros, la UI solo sondea. */
export async function startGoogleOauth(): Promise<OAuthStart> {
  if (!isTauri()) throw new Error('El inicio de sesión con Google solo está disponible en la aplicación de escritorio.');
  return invoke<OAuthStart>('start_google_oauth');
}

export async function pollGoogleOAuth(state: string): Promise<OAuthStatus> {
  if (!isTauri()) throw new Error('OAuth solo está disponible en escritorio.');
  return invoke('poll_google_oauth', { oauthState: state });
}

/**
 * Espera la autorización de Google hasta que se complete, falle o caduque.
 * Google bloquea las ventanas embebidas, así que el flujo se abre en el
 * navegador del sistema y el servidor local (puerto 43822) recibe el código.
 */
export async function waitForGoogleAuthorization(
  state: string,
  { intervalMs = 2000, timeoutMs = 300_000, isCurrent, onTick }: WaitForOptions = {}
): Promise<OAuthStatus> {
  const startedAt = Date.now();
  let consecutiveErrors = 0;
  for (;;) {
    if (isCurrent && !isCurrent()) {
      return { status: 'stale', email: null, message: 'Este intento de autorización fue reemplazado por uno más reciente.' };
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      return { status: 'timeout', email: null, message: 'Se agotó el tiempo de espera de la autorización de Google. Vuelve a intentarlo.' };
    }
    let status: OAuthStatus;
    try {
      status = await pollGoogleOAuth(state);
    } catch (error) {
      // Un fallo de red puntual es transitorio; tres seguidos indican un
      // problema real: se informa en vez de esperar el timeout completo.
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) {
        return { status: 'error', email: null, message: `No se pudo completar la autorización de Google: ${String(error)}` };
      }
      onTick?.(elapsed);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    consecutiveErrors = 0;
    if (status.status === 'authorized' || status.status === 'error') return status;
    onTick?.(elapsed);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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
  let consecutiveErrors = 0;
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
      // Un fallo de red puntual es transitorio; tres seguidos indican un
      // problema real: se informa en vez de esperar el timeout completo.
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) {
        return { status: 'error', email: null, message: `No se pudo completar la autorización de Microsoft: ${String(error)}` };
      }
      onTick?.(elapsed);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    consecutiveErrors = 0;
    if (status.status === 'authorized' || status.status === 'error') return status;
    onTick?.(elapsed);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
