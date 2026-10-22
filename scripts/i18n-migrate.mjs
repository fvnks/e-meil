#!/usr/bin/env node
/**
 * Migración incremental de cadenas de App.svelte al diccionario i18n (sesión 8).
 *
 * Reemplaza nodos de texto de la plantilla y atributos title/aria-label
 * estáticos por llamadas t('clave'). Las claves nuevas deben existir en
 * src/lib/i18n.ts (svelte-check valida el tipo MessageKey).
 *
 * Se excluyen deliberadamente: nombres de productos (Microsoft 365, Entra ID,
 * IMAP, POP3, TLS, STARTTLS), datos de demostración (contenido de correos
 * demo) y la lista estática de carpetas (participa en la lógica de filtrado).
 *
 * Uso: node scripts/i18n-migrate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/App.svelte', import.meta.url);
let src = readFileSync(file, 'utf8');

// [buscar, reemplazo, descripción]
const REPLACEMENTS = [
  // --- app / head ---
  ['<title>e-Meil — Tu correo, a tu manera</title>', '<title>{t(\'app.title\')}</title>', 'título'],
  ['>Saltar al contenido principal<', '>{t(\'app.skipContent\')}<', 'skip contenido'],
  ['>Saltar a la barra lateral<', '>{t(\'app.skipSidebar\')}<', 'skip sidebar'],
  // --- menú de temas ---
  ['>COLOR DE e-MEIL<', '>{t(\'theme.title\')}<', 'título temas'],
  ['>El color se guarda solo en este dispositivo.<', '>{t(\'theme.note\')}<', 'nota temas'],
  // --- barra lateral ---
  ['＋</span> Redactar <kbd>N</kbd>', '＋</span> {t(\'sidebar.compose\')} <kbd>N</kbd>', 'botón redactar'],
  ['Todo sincronizado <span', '{t(\'sidebar.allSynced\')} <span', 'todo sincronizado'],
  ['>ahora</span>', '>{t(\'sidebar.now\')}</span>', 'ahora'],
  ['>CUENTAS IMAP<', '>{t(\'sidebar.imapFolders\')}<', 'carpetas imap'],
  // --- lista de correo ---
  ['>Una buena mañana para ponerse al día.<', '>{t(\'list.subtitle\')}<', 'subtítulo bandeja'],
  ['<span>Seleccionar</span>', '<span>{t(\'list.select\')}</span>', 'seleccionar'],
  ['<span>Filtrar</span>', '<span>{t(\'filters.trigger\')}</span>', 'filtrar'],
  ['<span>Limpiar filtros</span>', '<span>{t(\'filters.clear\')}</span>', 'limpiar filtros'],
  ['>✉ No leídos</span>', '>✉ {t(\'filters.unread\')}</span>', 'pill no leídos'],
  ['>⌁ Con adjuntos</span>', '>⌁ {t(\'filters.attachments\')}</span>', 'pill adjuntos'],
  ['>Archivar</button>', '>{t(\'batch.archive\')}</button>', 'archivar lote'],
  ['>Eliminar</button>', '>{t(\'batch.delete\')}</button>', 'eliminar lote'],
  ['>Cancelar</button>', '>{t(\'common.cancel\')}</button>', 'cancelar'],
  // --- panel de lectura ---
  ['>Cuenta IMAP <span', '>{t(\'reading.imapAccount\')} <span', 'cuenta imap'],
  ['>Microsoft 365 <span', '>{t(\'reading.ms365\')} <span', 'cuenta graph'],
  ['<span class="to-line">mensaje sincronizado desde {selectedMailbox}</span>', '<span class="to-line">{t(\'reading.syncedFrom\', { mailbox: selectedMailbox })}</span>', 'sincronizado desde'],
  ['<span class="to-line">mensaje sincronizado desde Microsoft Graph</span>', '<span class="to-line">{t(\'reading.syncedFromGraph\')}</span>', 'sincronizado graph'],
  ['>Contenido mostrado como texto plano. HTML, scripts e imágenes remotas están desactivados por seguridad.<', '>{t(\'reading.plainTextNotice\')}<', 'aviso texto plano'],
  ['>Contenido Graph mostrado de forma segura.<', '>{t(\'reading.graphSecureNotice\')}<', 'aviso graph'],
  ['>Responder</span>', '>{t(\'common.reply\')}</span>', 'responder'],
  ['>Reenviar</span>', '>{t(\'common.forward\')}</span>', 'reenviar'],
  ['>Deshacer</button>', '>{t(\'common.undo\')}</button>', 'deshacer'],
  ['>para mí <span', '>{t(\'reading.toMe\')} <span', 'para mí'],
  ['>Selecciona un mensaje para leerlo<', '>{t(\'common.emptyReading\')}<', 'vacío lectura'],
  ['>Mensaje enviado<', '>{t(\'reading.sent\')}<', 'mensaje enviado'],
  // --- calendario ---
  ['>＋ Nuevo evento<', '>{t(\'calendar.newEvent\')}<', 'nuevo evento'],
  ['<option value="month">Mes</option>', '<option value="month">{t(\'calendar.month\')}</option>', 'vista mes'],
  ['<option value="week">Semana</option>', '<option value="week">{t(\'calendar.week\')}</option>', 'vista semana'],
  ['<option value="day">Día</option>', '<option value="day">{t(\'calendar.day\')}</option>', 'vista día'],
  ['>Título<input', '>{t(\'form.title\')}<input', 'título evento'],
  ['>Descripción<textarea', '>{t(\'form.description\')}<textarea', 'descripción'],
  ['>Ubicación<input', '>{t(\'form.location\')}<input', 'ubicación'],
  ['>Todo el día<input', '>{t(\'form.allDay\')}<input', 'todo el día'],
  ['>Inicio<input', '>{t(\'form.start\')}<input', 'inicio'],
  ['>Fin<input', '>{t(\'form.end\')}<input', 'fin'],
  ['>Calendario<select', '>{t(\'form.calendar\')}<select', 'calendario select'],
  ['>Color<input', '>{t(\'form.color\')}<input', 'color'],
  ['>Guardar</button>', '>{t(\'common.save\')}</button>', 'guardar'],
  // --- contactos ---
  ['>＋ Nuevo contacto<', '>{t(\'contacts.new\')}<', 'nuevo contacto'],
  ['>No hay contactos<', '>{t(\'contacts.empty\')}<', 'sin contactos'],
  ['>Nombre<input', '>{t(\'contacts.name\')}<input', 'nombre'],
  ['>Apellidos<input', '>{t(\'contacts.lastName\')}<input', 'apellidos'],
  ['>Email<input', '>{t(\'contacts.email\')}<input', 'email'],
  ['>Teléfono<input', '>{t(\'contacts.phone\')}<input', 'teléfono'],
  ['>Organización<input', '>{t(\'contacts.organization\')}<input', 'organización'],
  ['>Cargo<input', '>{t(\'contacts.role\')}<input', 'cargo'],
  ['>Cumpleaños<input', '>{t(\'contacts.birthday\')}<input', 'cumpleaños'],
  ['>Notas<textarea', '>{t(\'contacts.notes\')}<textarea', 'notas'],
  // --- asistente de cuentas ---
  ['>CONFIGURACIÓN DE CUENTA<', '>{t(\'setup.title\')}<', 'título asistente'],
  ['<strong>Microsoft 365 / Exchange</strong>', '<strong>{t(\'setup.providerMs\')}</strong>', 'proveedor ms'],
  ['<small>Iniciar sesión con Microsoft (OAuth)</small>', '<small>{t(\'setup.msLogin\')}</small>', 'login ms'],
  ['<small>Correo en varios dispositivos</small>', '<small>{t(\'setup.imapDesc\')}</small>', 'desc imap'],
  ['<small>Descarga de correo desde el servidor</small>', '<small>{t(\'setup.pop3Desc\')}</small>', 'desc pop3'],
  ['>← Cambiar tipo de cuenta<', '>{t(\'setup.changeType\')}<', 'cambiar tipo'],
  ['>Nombre para mostrar<input', '>{t(\'setup.displayName\')}<input', 'nombre mostrar'],
  ['>Dirección de correo<input', '>{t(\'setup.email\')}<input', 'dirección correo'],
  ['>Servidor de salida (SMTP)<', '>{t(\'setup.outgoing\')}<', 'salida smtp'],
  ['>Servidor<input', '>{t(\'setup.server\')}<input', 'servidor'],
  ['>Puerto<input', '>{t(\'setup.port\')}<input', 'puerto'],
  ['>Seguridad<select', '>{t(\'setup.security\')}<select', 'seguridad'],
  ['>Usuario<input', '>{t(\'setup.user\')}<input', 'usuario'],
  ['>Contraseña / clave de aplicación<input', '>{t(\'setup.password\')}<input', 'contraseña'],
  ['>Inicio de sesión protegido<', '>{t(\'setup.secureLogin\')}<', 'login protegido'],
  ['>Iniciar sesión con Microsoft ＋-<', '>{t(\'setup.msLoginButton\')}<', 'botón login ms'],
  ['>Continuar con Microsoft ＋-<', '>{t(\'setup.msContinue\')}<', 'continuar ms'],
  ['>Agregar cuenta<', '>{t(\'setup.addAccount\')}<', 'agregar cuenta'],
  // --- redactor ---
  ['>NUEVO MENSAJE<', '>{t(\'compose.kicker\')}<', 'kicker nuevo mensaje'],
  ['>Redactar correo<', '>{t(\'compose.headerTitle\')}<', 'título redactor'],
  ['<small>Adjuntar</small>', '<small>{t(\'compose.attach\')}</small>', 'adjuntar'],
  ['>CC/CCO<', '>{t(\'compose.ccBcc\')}<', 'cc/cco'],
  ['<small>Negrita</small>', '<small>{t(\'compose.bold\')}</small>', 'negrita'],
  ['<small>Cursiva</small>', '<small>{t(\'compose.italic\')}</small>', 'cursiva'],
  ['<small>Subrayado</small>', '<small>{t(\'compose.underline\')}</small>', 'subrayado'],
  ['<small>Lista</small>', '<small>{t(\'compose.list\')}</small>', 'lista'],
  ['<small>Alinear</small>', '<small>{t(\'compose.align\')}</small>', 'alinear'],
  ['<small>Firma</small>', '<small>{t(\'compose.signature\')}</small>', 'firma'],
  ['<small>Rehacer</small>', '<small>{t(\'compose.redo\')}</small>', 'rehacer'],
  ['<small>Descartar</small>', '<small>{t(\'compose.discard\')}</small>', 'descartar'],
  ['>Para<input', '>{t(\'compose.to\')}<input', 'para'],
  ['>CC<input', '>{t(\'compose.cc\')}<input', 'cc'],
  ['>CCO<input', '>{t(\'compose.bcc\')}<input', 'cco'],
  ['>Asunto<input', '>{t(\'compose.subject\')}<input', 'asunto'],
  ['title="Guardar borrador"', 'title={t(\'compose.saveDraft\')}', 'guardar borrador'],
  ['aria-label="Cerrar"', 'aria-label={t(\'common.close\')}', 'cerrar'],
  ['title="Actualizar"', 'title={t(\'common.refresh\')}', 'actualizar'],
  // --- títulos de herramientas del panel ---
  ['title="Volver a la lista"', 'title={t(\'common.backToList\')}', 'volver lista'],
  ['title="Volver"', 'title={t(\'common.backToList\')}', 'volver'],
  ['title="Archivar"', 'title={t(\'batch.archive\')}', 'title archivar'],
  ['title="Eliminar"', 'title={t(\'batch.delete\')}', 'title eliminar'],
  ['title="Marcar leído/no leído"', 'title={t(\'context.read\')}', 'marcar leído'],
  ['title="Marcar favorito"', 'title={t(\'reading.favorite\')}', 'marcar favorito'],
  ['title="Mover"', 'title={t(\'reading.move\')}', 'mover'],
  ['title="Más"', 'title={t(\'common.more\')}', 'más'],
  ['title="Reaccionar"', 'title={t(\'reading.react\')}', 'reaccionar'],
  ['title="Guardar adjunto"', 'title={t(\'reading.saveAttachment\')}', 'guardar adjunto'],
  ['aria-label="Abrir mensaje"', 'aria-label={t(\'reading.open\')}', 'abrir mensaje'],
  ['aria-label="Favorito"', 'aria-label={t(\'reading.favorite\')}', 'favorito'],
];

let applied = 0;
let misses = [];
let counts = new Map();
for (const [from, to, label] of REPLACEMENTS) {
  const parts = src.split(from);
  if (parts.length > 1) {
    counts.set(label, parts.length - 1);
    src = parts.join(to);
    applied += parts.length - 1;
  } else {
    misses.push(label + ' :: ' + from.slice(0, 60));
  }
}

writeFileSync(file, src);
console.log('Reemplazos aplicados:', applied);
for (const [label, n] of counts) console.log(`  ${label} (${n}x)`);
if (misses.length) {
  console.log('NO ENCONTRADOS:');
  for (const miss of misses) console.log('  ' + miss);
}
