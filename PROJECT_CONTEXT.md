# e-Meil – Estado del Proyecto (Sesión 3/5)

## Visión General
- **Objetivo**: Construir un cliente de correo de escritorio de código abierto para Windows/Linux usando **Tauri 2 + Rust + Svelte 5 + TypeScript** (MIT License).
- **Arquitectura**: Adaptadores IMAP/SMTP/Graph mezclados a través de interfaces unificadas, almacenamiento local (localStorage, keyring) y sin servicio de sincronización central.
- **Entorno de desarrollo**:  Node.js (pnpm), Svelte 5, Vite, Rust (Tauri 2). Se usan paquetes de Tauri y dependencias de crates.

## Estatus de la Completitud

| Recurso | Estado | Notas |
|---------|--------|-------|
| **HEATMAP** | **✔** | Módulos de UI/UX diseñados, diálogos modales, bandeja de entrada, calendario y contactos. |
| **IMAP Client** (`imap_client.rs`) | **✔** | `format_address_parts`, `normalize_body_text`, `append_raw_to_mailbox`. 5 tests pasan. |
| **SMTP Client** (`smtp_client.rs`) | **✔** | `sentCopy` y `SendSmtpResult`. |
| **POP3 Client** (`pop3_client.rs`) | **✔** | Implementación real: `UIDL`/`LIST`/`RETR`/`QUIT`, dot-stuffing, decodificación RFC 2047 (base64 y quoted-printable). 5 tests pasan. |
| **Microsoft Graph** (`graph_send.ts`, `graph_actions.ts`) | **✔** | Autenticación PKCE, lista, envío de mensajes. |
| **Frontend Bridge** (`lib/*.ts`) | **✔** | `imap`, `smtp`, `graph`, `pop3`, `accounts`, `cache`. |
| **Styles** (`styles.css`) | **✔** | Definiciones de clase, temas, animaciones básicas. Se generó un `:root` con variables de tema. |
| **Accessibility** | **✔** | Componente `Modal.svelte` con focus trap real (Tab/Shift+Tab), ESC, restauración de foco, `role="dialog"` + `aria-modal` + `aria-labelledby`. Verificado en navegador (9/9). |
| **Dark Mode** | **✔** | Modo oscuro real con tokens semánticos de superficie/texto/borde (`--surface`, `--paper`, `--ink`, `--line`, `--accent-ink`…), variantes oscuras por tema de acento, switch accesible persistido y detección de `prefers-color-scheme`. Auditoría de contraste AA limpia en los 10 scopes (5 claros + 5 oscuros) y Lighthouse 100/100 en ambos modos. |
| **Responsive Design** | **Implementado parcialmente** | Ajustes de media query al ancho 1150 px. Falta optimización para móvil (horizontales, anchos < 600 px). |
| **Animations / Micro‑interactions** | **Implementado** | Anímate de paneles, mensajes, botones, enlaces `:hover`. |
| **Testing** | **✔** | 12 tests Rust (`cargo test`) + verificación a11y en navegador real (`scripts/verify-modal-a11y.mjs`, 9/9), responsive móvil (`scripts/verify-responsive.mjs`, 12/12), auditoría de contraste (`scripts/contrast-audit.mjs`) y benchmark con presupuestos (`pnpm run test:performance`, 9/9). `svelte-check`: 0 errores, 0 warnings. `pnpm build`: OK. |
| **Frontend** (`App.svelte`) | **✔** | Tipos `CalendarEvent`/`Contact` corregidos con `accountId`; formularios de evento y contacto con tipos explícitos (`EventFormState`, `ContactFormState`). |

