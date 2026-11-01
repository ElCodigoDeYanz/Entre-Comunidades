# Revisión interna de ciberseguridad · Entre v0.1

Fecha: 29/10/2026. Revisión realizada durante el desarrollo, con código, pruebas automatizadas y parte del recorrido en navegador. **No es una auditoría independiente, una certificación ni una prueba de penetración exhaustiva.** No se ha evaluado infraestructura de producción ni la seguridad física de los encuentros.

## Alcance

Aplicación Node/TypeScript, persistencia SQLite, sesiones, autorización por recurso, cambios de versión, aforo, exposición de contenido, bloqueos/reportes, eliminación y conservación. Datos sintéticos exclusivamente. Dependencias conocidas mediante `npm audit`. El resultado detallado de pruebas está en `evidence/test-output.txt` y los límites visuales en `evidence/verification.json`.

Activos: credenciales derivadas, sesiones, afiliaciones privadas, conversación, reportes/evidencia, consentimiento e integridad de plazas. Escenarios: visitante sin sesión, usuario autenticado ajeno a una comunidad, miembro en espera, participante cancelado, moderador de otra comunidad o con conflicto directo, solicitudes simultáneas, contenido no confiable y uso de un formulario obsoleto.

## Controles contrastados

| Riesgo | Control | Evidencia y límite |
| --- | --- | --- |
| Credenciales/sesión | scrypt N=32768,r=8,p=1 con sal; tokens por huella; HttpOnly/SameSite Strict; expiración y revocación | Pruebas de registro, almacenamiento, sesión y logout. Secure es opcional en localhost y exigido por el entrypoint de producción |
| Fuerza bruta básica | Ventanas persistentes por ruta y huella local de conexión | Pruebas de contador y reinicio HTTP. No protege por sí solo contra abuso distribuido o botnets |
| CSRF/origen | Token por sesión, JSON y Origin restringido | Casos de token incorrecto, origen cruzado y tipo de contenido no admitido |
| Acceso a contenido privado | Comprobación de membresía y permisos en servidor | Visitantes/ajenos/pendientes no leen eventos ni chats privados; mensajes de espera/cancelados denegados |
| Elevación de rol | Entrada cerrada, decisiones por comunidad, asignación de moderación solo por organización | Pruebas de campos privilegiados, autoaprobación, asignación y retiro de membresía |
| Revisión sesgada de reportes | Moderación de la comunidad y exclusión de quien reporta/persona reportada | Casos de acceso ajeno y conflicto, copia de evidencia y resolución explicada |
| Sobrecupo y duplicados | Unicidad y transacciones + triggers SQLite | Cuatro workers compiten por una plaza: uno reservado y tres en espera. Intento directo de exceder aforo rechazado |
| Confirmar cambios no revisados | Versión explícita en reserva, reconfirmación y edición | 409 si la versión cambió; prueba de formulario obsoleto y conservación de la confirmación anterior |
| XSS/inyección | Consultas parametrizadas; representación de texto escapada; CSP sin unsafe-inline; nosniff | Revisión de renderizado y prueba de JSON/cabeceras con payload sintético. No se hizo un pentest DOM exhaustivo |
| Datos de contacto/ubicación | Campos acotados, catálogo de zonas/venues, sin GPS, filtros de patrones comunes | Casos básicos de teléfonos/venues no admitidos. Texto libre puede eludir filtros: requiere moderación real |
| Baja/retención | Revocación, retiro de textos y limpieza por categoría | Pruebas de eliminación, conservación y purga de evidencia vencida |
| Traversal de archivos | Lista cerrada de archivos públicos | El servidor no convierte rutas arbitrarias en rutas del sistema |

## Hallazgos corregidos durante la construcción

1. Se exigió la versión revisada al reservar, reconfirmar y editar para evitar aprobar cambios desconocidos. El caso obsoleto ahora devuelve 409 y tiene regresión automatizada.
2. La sal del limitador se guarda en configuración local de SQLite. Reiniciar ya no crea una clave distinta que reinicie implícitamente las ventanas de acceso. Hay prueba HTTP entre dos instancias sucesivas.
3. La limpieza elimina reportes vencidos antes de purgar sus mensajes de origen para no retenerlos hasta otra ejecución.
4. El bloqueo no impide reportar después a la organización: se conserva un camino autorizado con alcance de comunidad.
5. Se restringieron las asignaciones de rol y retiros de membresía por jerarquía; se cancelan plazas y acceso a coordinación cuando se retira la membresía.
6. El cierre de reportes y el cambio de estado de actividad comprueban el estado vigente para evitar pisar una decisión concurrente.

No se da un porcentaje global de seguridad ni una puntuación. Que los casos pasen no demuestra ausencia de todas las vulnerabilidades.

## Dependencias

No hay paquetes de producción externos: HTTP, criptografía y SQLite vienen con Node. `npm audit` consultó los paquetes de desarrollo fijados y no informó avisos conocidos en esa ejecución. No audita Node, SQLite incorporado, el sistema operativo, servicios futuros ni reglas de negocio. La revisión/actualización del runtime corresponde al operador antes de un uso real.

## Pendientes y condiciones antes de un piloto real

- Desactivar demo y sus entradas de un clic. HTTPS, cookies Secure, origen explícito y configuración de red controlada. El proceso oficial rechaza una configuración `NODE_ENV=production` que omita estos mínimos; esto no equivale a autorización de despliegue.
- Revisar políticas, responsable legal, ARCO, bancos de datos, incidentes y los demás puntos de la revisión peruana. Definir equipo y escalamiento de moderación, recuperación de acceso y apelaciones.
- Revisión independiente, pruebas de abuso/carga, recursos de autenticación, dependencia del proceso único, tratamiento de proxy real, secretos, backups cifrados y su retención. SQLite local no está cifrado por esta aplicación.
- Completar accesibilidad con lector de pantalla, contraste y teclado en múltiples dispositivos; revisión visual de roles y móvil. No hay certificación WCAG.
- Completar el recorrido visual tras cambios finales. La aprobación automática del navegador rechazó nuevas observaciones por un límite de uso; no se intentó sortearla. Las capturas de escritorio corresponden a la fase ya revisada, con datos ficticios.

El resultado es una **demo con controles y evidencias documentadas**, no un servicio auditado para operar con personas reales.
