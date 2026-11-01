# Entre · comunidades y encuentros por intereses

Primera entrega de **Yanz Studio Systèmes**. **Entre** es un nombre provisional; no se ha comprobado disponibilidad comercial o registral. Otros nombres a considerar: Nexo Común y Trama. Caso propio con perfiles, actividades y lugares **sintéticos**, sin clientes inventados ni encuentros reales convocados.

## Ejecutar localmente

Entorno verificado: Node.js **24.22.1**, SQLite integrado y TypeScript estricto. No hay dependencias de producción de terceros. El JavaScript compilado está incluido:

```bash
npm start
```

Abre **http://127.0.0.1:8004**. No necesita claves, correo, mapas ni servicios de pago. Los datos se crean en `runtime/entre.sqlite3`. La carpeta runtime no se incluye en el ZIP.

Para modificar código o ejecutar pruebas:

```bash
npm ci
npm run build
npm test
```

Node debe ser de la rama 24, al menos 24.15. Si tu equipo no cumple esa versión, instala una versión compatible antes de ejecutar; no se modificó el ordenador del usuario durante esta construcción. `npm ci` solo instala TypeScript y definiciones de Node para desarrollo. Cada proyecto de esta entrega se ejecuta por separado.

## Recorrido de demostración

1. **Crear mi perfil**: alias de prueba, frase de acceso de al menos 12 caracteres, zona manual e intereses. Declaración 18+ y aceptación del aviso del piloto. Usa datos sintéticos.
2. **Comunidades**: busca por interés o zona; ingresa en una abierta o solicita ingreso en una privada.
3. En **Explorar**, abre una actividad confirmada y reserva una plaza. Si el aforo está completo, entra en espera. Una propuesta aún no admite reservas.
4. Coordina desde la conversación del encuentro; no publiques datos personales. Los mensajes persisten.
5. Cancela. Se revoca el acceso a la conversación y se promueve la espera por orden. La nueva persona debe confirmar la versión vigente para escribir.
6. Revisa las notificaciones internas y tu agenda. Edita intereses y zona desde tu perfil.

Para recorrerlo sin crear credenciales, usa **Recorrer la demostración** y elige un perfil ficticio. Lucía organiza arte/fotografía; Mateo organiza programación; Nora organiza fútbol/naturaleza; Inés organiza la comunidad privada de lectura y modera otras comunidades. La contraseña de los perfiles precargados es aleatoria y no se publica. La entrada de un clic es **exclusiva del modo demo**, no autenticación adecuada para un servicio público.

## Implementado

- Registro y sesiones con cookie HttpOnly/SameSite Strict, expiración de 12 horas, tokens de sesión almacenados por huella, CSRF y comprobación de origen.
- Perfil sin correo, teléfono, domicilio, documentos ni coordenadas. Contraseñas derivadas con scrypt, sal aleatoria por cuenta. No hay recuperación automática de contraseña.
- Catálogo de seis intereses y ocho zonas aproximadas; búsqueda y filtros manuales por tema, zona, fechas y plazas.
- Afinidad opcional explicada: 2 puntos por interés coincidente, 2 por zona elegida y 1 por disponibilidad. El orden cronológico permite explorar sin afinidad. No usa IA ni ubicación del dispositivo.
- Comunidades abiertas y privadas; solicitudes, aprobación o rechazo, reglas y roles. La organización asigna moderadores entre miembros activos. Moderación puede retirar miembros con límites de rol, liberar sus plazas y ocultar mensajes.
- Encuentros propuestos/confirmados/cancelados/realizados, fechas en UTC y presentación en hora de Perú, aforo para participantes **sin contar a organización** y lugar público de un catálogo sintético.
- Inscripción única, espera ordenada y transacciones `BEGIN IMMEDIATE`. SQLite también impide exceder aforo mediante triggers, incluso si se omite el servicio.
- Edición de encuentros futuros con nueva versión, aviso persistente y reconfirmación. Reservar, reconfirmar y editar exigen la versión revisada; un formulario obsoleto devuelve 409. Una plaza pendiente de reconfirmar sigue ocupada: no se asigna a dos personas.
- Conversación por encuentro con autorización en servidor; espera y cancelación no habilitan lectura. Moderación y organización pueden acceder conforme al aviso.
- Bloqueos bidireccionales para visibilidad e interacción. Reportes con copia limitada de evidencia, revisión restringida y exclusión de conflictos directos.
- Opiniones de cuentas con inscripción registrada en actividades marcadas realizadas. **No se verifica asistencia, edad o identidad** y no se garantiza la seguridad del encuentro.
- Descarga de datos propios, eliminación de cuenta con revocación de sesiones y retiro de textos, política de retención y limpieza al arrancar/cada hora.

