/**
 * Identidad OAuth de e-Meil ante Microsoft.
 *
 * El inicio de sesión usa un cliente público (sin secreto) compartido para que
 * la persona no tenga que registrar una aplicación en Entra ID: elige
 * "Microsoft" y firma con su cuenta de Hotmail, Outlook, Live o laboral.
 *
 * Para distribuir una build propia basta con definir
 * `VITE_MICROSOFT_CLIENT_ID` en el entorno de compilación; la interfaz no
 * cambia y no se pide nada al usuario final.
 */
const envClientId = (import.meta.env.VITE_MICROSOFT_CLIENT_ID as string | undefined)?.trim();

export const MICROSOFT_CLIENT_ID = envClientId || 'facd6cff-a294-4415-b59f-c5b01937d7bd';
export const MICROSOFT_TENANT = 'common';
