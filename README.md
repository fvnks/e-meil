# e-Meil

Cliente de correo de escritorio de código abierto para Windows y Linux, construido con **Tauri 2 + Rust + Svelte 5 + TypeScript** (licencia MIT).

Conecta cuentas **Microsoft 365 (Graph)**, **IMAP** y **POP3** a través de adaptadores unificados, con almacenamiento local (localStorage + keyring nativo del sistema) y sin servicio de sincronización central.

## Características

- **Microsoft Graph**: OAuth 2.0 con PKCE (Client ID configurable), perfil `/me`, listado y envío de mensajes; access/refresh token persistidos en el keyring nativo. El flujo abre el navegador externo y un callback local (`127.0.0.1:43821`) recibe el código; el frontend sondea el estado cada 2 s hasta 5 minutos (el intento más reciente cancela a los anteriores) y el canje de tokens se ejecuta fuera del hilo principal para no congelar la interfaz.
- **IMAP**: TLS directo (993) **o STARTTLS (143)**, prueba de conexión, listado de carpetas y sincronización bajo demanda (hasta 30 mensajes por bandeja). Detección automática de `\Sent`, `\Archive` y `\Drafts` con etiquetas de uso especial. Lectura de mensajes con Base64 decodificado y HTML sanado; descarga de adjuntos con aviso de archivos peligrosos.
- **POP3**: TLS directo (995) **o STARTTLS/STLS (110)**, prueba de conexión y **sincronización completa**: listado con asunto/remitente/fecha reales (vía `TOP`), lectura resuelviendo UIDL→número (los UIDL alfanuméricos de servidores reales funcionan), eliminación en servidor (`DELE` + `QUIT` confirmado), acciones en lote de borrado y envío por SMTP como cualquier cuenta. Leído/favorito son locales: el protocolo no tiene carpetas, flags ni archivo.
- **SMTP**: envío real con TLS directo (465) **o STARTTLS (587)**, adjuntos hasta 25 MB, copia automática a la carpeta de enviados IMAP cuando existe; Graph guarda en Sent por sí mismo.
- **Multicuenta**: asistente para añadir cuentas (Microsoft 365, IMAP con TLS directo o STARTTLS, POP3); sin datos demo, la selección de cuenta activa persiste en localStorage y gobierna bandeja, sincronización, acciones y envío.
- **Correo en uso diario**: **sincronización automática** de la cuenta activa cada 5 minutos (configurable en `localStorage` con `emeil-sync-interval-min`) y al enfocar la ventana; **notificaciones de escritorio** cuando llega correo nuevo con la app fuera de foco (la primera sincronización de cada cuenta es la línea base, sin ráfagas); **búsqueda en el servidor** (IMAP `SEARCH` y Graph `$search` con `ConsistencyLevel`) desde el buscador superior, y **borradores en el servidor** (`APPEND` con flag `\Draft` a la carpeta detectada, o `POST /me/messages` en Microsoft 365) con fallback local.
- **Redacción**: bandeja con búsqueda, filtros ("No leídos", "Con adjuntos"), selección múltiple con acciones en lote; vistas de calendario (mes/semana/día) y contactos con formularios.
- **Temas de color y modo oscuro**: 5 acentos (Lavanda, Océano, Bosque, Atardecer, Grafito) guardados por dispositivo, más **modo oscuro real** con superficies, textos y bordes tokenizados, conmutable desde el menú de temas, persistido en localStorage y con detección automática de `prefers-color-scheme`.
- **Splash de arranque**: ventana `splashscreen` transparente (marca + spinner + estado) visible al instante mientras la ventana `main` permanece oculta; se revela al terminar de montar el frontend con un mínimo de presencia de 900 ms, y el splash respeta el modo oscuro del sistema sin dependencias externas.

## Requisitos