## Arquitectura mínima

`server/database.ts` define esquema, transacciones e invariantes. `security.ts` concentra autenticación, sesiones y límites de intento. `validation.ts` valida tipos y límites en ejecución. `service.ts` aplica permisos y reglas. `app.ts` adapta HTTP y entrega archivos. `maintenance.ts` aplica conservación. `frontend/app.ts` es la interfaz tipada; HTML y CSS semánticos en `public/`.

Node 24 + SQLite integrado evitan un servidor de base de datos, framework HTTP, ORM o paquetes nativos instalados por separado. El backend se mantiene en un único proceso para esta versión. Cuatro workers independientes contra el mismo SQLite se usan **solo en una prueba de aforo**, para comprobar la restricción persistente. No se afirma escalabilidad de producción.

## Comprobaciones y evidencias

- `tests/security.test.ts`: permisos, privacidad, sesión, CSRF, origen, registro, espera, aforo concurrente, cambios, reportes, roles, eliminación, retención y recorrido completo por HTTP real contra un servidor temporal.
- `evidence/test-output.txt`: salida real de la suite.
- `evidence/dependency-audit.json`: resultado de `npm audit`; cubre avisos conocidos de las dependencias instaladas, no el comportamiento completo de la aplicación.
- `evidence/entre-*.jpg`: capturas reales del navegador durante la demostración, con datos ficticios. Inicio, formulario de registro, comunidades, mensaje guardado y cancelación. La captura de coordinación previa muestra un paso intermedio; `entre-mensaje-guardado.jpg` acredita el mensaje persistido.
- `docs/REVISION-SEGURIDAD.md`: alcance, hallazgos corregidos, controles comprobados y límites de la revisión interna.

El registro completo está comprobado por HTTP. En el navegador se inspeccionó su formulario y se utilizó la entrada con perfil ficticio para el resto del recorrido; no se introdujeron credenciales del usuario. Las últimas mejoras de roles, la revisión móvil y nuevas capturas no pudieron verificarse visualmente: la revisión automática del navegador alcanzó su límite de uso. Las capturas muestran la revisión de escritorio realizada antes de esas mejoras incrementales.

## Configuración

Variables de `.env.example` se leen del entorno; **no hay carga automática de `.env`**:

- `ENTRE_DB`: ruta alternativa para SQLite.
- `ENTRE_PORT` / `ENTRE_HOST`: por defecto 8004 y 127.0.0.1.
- `ENTRE_DEMO=0`: desactiva seed y entrada de un clic; no convierte la demo en un servicio listo para datos reales.
- `ENTRE_SECURE_COOKIE=1`: cookie Secure para una futura terminación HTTPS.
- `ENTRE_PUBLIC_ORIGIN`: origen explícito admitido, sin rutas.

Si `NODE_ENV=production`, el arranque exige demo desactivada, cookies Secure y un origen HTTPS explícito. Sigue siendo necesario resolver las validaciones legales y operativas antes de un despliegue. No se ha publicado ni contratado ningún servicio.

## Políticas y limitaciones

Aviso visible: `/privacy`. Documentos: `docs/PRIVACIDAD-Y-RETENCION.md`, `docs/MODERACION.md`, `docs/REVISION-LEGAL-PERU.md`. Los plazos son propuestas de producto, no plazos impuestos genéricamente por la ley.

Uso local con datos ficticios. No existe equipo operativo real de moderación ni un canal de atención ARCO validado. No se verifican venues reales ni accesibilidad física, no hay mapas, geolocalización, correo, SMS o push. No hay mensajes privados. Los filtros de texto detectan patrones comunes de contactos, pero no garantizan bloquear todas las formas de datos personales. No hay auditoría independiente, pruebas de penetración exhaustivas, certificación WCAG ni garantía de seguridad física.

Límites iniciales: 32 KiB por petición JSON, 100 plazas por actividad, hasta 5 comunidades organizadas y 50 encuentros abiertos por persona, 100 resultados por pantalla y 100 mensajes recientes por encuentro. La moderación no puede resolver sus propios reportes ni los dirigidos contra ella; una comunidad debe contar con otra persona moderadora para esos casos. Si falta, la vía operativa de escalamiento sigue pendiente para el piloto real.

Ampliaciones futuras: recuperación de acceso, apelaciones, observabilidad operativa, protección adicional frente a abuso distribuido, accesibilidad probada en móvil/lector de pantalla, venues reales revisados y operación legal/segura con personas reales. No están implementadas en esta entrega.
