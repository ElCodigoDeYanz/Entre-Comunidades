import { randomUUID, randomBytes } from "node:crypto";
import { POLICY_VERSION } from "./types.js";
import { hashPassword } from "./security.js";
export async function seed(store) {
    if (store.one("SELECT id FROM users LIMIT 1"))
        return;
    const hash = await hashPassword(randomBytes(32).toString("hex"));
    const now = Date.now();
    const data = [
        ["demo-lucia", "Lucia.demo", "Lima Centro", ["arte", "fotografia"]],
        ["demo-mateo", "Mateo.demo", "Lima Centro", ["programacion", "lectura"]],
        ["demo-nora", "Nora.demo", "Lima Norte", ["futbol", "naturaleza"]],
        ["demo-ines", "Ines.demo", "Lima Centro", ["arte", "lectura"]],
    ];
    store.transaction(() => {
        for (const [id, alias, zone, interests] of data)
            store.run("INSERT INTO users(id,alias,alias_key,bio,zone,interests,password_hash,age_declared_at,policy_version,consent_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", id, alias, alias.toLowerCase(), "Perfil ficticio para recorrer la demostración.", zone, JSON.stringify(interests), hash, now, POLICY_VERSION, now, now);
        const communities = [
            [
                "c-arte",
                "Trazos compartidos",
                "Un espacio para dibujar, experimentar y compartir procesos creativos.",
                "arte",
                "Lima Centro",
                "public",
                "demo-lucia",
            ],
            [
                "c-codigo",
                "Código y café",
                "Aprender programación en compañía, con proyectos pequeños y preguntas grandes.",
                "programacion",
                "Lima Centro",
                "public",
                "demo-mateo",
            ],
            [
                "c-futbol",
                "La siguiente pichanga",
                "Nos organizamos para jugar con respeto, sin importar el nivel.",
                "futbol",
                "Lima Norte",
                "public",
                "demo-nora",
            ],
            [
                "c-lectura",
                "Entre páginas",
                "Conversaciones tranquilas alrededor de un libro. Comunidad privada de demostración.",
                "lectura",
                "Lima Centro",
                "private",
                "demo-ines",
            ],
            [
                "c-foto",
                "Miradas de barrio",
                "Ejercicios de fotografía sin publicar domicilios ni rutas personales.",
                "fotografia",
                "Lima Centro",
                "public",
                "demo-lucia",
            ],
            [
                "c-verde",
                "Pausa verde",
                "Encuentros para hablar de plantas y observar lo que crece cerca.",
                "naturaleza",
                "Lima Sur",
                "public",
                "demo-nora",
            ],
        ];
        for (const [id, name, description, interest, zone, privacy, owner,] of communities) {
            store.run("INSERT INTO communities VALUES (?,?,?,?,?,?,?,?,0,1,?)", id, name, description, interest, zone, privacy, "Respeta los límites de los demás. Coordina en lugares públicos. No publiques datos personales. Puedes cancelar y denunciar.", owner, now);
            store.run("INSERT INTO memberships VALUES (?,?,'active','owner',?)", id, owner, now);
            const backup = owner === "demo-ines" ? "demo-lucia" : "demo-ines";
            store.run("INSERT INTO memberships VALUES (?,?,'active','moderator',?)", id, backup, now);
        }
        const future = (days, hour = 16) => {
            const d = new Date(now + days * 86400000);
            d.setUTCHours(hour + 5, 0, 0, 0);
            return d.getTime();
        };
        const events = [
            [
                "e-dibujo",
                "c-arte",
                "demo-lucia",
                "Un sábado para dibujar",
                "Trae un cuaderno y ganas de crear. Una sesión abierta de dibujo y conversación.",
                "plaza-demo",
                future(5),
                8,
                "confirmed",
                "Se consultarán necesidades de acceso. Lugar de ejemplo, sin verificación física.",
            ],
            [
                "e-codigo",
                "c-codigo",
                "demo-mateo",
                "Ideas pequeñas, código en compañía",
                "Comparte una idea y construye un primer paso con otras personas curiosas.",
                "biblioteca-demo",
                future(3, 18),
                6,
                "confirmed",
                "Espacio y accesos de demostración. Consulta necesidades por la conversación.",
            ],
            [
                "e-futbol",
                "c-futbol",
                "demo-nora",
                "La pichanga del fin de semana",
                "Una propuesta para movernos, compartir y jugar con respeto.",
                "cancha-demo",
                future(6, 10),
                10,
                "proposed",
                "Necesidades por confirmar con participantes antes de confirmar el encuentro.",
            ],
            [
                "e-foto",
                "c-foto",
                "demo-lucia",
                "Mirar la luz de otra manera",
                "Un ejercicio de fotografía en un solo lugar público, sin compartir recorridos.",
                "plaza-demo",
                future(8),
                5,
                "confirmed",
                "Condiciones de acceso pendientes de confirmar; lugar sintético.",
            ],
            [
                "e-libro",
                "c-lectura",
                "demo-ines",
                "Una historia, muchas lecturas",
                "Una conversación de comunidad privada sobre una lectura de libre elección.",
                "biblioteca-demo",
                future(7),
                4,
                "confirmed",
                "Comunica necesidades específicas. No se ha inspeccionado un lugar real.",
            ],
            [
                "e-verde",
                "c-verde",
                "demo-nora",
                "Una pausa entre hojas",
                "Intercambio de ideas para cuidar plantas y observar la naturaleza.",
                "parque-demo",
                future(10),
                6,
                "confirmed",
                "Lugar público sintético; accesibilidad todavía no verificada.",
            ],
            [
                "e-pasado",
                "c-arte",
                "demo-lucia",
                "Bitácora creativa · ejemplo realizado",
                "Actividad pasada ficticia para mostrar los límites de las opiniones.",
                "plaza-demo",
                future(-3),
                6,
                "completed",
                "Datos de demostración.",
            ],
        ];
        for (const [id, c, host, title, description, venue, start, capacity, status, accessibility,] of events)
            store.run("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1,?)", id, c, host, title, description, start, start + 90 * 60000, capacity, venue, accessibility, status, now);
        store.run("INSERT OR IGNORE INTO memberships VALUES ('c-arte','demo-mateo','active','member',?)", now);
        store.run("INSERT INTO registrations(event_id,user_id,status,confirmed_revision,joined_at,updated_at) VALUES ('e-dibujo','demo-mateo','going',1,?,?)", now, now);
        store.run("INSERT INTO registrations(event_id,user_id,status,confirmed_revision,joined_at,updated_at) VALUES ('e-pasado','demo-mateo','going',1,?,?)", now - 3 * 86400000, now - 3 * 86400000);
        store.run("INSERT INTO reviews VALUES (?,'e-pasado','demo-mateo',4,?,'registration-only',?)", randomUUID(), "Opinión sintética: me gustó compartir ideas. No acredita una asistencia real.", now - 2 * 86400000);
    });
}
