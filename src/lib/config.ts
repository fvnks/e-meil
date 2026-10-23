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
// Public OAuth client id for Microsoft.  
// This client id **must** be registered in Azure AD with the redirect URI:
//   https://login.microsoftonline.com/common/oauth2/nativeclient
// Use the same id for every deployment – no per-user configuration.
// TODO: replace the placeholder below with your actual public client id.
export const MICROSOFT_CLIENT_ID = 'YOUR_PUBLIC_MICROSOFT_CLIENT_ID';
export const MICROSOFT_TENANT = 'common';
