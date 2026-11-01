# Privacidad y conservación propuesta

Aviso visible en `public/privacy.html`, versión `piloto-0.1-2026-10`. La aplicación registra la versión aceptada, fecha de consentimiento y declaración de mayoría de edad. No registra fecha de nacimiento ni documentos. La declaración de edad es insuficiente para probarla: el diseño del piloto real debe evaluar ese límite y gestionar sospechas de menores.

## Minimización y exposición

Alias, presentación opcional, intereses de catálogo y zona aproximada manual. No hay directorio público de perfiles, correo, teléfono, domicilio, geolocalización, recorridos, presencia física en tiempo real, identidad biométrica o mensajes privados. El catálogo de venues es sintético. La pantalla explica los límites de las opiniones y de la autodeclaración. Los filtros de texto libre son preventivos y evadibles: requieren moderación, no permiten prometer ausencia total de datos personales.

La frase de acceso se deriva con scrypt; el token de sesión se almacena por huella. CSRF y la sesión no se ponen en URLs. No se registran cuerpos de peticiones o contraseñas en logs. El limitador utiliza una huella de la dirección de conexión con sal local persistente; esa huella se trata como dato seudónimo, no anónimo.

## Tabla de conservación

| Categoría | Propuesta y mecanismo |
| --- | --- |
| Sesiones | 12 horas; revocación por logout y eliminación de cuenta |
| Notificaciones | 90 días desde creación |
| Mensajes | 30 días después del fin del evento; excepción si un reporte vigente conserva la referencia |
| Reporte abierto | 180 días desde creación |
| Reporte resuelto/desestimado | 90 días desde resolución |
| Evidencia de reporte | Mismo plazo del reporte; el original retenido se purga al vencer si también pasó su plazo ordinario |
| Acciones auditadas | 180 días |
| Límites de intento | Un día tras el final de su ventana; sin dirección de conexión en claro |
| Perfil activo | Hasta eliminación solicitada desde la cuenta |
| Perfil eliminado | Retiro inmediato del alias/presentación/intereses/zona/credenciales; permanecen referencias seudónimas de consistencia. Metadatos de consentimiento retirados a los 180 días |

La limpieza se ejecuta al iniciar y cada hora de servicio. Apagada la aplicación, se ejecuta al siguiente inicio. `npm run maintenance` permite una ejecución manual. No hay mecanismo de retención legal extraordinaria implementado: debe validarse antes de casos reales. Los plazos no son asesoramiento ni una transcripción de obligaciones legales.

## Eliminación y derechos

La cuenta puede exportar sus datos propios y eliminarlos confirmando su frase. Se revocan sesiones, cancelan inscripciones, archivan comunidades propias y cancelan sus encuentros futuros. Mensajes quedan retirados, opiniones se borran y los reportes vigentes conservan evidencia limitada según esta tabla. Una baja no garantiza que desaparezcan datos ya compartidos fuera de la plataforma; no hay integraciones de exportación externa automáticas.

La descarga y edición de perfil no sustituyen un procedimiento ARCO completo. Faltan validar responsable legal, canal de atención, plazos de respuesta aplicables, identidad de quien ejerce derechos, oposición, registro de solicitudes y excepciones. No se aceptan personas ni datos reales hasta resolver el diseño operativo. No hay respaldos creados en esta entrega; la política de backups y su eliminación debe definirse antes de producción.
