/**
 * Infraestructura mínima de i18n para e-Meil (tarea 8).
 *
 * Estado: los textos de la interfaz están en español. Este módulo establece
 * el patrón de extracción para traducciones futuras:
 *
 *  1. Las cadenas viven en un diccionario por locale (`MESSAGES`).
 *  2. Los componentes usan `t('clave')` (con interpolación `{parametro}`).
 *  3. El locale se persiste en localStorage (`emeil-locale`) y se lee al
 *     iniciar; cambiarlo con `setLocale` requiere recargar la vista.
 *
 * Para continuar la extracción: mueve una cadena de la UI al diccionario de
 * su locale, dale una clave `seccion.elemento` y reemplaza el literal por
 * `t('seccion.elemento')`. `svelte-check` detecta claves inexistentes al
 * tipar el parámetro `key` como las claves conocidas.
 */

export type Locale = 'es' | 'en';

/** Locales con diccionario completo. */
export const locales: readonly Locale[] = ['es'] as const;

export type MessageKey = keyof typeof MESSAGES['es'];

const STORAGE_KEY = 'emeil-locale';

const MESSAGES: Record<Locale, Record<string, string>> = {
  es: {
    // Barra de aplicaciones (rail)
    'rail.apps': 'Aplicaciones',
    'rail.mail': 'Correo',
    'rail.calendar': 'Calendario',
    'rail.contacts': 'Contactos',
    'rail.more': 'Más aplicaciones',
    // Barra superior
    'topbar.help': 'Ayuda',
    'topbar.theme': 'Personalizar colores',
    'topbar.menu': 'Abrir carpetas',
    'topbar.search': 'Buscar mensajes',
    // Barra lateral
    'sidebar.folders': 'CARPETAS',
    'sidebar.foldersOptions': 'Más opciones de carpetas',
    'sidebar.accounts': 'CUENTAS',
    'sidebar.addAccount': 'Añadir cuenta',
    'sidebar.addAccountFull': '＋ Añadir cuenta',
    'sidebar.compose': 'Redactar',
    // Filtros de la lista
    'filters.group': 'Filtros de lista',
    'filters.trigger': 'Filtrar',
    'filters.unread': 'No leídos',
    'filters.attachments': 'Con adjuntos',
    'filters.clear': 'Quitar filtros',
    // Tema / modo
    'theme.dark': 'Modo oscuro',
    'theme.darkOn': 'Activado',
    'theme.darkOff': 'Desactivado',
    // Menú contextual
    'context.messageTitle': 'ACCIONES DEL MENSAJE',
    'context.open': 'Abrir mensaje',
    'context.read': 'Marcar leído/no leído',
    'context.star': 'Añadir/quitar favorito',
    'context.delete': 'Eliminar mensaje',
    'context.compose': 'Redactar mensaje',
    'context.sync': 'Sincronizar correo',
    // Estados comunes
    'common.loading': 'Cargando…',
    'common.cancel': 'Cancelar',
    'common.save': 'Guardar',
    'common.backToList': 'Volver a la lista',
    'common.emptyReading': 'Selecciona un mensaje para leerlo'
  },
  en: {
    // Incompleto a propósito: se activa cuando el diccionario esté completo.
    'rail.apps': 'Apps',
    'rail.mail': 'Mail',
    'rail.calendar': 'Calendar',
    'rail.contacts': 'Contacts',
    'rail.more': 'More apps'
  }
};

function normalizeLocale(candidate: string | null | undefined): Locale {
  if (candidate && candidate in MESSAGES) return candidate as Locale;
  return 'es';
}

let currentLocale: Locale = 'es';

/** Inicializa el locale persisted. Llamar una sola vez al arrancar. */
export function initLocale(): Locale {
  if (typeof localStorage === 'undefined') return currentLocale;
  currentLocale = normalizeLocale(localStorage.getItem(STORAGE_KEY));
  return currentLocale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Cambia el locale activo y lo persiste. Las vistas renderizadas deben
 * refrescarse (recarga o re-render) para reflejar el cambio.
 */
export function setLocale(locale: Locale): void {
  currentLocale = normalizeLocale(locale);
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, currentLocale);
}

/** Devuelve la cadena traducida; interpola `{param}` con `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const value = MESSAGES[currentLocale][key] ?? MESSAGES.es[key];
  if (!value) return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}