## Tareas Pendientes
1. ~~Contraste y color accessibility~~ **✔ Sesión 4**: auditoría con `scripts/contrast-audit.mjs` (82 pares bajo AA → 2 intencionales); 55 reemplazos en `styles.css` vía `scripts/contrast-fix.mjs`; `--muted` → `#67696f`; acentos Océano/Bosque/Atardecer oscurecidos para blanco-sobre-acente ≥ 4.5:1; Lighthouse a11y 94 → **100**; fix ARIA (`role="menu"` + `menuitem`, `aria-haspopup="menu"`, filtros como `role="group"`) y `aria-label` en botones de solo-icono (rail, ordenar, ayuda, más opciones).
2. ~~Tooltip Component~~ **✔**: `src/lib/tooltip.ts` (acción `use:tooltip` con `role="tooltip"`, `aria-describedby`, hover+foco, Escape, `prefers-reduced-motion`) integrado en topbar, rail y sidebar.
3. ~~Responsive Mobile~~ **✔ Sesión 4**: media query `max-width:600px` con sidebar como drawer (hamburguesa `aria-expanded`/`aria-controls`, backdrop, cierre automático por `$effect` al cambiar carpeta/vista); lista a una columna; panel de lectura y redactor a pantalla completa con "Volver"; `min-width:900px` eliminado en móvil; calendario adaptado. Verificado con `scripts/verify-responsive.mjs` (12/12, viewport 390×844) y sin regresiones en escritorio.
4. ~~Unit/Grid layouts~~ **✔ Sesión 4**: `.week-cell`/`.day-cell` como `display:grid` con `minmax(0,1fr)`; eventos con `justify-self:stretch` + `align-self:center` (ocupan todo el ancho de la celda, etiqueta con `aria-label` completa); `time-slot` con `align-self:stretch`; foco visible para `[role="button"]:focus-visible`.
5. ~~Integración de fetch~~ **✔ Sesión 5**: `startMicrosoftOAuth` abre el navegador externo (tauri-plugin-opener) y un callback local (`127.0.0.1:43821`) recibe el código; el listener ahora acepta múltiples conexiones con deadline de 10 min (favicon/preflight ya no consumen el intento, "primero gana" ante redirecciones duplicadas). `waitForMicrosoftAuthorization` (oauth.ts) sondea cada 2 s hasta 5 min con reintento ante errores de red; cada intento tiene generación propia (`oauthAttempt`) y el más reciente cancela a los anteriores. `poll_microsoft_oauth` es async (`spawn_blocking`): el canje de tokens y el perfil /me ya no congelan la UI; el código de un solo uso se retira del map al canjear y un rechazo termina el sondeo con estado `error` claro. 2 tests Rust nuevos (12/12).
6. ~~Pruebas de rendimiento~~ **✔ Sesión 5**: `pnpm run test:performance` (`scripts/benchmark.mjs`) mide arranque en frío (DOMContentLoaded/load/app lista), métricas de render (Script/Layout/RecalcStyle/Task), cambios de vista, búsqueda y drawer (móvil) con medianas de 3 corridas, más tareas largas >50 ms en interacción; 9 presupuestos con PASS/FAIL y exit code. Resultado sobre el build de producción: 9/9 (app lista 78 ms, vistas 1–3 ms, búsqueda 3 ms, drawer 186 ms, 0 tareas largas).
7. ~~Documentación~~ **✔ Sesión 4**: README reestructurado con características, requisitos, build Dev/Prod, verificación automatizada, **sección de accesibilidad**, documentación de `Modal.svelte`, responsive y limitaciones.
8. ~~Idiomas~~ **✔ Sesión 5 (infraestructura)**: `src/lib/i18n.ts` con diccionario por locale, `t()` tipada (claves validadas por `svelte-check`) con interpolación `{param}`, locale persistido (`emeil-locale`) y patrón de extracción documentado en el módulo. Cableado del shell completo (rail, topbar, barra lateral, filtros y menú contextual); el resto de cadenas se migra incrementalmente.
9. ~~Entrada de cuentas guardadas~~ **✔**: `loadSavedAccounts()` se invoca al iniciar y tras el alta OAuth.

## Dependencias
- Rust + Tauri 2
- Node.js 20 (pnpm)
- Svelte 5
- TypeScript.
- deps: `native-tls` (IMAP/POP3), `lettre` (SMTP), `reqwest`, `serde`, `chrono`, `url`, `web-sys`, `tauri`, `tauri-plugin-dialog`, `keyring`, `base64`, `regex`.

## Comandos de Verificación
```bash
pnpm exec svelte-check --threshold error
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml          # 12 tests (IMAP/POP3/OAuth)
node scripts/verify-modal-a11y.mjs                        # requiere dev server + Chrome headless con CDP
node scripts/verify-responsive.mjs                        # drawer móvil + overlays (12 comprobaciones)
node scripts/verify-keyboard.mjs                          # menú APG + Escape en cascada (7 comprobaciones)
node scripts/contrast-audit.mjs                           # auditoría de contraste WCAG (10 scopes claro/oscuro)
pnpm run test:performance                                 # benchmark con presupuestos (9 comprobaciones)
```

## Checklist para Continuar
- **Paso 1**: Ejecutar `pnpm exec svelte-check --threshold error` → debe dar 0 errores y 0 warnings. ✔
- **Paso 2**: Correr `pnpm build` y revisar que Vite construya sin avisos. ✔
- **Paso 3**: Verificar foco y teclado en modales (focus trap + ESC). ✔ (9/9 en `scripts/verify-modal-a11y.mjs`)
- **Paso 4**: Ejecutar pruebas unitarias Rust (`cargo test`). ✔ (10 tests)
- **Paso 5**: Documentar el nuevo componente `Modal.svelte` en el README. ✔ (Sesión 4)

> **Nota del Lead**: La sesión 3 cerró los pasos 1–4 del checklist, eliminó los 6 errores de tipos de `svelte-check`, los 4 warnings de a11y, los 5 warnings de Rust, e implementó el POP3 real (antes era un stub con datos de ejemplo). **La sesión 4** resolvió las tareas 1, 2, 3, 4, 7 y 9 (lote UI/UX + docs): contraste WCAG AA completo con auditoría automatizada y Lighthouse a11y 100/100, responsive móvil con drawer verificado 12/12, grillas de calendario con alineación de etiquetas de eventos, README reestructurado con sección de accesibilidad y `Modal.svelte` documentado. **La sesión 5** cerró las tareas 5, 6 y 8: ciclo OAuth robusto (sondeo con reintento y generación de intentos, canje sin bloquear la UI, callback tolerante a conexiones previas), benchmark de rendimiento con presupuestos (`pnpm run test:performance`, 9/9) e infraestructura i18n con el shell migrado; además implementó el **modo oscuro real** (tokenización de 140 colores, switch accesible persistido, detección del sistema, auditoría de contraste en los 10 scopes y Lighthouse 100/100 en ambos modos). **La sesión 6** añadió el pulido de teclado (menú contextual navegable por flechas según APG con foco inicial, `Home`/`End`, `Tab` cierra; Escape en cascada para menú → temas → filtros → drawer, verificado con `scripts/verify-keyboard.mjs` 7/7), subió las fuentes mínimas de 7–8px a 8–9px e **inicializó git** con el commit inicial `cd9d5ab` (60 archivos, `.gitignore` con `.pnpm-store`/`acl-recovery`). Roadmap posterior: migración incremental del resto de cadenas a `t()`, STARTTLS IMAP, sincronización completa POP3, compilación Linux real y CI/publicación del repositorio.