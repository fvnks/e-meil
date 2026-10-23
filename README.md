# e-Meil

Un cliente de correo para escritorio, hecho con Tauri 2, Rust y Svelte 5. Disponible para Windows y Linux.

## ¿Por qué existe?

Me cambié a Linux hace un tiempo y, por más que busqué, no encontré un cliente de correo que me convenciera. Los que había eran demasiado complicados, otros tenían cosas que no usaba, o simplemente no sentía que estuvieran hechos para mí. Así que decidí hacer el mío.

No es el primer proyecto así que he visto, pero para mí tiene sentido tener algo que funcione bien y que entienda lo que necesito: conectar mis cuentas sin complicaciones, organizar el correo como pienso, y que no robe la atención con animaciones innecesarias.

## Qué puedes hacer

- Conectar cuentas **Microsoft 365** (Outlook, Hotmail, Live) con inicio de sesión integrado: no necesitas configurar nada, la app abre una ventana y se encarga del resto.
- Conectar cuentas **Gmail** con OAuth 2.0 (usando la identidad pública de Thunderbird, igual que Microsoft usa la de DavMail — esto lo explica el asistente al agregar la cuenta).
- Agregar cualquier cuenta **IMAP** o **POP3** que tengas, con o sin cifrado.
- Ver tus correos en formato texto o HTML (con scripts bloqueados para seguridad).
- Enviar correos con adjuntos hasta 25 MB.
- Buscar en el servidor, no solo en local.
- Gestionar borradores guardados en el servidor.
- Notificaciones de escritorio cuando llega correo nuevo.
- Atajos de teclado estilo Outlook: `Ctrl+N` para redactar, `Ctrl+F` buscar, `Ctrl+R` responder.
- Un menú contextual navegable con teclado.
- Modo oscuro real, no solo colores invertidos.
- Temas de color ajustables desde Ajustes.

## Lo que no tiene (por ahora)

- No sincroniza con servidores propios: cada cuenta se conecta directo al suyo.
- No hay datos de demostración: la app está vacía hasta que agregues una cuenta.
- Las respuestas e hilos de conversación funcionan bien en Microsoft Graph e IMAP; en POP3 no hay hilos porque el protocolo no los soporta.
- En Linux el paquete `.deb` se actualiza con `apt`; AppImage y MSI/NSIS se actualizan con el sistema integrado de e-Meil.

## Requisitos

- Node.js 20+ y [pnpm](https://pnpm.io)
- Rust (stable) con Cargo
- Tauri 2 CLI (`@tauri-apps/cli`, incluido en las dependencias del proyecto)
- En Linux: libwebkit2gtk-4.1, libgtk-3, libayatana-appindicator3, librsvg2, patchelf y libssl

## Compilar y ejecutar

```bash
# Instalar dependencias
pnpm install

# Solo la interfaz web (Vite, http://127.0.0.1:5173)
pnpm dev

# La app de escritorio completa (Tauri)
pnpm tauri dev

# Verificar que todo compila sin errores
pnpm build

# Tests unitarios de Rust
cargo test --manifest-path src-tauri/Cargo.toml

# Construir instaladores
pnpm tauri build
```

Los instaladores salen en `src-tauri/target/release/bundle/`:
- **Windows**: MSI y NSIS
- **Linux**: AppImage y `.deb`

## Verificación automatizada

El proyecto incluye scripts que se ejecutan contra un navegador real (Chrome con CDP):

```bash
# Test de accesibilidad: foco en modales (Tab/Shift+Tab/Escape)
node scripts/verify-modal-a11y.mjs http://127.0.0.1:5173/

# Responsive móvil: drawer, panel de lectura y redactor a pantalla completa
node scripts/verify-responsive.mjs http://127.0.0.1:5173/

# Navegación por teclado: menú contextual (flechas, Home/End, Escape)
node scripts/verify-keyboard.mjs http://127.0.0.1:5173/

# Auditoría de contraste WCAG sobre styles.css
node scripts/contrast-audit.mjs

# Benchmark de rendimiento
pnpm run test:performance http://127.0.0.1:4173/
```

Lighthouse de accesibilidad: **100/100**.

## Estado actual

- `svelte-check`: 0 errores, 0 warnings
- `cargo test`: 26 tests pasando
- Scripts de verificación: todos verdes
- Instaladores: disponibles en [Releases](https://github.com/fvnks/e-meil/releases)

Más detalle en [ARCHITECTURE.md](ARCHITECTURE.md) y [SECURITY.md](SECURITY.md).

## Licencia

MIT.
