# Caso demostrativo propio · Entre

## Problema y alcance

Encontrar personas con intereses comunes y coordinar una actividad requiere más que una lista de perfiles: debe distinguir propuesta y confirmación, proteger aforo, dar contexto a los cambios y limitar el acceso a conversaciones. Este caso explora ese recorrido con datos sintéticos, sin comunidad pública operativa ni métricas de clientes.

## Solución construida

Registro con alias e intereses, zona elegida manualmente, búsqueda de comunidades, ingreso abierto o con aprobación, encuentros y plazas transaccionales, coordinación por actividad y cancelación con espera. Los roles, reportes y avisos internos forman parte del mismo modelo. Un perfil o valoración no se presenta como comprobación de identidad o seguridad.

## Decisiones técnicas

TypeScript estricto en servidor e interfaz; Node 24 y SQLite integrado para un arranque local sin servicios. Las invariantes de aforo viven también en SQLite, no solo en la pantalla. La versión revisada se exige al reservar, reconfirmar o editar, evitando aceptar cambios inadvertidos. La espera conserva orden y una promoción exige confirmación antes de escribir. El perfil no recoge coordenadas, teléfonos, domicilios ni documentos.

El diseño combina tonos cálidos, ilustraciones SVG propias, filtros manuales y estados visibles. La afinidad es una regla de puntuación opcional y explicada. No se incorporó IA, mapa, citas, mensajes privados o pagos para completar el recorrido inicial.

## Evidencias

Suite con registro y recorrido completo por HTTP, permisos privados, CSRF/origen, aforo de cuatro workers contra una plaza, duplicados, cancelación, cambios, moderación, reportes, eliminación y conservación. Capturas reales de escritorio de la demostración con ingreso por perfil ficticio. El navegador se bloqueó por límite de revisión automática antes de comprobar las últimas mejoras y el diseño móvil; ese alcance no se da por probado.

`docs/REVISION-SEGURIDAD.md` y `docs/REVISION-LEGAL-PERU.md` documentan controles y condiciones pendientes. No se declara una auditoría independiente, una certificación de accesibilidad o cumplimiento legal integral.

## Demo que puede explicarse

Crear perfil sintético, elegir intereses, ingresar a una comunidad, reservar en actividad confirmada, escribir una pregunta, cancelar y comprobar la pérdida de acceso al chat. Después, comparar una propuesta sin reservas, una comunidad privada y un cambio que requiere reconfirmación. Explicar por qué cuatro solicitudes simultáneas producen una sola reserva y tres esperas.

## Siguiente etapa

Revisión móvil/lector de pantalla, operación real de moderación, vías ARCO y apelación, revisión legal de la operación y pruebas independientes de seguridad/carga. Solo después evaluar un piloto real limitado. No se ha desplegado ni contratado ningún servicio.
