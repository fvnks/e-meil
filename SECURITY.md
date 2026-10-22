# Seguridad y privacidad

e-Meil se conecta directamente desde la aplicación del usuario a los proveedores de correo. El proyecto no opera un servicio central de cuentas ni recibe credenciales.

## Reglas para desarrollo

- Nunca guardar contraseñas o tokens en texto plano, archivos de configuración, logs, telemetría o capturas.
- Usar OAuth y el almacén de credenciales del sistema operativo siempre que sea posible.
- Limitar permisos OAuth a lo necesario y explicar con claridad cada permiso solicitado.
- No desactivar la validación TLS de los servidores.
- Tratar HTML, enlaces, imágenes remotas y adjuntos de correo como contenido no confiable; evitar ejecución de scripts y carga remota automática.
- Mantener dependencias actualizadas y revisar sus licencias antes de integrar protocolos o cifrado.

La UI tiene un puente inicial al keyring nativo para guardar y eliminar credenciales; la conexión a servidores y la recuperación del secreto para operaciones nativas aún no están implementadas. No uses credenciales reales hasta que se implementen y revisen los flujos completos de conexión, OAuth y manejo de errores. Para reportar una vulnerabilidad, no publiques detalles explotables en un issue público; contacta primero con los mantenedores cuando se configure un canal de seguridad.
