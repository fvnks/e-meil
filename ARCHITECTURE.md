# Arquitectura inicial

## Principios

1. La interfaz nunca recibe contraseñas ni tokens directamente desde componentes.
2. Las operaciones de proveedores se exponen desde una capa de aplicación común y se ejecutan en Rust.
3. El modelo común representa mensajes, carpetas, adjuntos y cuentas; las capacidades específicas se declaran explícitamente.
4. La caché offline es local. No se crea un servicio central ni sincronización propia en esta etapa.
5. Calendario y contactos serán módulos separados que podrán reutilizar autenticación y adaptadores, sin imponerlos al núcleo de correo.

## Capas

- **UI (Svelte/TypeScript):** navegación, listas y lectura de mensajes, composición, búsqueda y preferencias.
- **Aplicación (Rust):** casos de uso, sincronización local, coordinación de cuentas y notificaciones.
- **Proveedores (Rust):** adaptadores Microsoft Graph, IMAP y POP3 detrás de traits comunes.
- **Persistencia local:** base de datos/cache y metadatos no secretos; secretos en el almacén seguro del sistema operativo.

## Notas de compatibilidad

Tauri usa el WebView del sistema: WebView2 en Windows y WebKitGTK en Linux. La distribución para Linux deberá documentar las dependencias del runtime. El uso de POP3 se limitará a las capacidades ofrecidas por el protocolo y servidor; no proporciona la misma gestión de carpetas y sincronización que IMAP.

## Pendientes de producto

- Configurar OAuth de Microsoft en el registro definitivo de la aplicación y aprobar los textos de consentimiento.
- Definir proveedores de identidad OAuth, registro de la aplicación Microsoft y flujo de consentimiento.
- Definir versiones mínimas de Windows y distribuciones Linux objetivo.
- Diseñar el asistente de configuración manual IMAP/POP3 y detección automática opcional.
- Seleccionar bibliotecas de protocolos y persistencia tras validar mantenimiento, licencias y compatibilidad.
