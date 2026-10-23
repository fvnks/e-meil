/**
 * Identidad OAuth de e-Meil ante Microsoft.
 *
 * El inicio de sesión usa un cliente público (sin secreto) compartido para que
 * la persona no tenga que registrar una aplicación en Entra ID: elige
 * "Microsoft" y firma con su cuenta de Hotmail, Outlook, Live o laboral.
 *
 * La ID vive aquí, fija en el código, para que TODAS las builds (dev, CI y
 * release) usen la misma identidad sin configuración por parte del usuario.
 * Si algún día hay que renovarla: se registra la nueva app en Entra ID con la
 * redirección nativa, se actualiza esta constante y se recompila.
 */
export const MICROSOFT_CLIENT_ID = 'facd6cff-a294-4415-b59f-c5b01937d7bd';
export const MICROSOFT_TENANT = 'common';
