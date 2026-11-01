# Contrato HTTP del piloto

JSON de error uniforme: `{error, message, requestId}`. `requestId` no contiene datos de la cuenta. Los cuerpos JSON tienen límite de 32 KiB. Se rechazan campos inesperados y tipos incorrectos. No hay API pública para consultar frases de acceso, tokens de sesión o perfiles arbitrarios.

## Sesiones

`POST /api/register`: alias, password, bio, zone, interests, adultDeclaration y acceptPolicies. Alias único normalizado; frase de 12–128 caracteres. Las casillas son booleanos verdaderos, no texto. Devuelve perfil y CSRF; establece cookie HttpOnly/SameSite Strict.

`POST /api/login`: alias y password. Mensaje genérico de fallo; límites por dirección de conexión seudonimizada. `GET /api/session` consulta sesión y CSRF propios. `POST /api/logout` la revoca.

Todas las mutaciones autenticadas exigen cookie válida y `X-CSRF-Token`. Las solicitudes de navegador con Origin distinto se rechazan; no hay CORS abierto. Registro/login/demo también comprueban Origin y solo aceptan JSON. El modo demo habilita `POST /api/demo-login {persona}` para perfiles ficticios; está ausente si se desactiva.

## Rutas principales

| Ruta | Acción y autorización |
| --- | --- |
| GET /api/catalog | Intereses, zonas, venues sintéticos e integraciones disponibles |
| PATCH /api/profile | Perfil propio: bio, zone, interests |
| GET /api/account/export | Exportación de la cuenta, sin credenciales ni datos de reportes ajenos |
| DELETE /api/account | Contraseña propia y `confirm: "ELIMINAR"` |
| GET /api/communities | Descubrimiento; privadas muestran solo resumen hasta aprobación |
| POST /api/communities | Crear comunidad; cuenta activa; máximo cinco organizadas |
| POST /api/communities/:id/join | Ingreso público o solicitud privada idempotente |
| GET /api/communities/:id/requests | Solo moderación de esa comunidad |
| PATCH /api/communities/:id/requests/:user | Solo moderación; `{approve: boolean}` |
| GET /api/communities/:id/members | Solo moderación; alias y rol |
| PATCH /api/communities/:id/members/:user/role | Solo organización; `{moderator: boolean}` |
| POST /api/communities/:id/members/:user/remove | Moderación con límites de jerarquía |
| POST /api/communities/:id/events | Miembro activo; crea propuesta |
| GET /api/events | Búsqueda manual o afinidad explicada; no filtra eventos privados |
| GET /api/events/:id | Autorización de comunidad privada y bloqueo |
| PATCH /api/events/:id | Organización/moderación; versión vigente obligatoria |
| PATCH /api/events/:id/status | Confirmar/realizar: moderación; cancelar: organización/moderación |
| POST /api/events/:id/registration | Miembro, actividad futura confirmada; `{revision: número}` |
| DELETE /api/events/:id/registration | Inscripción propia; libera plaza y promueve espera |
| POST /api/events/:id/reconfirm | Plaza propia; `{revision: número}` correspondiente a la versión revisada |
| GET/POST /api/events/:id/messages | Participantes con plaza, organización y moderación; escribir exige versión confirmada |
| POST /api/messages/:id/hide | Moderación de la comunidad del mensaje |
| GET/POST /api/events/:id/reviews | Leer según comunidad; publicar exige inscripción y actividad realizada |
| GET /api/notifications | Solo avisos propios |
| POST /api/notifications/:id/read | Solo destinatario |
| GET /api/blocks | Bloqueos propios |
| POST/DELETE /api/blocks/:user | Bloquear/desbloquear desde la cuenta propia |
| POST /api/reports | Miembro con alcance sobre la actividad; copia limitada de mensaje si corresponde |
| GET /api/reports/mine | Solo estado/referencia de reportes propios |
| GET /api/moderation/reports | Solo moderación de comunidad, sin conflicto directo |
| PATCH /api/moderation/reports/:id | Resolución explicada, sin autoevaluación; no pisa un caso ya cerrado |
| GET /api/my-events | Agenda de la cuenta según sus permisos actuales |

## Encuentros y concurrencia

Crear actividad: `title, description, startsAt, endsAt, capacity, venueId, accessibility`. Milisegundos Unix; inicio futuro, duración 15 minutos–12 horas, aforo 1–100 y venue de catálogo público sintético. Editar añade `revision`, la versión que se leyó. Una edición crea otra versión. La interfaz expresa horarios de Perú (UTC−5), el servidor guarda timestamps.

Reservar y reconfirmar exigen una versión explícita. Si cambia entre leer y actuar, el servidor devuelve **409 stale_revision**: la persona debe volver a abrir y revisar el encuentro. No se confirma silenciosamente una versión que aún no vio. Las plazas pendientes de reconfirmación permanecen reservadas.

Inscripción: unicidad `(event_id,user_id)`. Espera por `joined_at,id`; una cancelación promueve la primera persona todavía elegible, reservando plaza pendiente de confirmación. Transacciones inmediatas y triggers protegen el aforo en almacenamiento. La organización no consume las plazas de participantes.

## Descubrimiento

`q`, `interest`, `zone`, `from`, `to`, `available=1` y `order=date|recommended`. Recomendación opcional: interés +2, zona +2 y plaza disponible +1; se devuelven razones. `date` es el orden manual por defecto. Ni GPS ni IA. Los límites de respuesta de esta versión están documentados en README; no se afirma paginación ilimitada.