- Node.js 20+ y [pnpm](https://pnpm.io)
- Rust (stable) con Cargo
- Tauri 2 CLI (`@tauri-apps/cli`, incluido en devDependencies)
- Linux: dependencias estándar de Tauri (webkit2gtk, etc.)

## Desarrollo y compilación

```bash
# Instalar dependencias
pnpm install

# App web en desarrollo (Vite, http://127.0.0.1:5173)
pnpm dev

# App de escritorio en desarrollo (Tauri, requiere cuenta de prueba)
pnpm tauri dev

# Verificación estática del frontend (debe dar 0 errores y 0 warnings)
pnpm build                      # ejecuta svelte-check + vite build

# Tests unitarios de Rust (IMAP/POP3 helpers)
cargo test --manifest-path src-tauri/Cargo.toml

# Build de producción (instaladores)
pnpm tauri build                # Windows: MSI/NSIS · Linux: AppImage/Deb
```

El packaging de Tauri está configurado para Windows (MSI/NSIS) y Linux (AppImage/Deb) con icono y metadatos de versión; el build de Linux debe ejecutarse en un equipo Linux.

## Verificación automatizada

Además de `svelte-check`, `pnpm build` y `cargo test`, el proyecto incluye scripts headless que requieren un Chrome con CDP activo:

```bash
chrome --headless --remote-debugging-port=9222 --user-data-dir=<tmp> about:blank
```

```bash
# Focus trap del modal: Tab/Shift+Tab/Escape (9 comprobaciones)
node scripts/verify-modal-a11y.mjs http://127.0.0.1:5173/

# Drawer móvil + panel de lectura + redactor a pantalla completa (12 comprobaciones)
node scripts/verify-responsive.mjs http://127.0.0.1:5173/

# Navegación por teclado: menú contextual (flechas, Home/End) y Escape en cascada (7 comprobaciones)
node scripts/verify-keyboard.mjs http://127.0.0.1:5173/

# Auditoría de contraste WCAG de styles.css (los hallazgos se listan por ratio)
node scripts/contrast-audit.mjs

# Benchmark de rendimiento con presupuestos (arranque, vistas, búsqueda, drawer, tareas largas)
pnpm run test:performance http://127.0.0.1:4173/
```

Lighthouse (accesibilidad) sobre la app en desarrollo: **100/100**.

## Accesibilidad

- **Contraste WCAG 2.1 AA**: todos los pares texto/fondo de `styles.css` fueron auditados con `scripts/contrast-audit.mjs` y corregidos (55 reemplazos). El token `--muted` y los acentos de tema (Océano, Bosque, Atardecer) se oscurecieron para que el texto blanco sobre acento y el acento sobre fondos suaves superen 4.5:1 en los cinco temas. Excepción documentada: las estrellas de favorito (indicador interactivo, no texto) cumplen el umbral de 3:1 de contraste no textual (WCAG 1.4.11).
- **Foco visible**: `:focus-visible` con outline de acento en botones, campos **y elementos con `role="button"`** (filas de mensajes, celdas de calendario, cuentas).
- **Nombres accesibles**: todos los botones de solo-icono exponen `aria-label` (rail de aplicaciones, ordenar, ayuda, más opciones, añadir cuenta).
- **Tooltip accesible** (`src/lib/tooltip.ts`): acción Svelte `use:tooltip` con `role="tooltip"`, `aria-describedby`, apertura con hover y foco, cierre con Escape, reposicionamiento con scroll/resize y respeto de `prefers-reduced-motion`.
- **Menú contextual y filtros**: `role="menu"` con hijos `role="menuitem"`; el disparador de filtros usa `aria-haspopup="menu"` + `aria-expanded` y el panel de filtros es un `role="group"` etiquetado.
- **Navegación por teclado**: el menú contextual sigue el patrón APG (`ArrowUp`/`ArrowDown` cíclicos, `Home`/`End`, foco automático en el primer ítem al abrir); `Escape` cierra en cascada menú contextual → menú de temas → panel de filtros → drawer móvil (los modales lo gestionan internamente con su focus trap).
- **Legibilidad**: las fuentes más pequeñas de la UI son de 9px (las de 7–8px fueron subidas).
- **Lectores de pantalla**: landmarks (`banner`, `navigation`, `complementary`, `main`), enlaces "Saltar al contenido", etiquetas `aria-label` en vistas y contenido principal identificado.

### Componente `Modal.svelte`

Modal accesible reutilizable (`src/lib/Modal.svelte`), usado por los formularios de evento y contacto:

```svelte
<Modal open={formOpen} title="Nuevo evento" onclose={closeForm} class="event-form">
  …contenido…
</Modal>
```

- Propiedades: `open` (visibilidad), `title` (texto del encabezado), `onclose` (callback), `class` (clases extra), `children` (snippet de contenido).
- Marca semántica: `role="dialog"` + `aria-modal="true"` + `aria-labelledby` al título.
- **Focus trap real**: Tab/Shift+Tab ciclan entre los elementos enfocables; el foco entra al primer control al abrir y se restaura al elemento previo al cerrar.
- Cierre con **Escape**, botón de cierre y clic en el fondo (backdrop).
- Verificado con teclado real vía CDP en `scripts/verify-modal-a11y.mjs` (9/9).

## Responsive

- Escritorio (>1150 px) y compacto (≤1150 px) con grilla de dos paneles.
- **Móvil (≤600 px)**: la barra lateral se convierte en un **drawer** con botón hamburguesa (`aria-expanded`/`aria-controls`), backdrop de cierre y cierre automático al cambiar de carpeta o vista. La lista de correo pasa a una columna; el panel de lectura y el redactor se abren a pantalla completa con botón "Volver". `body` pierde el `min-width` de 900 px y el calendario adapta sus cabeceras y celdas.
- Verificado con `scripts/verify-responsive.mjs` (12/12) en viewport 390×844.

## Modo oscuro

- Toda la UI usa **tokens semánticos** (`--surface`, `--surface-raised`, `--surface-input`, `--paper`, `--ink`, `--muted`, `--line`, `--accent`, `--accent-ink`, `--accent-soft`); el bloque `.dark` los redefine y cada tema de acento tiene su variante oscura (`--accent-ink` se aclara para mantener 4.5:1 sobre superficies oscuras, mientras `--accent` original se conserva para botones con texto blanco).
- El switch vive en el menú de temas (`role="switch"` + `aria-checked`), persiste en `localStorage` (`emeil-dark-mode`) y sin preferencia guardada se detecta `prefers-color-scheme: dark`.
- Los chips decorativos (avatares, logos de proveedor, banners de estado, celda "hoy") se mantienen claros en ambos modos; su contraste interno fue verificado por `scripts/contrast-audit.mjs`, que audita los 5 temas claros **y** los 5 oscuros con los mismos presupuestos WCAG AA.
- La migración de colores se realizó con `scripts/dark-mode.mjs` (132 reemplazos con límites de hex para evitar colisiones de prefijo).
- Verificación: Lighthouse Accesibilidad **100/100 en ambos modos** y auditoría de contraste limpia en los 10 scopes.

## Limitaciones conocidas

- POP3 es por diseño un protocolo de bandeja única sin carpetas, flags ni archivo: "leído"/"favorito" son estado local y las acciones de archivar/mover no aplican.
- El flujo OAuth de Microsoft abre un navegador externo con un callback local; requiere Client ID propio. La devolución de tokens se reintenta automáticamente ante errores de red hasta agotar el plazo.
- Los flujos de red (IMAP/POP3/SMTP/STARTTLS/OAuth) están verificados por tests unitarios de protocolo y compilación, pero aún falta una pasada end-to-end con cuentas reales (`pnpm tauri dev`).
- Los textos de la UI están en español. La infraestructura de internacionalización existe (`src/lib/i18n.ts`: diccionario por locale, `t()` con interpolación, locale persistido) y cubre **~120 cadenas**: shell completo (rail, topbar, barra lateral, filtros, menú contextual), panel de lectura, asistente de cuentas, formulario de evento, contactos y redactor. El resto (mensajes de estado en la lógica, nombres de carpetas demo y datos de los correos de ejemplo) es trabajo incremental documentado en el propio módulo.
- Bordes decorativos y separadores claros no alcanzan 3:1 (no aplican como indicadores únicos de estado; pendiente de revisión fina WCAG 1.4.11).

## Instaladores

Los instaladores se generan con `pnpm tauri build` y quedan en `src-tauri/target/release/bundle/` (y se copian a `installers/`, ignorado por git):

| Plataforma | Archivo | Comando |
|---|---|---|
| Windows | `e-Meil_0.1.0_x64_en-US.msi` · `e-Meil_0.1.0_x64-setup.exe` | `pnpm tauri build` (nativo) |
| Linux | `e-Meil_0.1.0_amd64.deb` · `e-Meil_0.1.0_amd64.AppImage` | `pnpm tauri build -b deb,appimage` |

- **Windows**: MSI (WiX) y NSIS se generan nativamente.
- **Linux**: el bundle requiere el toolchain de Linux; en Windows se puede construir dentro de **WSL2 (Ubuntu 24.04)** con las dependencias de Tauri (`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev`), Node 20, pnpm y Rust — compilando sobre una copia del proyecto en el filesystem nativo de WSL (`~/mail`) para no mezclar artifacts ni sufrir la lentitud de `/mnt`.
- **CI**: `release.yml` genera los mismos cuatro instaladores (MSI/NSIS + AppImage/Deb) sobre tags `v*` y los publica como draft de release.
- Los iconos de bundling se regeneran con `pnpm tauri icon src-tauri/icons/icon.ico`; `tauri.conf.json` lista PNGs cuadrados además del `.ico`/`.icns` (necesarios para Linux).

## Estado del proyecto

Cliente navegable con asistente de cuentas (Microsoft 365, IMAP, POP3) **sin datos de demostración**: la app presenta estados vacíos reales y un CTA de "Añadir cuenta" hasta conectar la primera cuenta. Sincronización real de correo bajo demanda (IMAP/POP3 con carpetas y STARTTLS, Microsoft Graph con ciclo OAuth robusto), envío SMTP (465/587) o Graph, respuesta/reenvío con cita del original, acciones en lote, búsqueda y filtros, calendario y contactos locales, temas con modo oscuro, accesibilidad (contraste AA auditado en 10 scopes, focus trap, tooltips, teclado APG, Lighthouse 100/100) y responsive móvil. Verificación actual: `svelte-check` 0 errores/0 warnings, `pnpm build` OK, `cargo test` 16/16, scripts a11y 9/9, teclado 7/7, responsive 11/11 y benchmark 9/9.

Véase también [ARCHITECTURE.md](ARCHITECTURE.md) y [SECURITY.md](SECURITY.md).
