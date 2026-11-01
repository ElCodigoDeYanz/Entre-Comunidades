import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { buildApplication } from "../server/app.js";
import { register, newSession, rateLimit } from "../server/security.js";
import { Store } from "../server/database.js";
import { Communities } from "../server/service.js";
import { cleanup } from "../server/maintenance.js";
import { Problem } from "../server/types.js";
const PASSWORD = "una-frase-sintetica-para-pruebas";
type Agent = { cookie: string; csrf: string; id: string };
type App = Awaited<ReturnType<typeof buildApplication>>;
async function fixture(t: test.TestContext, demo = true) {
  const dir = mkdtempSync(join(tmpdir(), "entre-test-"));
  const app = await buildApplication({
    dbPath: join(dir, "test.db"),
    publicDir: resolve("public"),
    demo,
    secureCookie: false,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const addr = app.server.address();
  assert(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...app, base, dir };
}
async function api(
  app: { base: string },
  path: string,
  method = "GET",
  body?: unknown,
  agent?: Agent,
  extra: Record<string, string> = {},
) {
  const response = await fetch(app.base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(agent ? { Cookie: agent.cookie, "X-CSRF-Token": agent.csrf } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json()) as any;
  return { response, data };
}
async function demo(app: { base: string }, persona: string): Promise<Agent> {
  const { response, data } = await api(app, "/api/demo-login", "POST", {
    persona,
  });
  assert.equal(response.status, 200);
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: data.csrf,
    id: data.user.id,
  };
}
async function syntheticUser(app: App, n: number): Promise<Agent> {
  const row = await register(app.store, {
    alias: `Invitado_${n}`,
    password: PASSWORD,
    bio: "Datos sintéticos.",
    zone: "Lima Centro",
    interests: ["arte"],
    adultDeclaration: true,
    acceptPolicies: true,
  });
  const session = newSession(app.store, row, false);
  return {
    cookie: session.cookie.split(";")[0]!,
    csrf: session.body.csrf,
    id: String(row.id),
  };
}

test("registro exige mayoría de edad, consentimiento y rechaza privilegios enviados", async (t) => {
  const app = await fixture(t);
  const body = {
    alias: "Prueba_edad",
    password: PASSWORD,
    bio: "Perfil sintético.",
    zone: "Lima Centro",
    interests: ["arte"],
    adultDeclaration: false,
    acceptPolicies: true,
  };
  assert.equal(
    (await api(app, "/api/register", "POST", body)).response.status,
    422,
  );
  assert.equal(
    (
      await api(app, "/api/register", "POST", {
        ...body,
        adultDeclaration: true,
        acceptPolicies: false,
      })
    ).response.status,
    422,
  );
  assert.equal(
    (
      await api(app, "/api/register", "POST", {
        ...body,
        adultDeclaration: true,
        role: "admin",
      })
    ).response.status,
    422,
  );
  assert.equal(
    app.store.one("SELECT id FROM users WHERE alias_key='prueba_edad'"),
    undefined,
  );
});

test("credenciales derivadas, cookie HttpOnly/SameSite y sesión revocable", async (t) => {
  const app = await fixture(t);
  const result = await api(app, "/api/register", "POST", {
    alias: "Registro_real",
    password: PASSWORD,
    bio: "Perfil de prueba.",
    zone: "Lima Centro",
    interests: ["lectura"],
    adultDeclaration: true,
    acceptPolicies: true,
  });
  assert.equal(result.response.status, 201);
  const cookie = result.response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const row = app.store.one(
    "SELECT * FROM users WHERE id=?",
    result.data.user.id,
  )!;
  assert.notEqual(row.password_hash, PASSWORD);
  assert.match(String(row.password_hash), /^scrypt-v1\$/);
  assert.equal(result.data.user.password_hash, undefined);
  const agent = {
    cookie: cookie.split(";")[0]!,
    csrf: result.data.csrf,
    id: result.data.user.id,
  };
  assert.equal(
    (await api(app, "/api/session", "GET", undefined, agent)).data.user.alias,
    "Registro_real",
  );
  assert.equal(
    (await api(app, "/api/logout", "POST", undefined, agent)).response.status,
    200,
  );
  assert.equal(
    (await api(app, "/api/session", "GET", undefined, agent)).data.user,
    null,
  );
});

test("CSRF, origen cruzado y métodos inesperados se rechazan", async (t) => {
  const app = await fixture(t);
  const agent = await demo(app, "mateo");
  assert.equal(
    (
      await api(app, "/api/communities/c-arte/join", "POST", undefined, {
        ...agent,
        csrf: "wrong",
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await api(app, "/api/communities/c-arte/join", "POST", undefined, agent, {
        Origin: "https://foreign.invalid",
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await api(
        app,
        "/api/profile",
        "PATCH",
        { bio: "prueba", zone: "Lima Centro", interests: ["arte"] },
        agent,
        { "Content-Type": "text/plain" },
      )
    ).response.status,
    415,
  );
  assert.equal(
    (await api(app, "/api/not-a-route", "GET")).response.status,
    404,
  );
});

test("sin sesión no se leen notificaciones, coordinación ni exportaciones", async (t) => {
  const app = await fixture(t);
  for (const path of [
    "/api/notifications",
    "/api/events/e-dibujo/messages",
    "/api/account/export",
  ])
    assert.equal((await api(app, path)).response.status, 401);
});

test("comunidad privada no filtra encuentros, reglas ni conversación", async (t) => {
  const app = await fixture(t);
  const outsider = await demo(app, "nora");
  const list = (await api(app, "/api/communities", "GET", undefined, outsider))
    .data;
  const privateCommunity = list.find((c: any) => c.id === "c-lectura");
  assert.equal(privateCommunity.rules, null);
  assert.equal(privateCommunity.ownerAlias, null);
  assert.ok(
    !(await api(app, "/api/events", "GET", undefined, outsider)).data.some(
      (e: any) => e.id === "e-libro",
    ),
  );
  assert.equal(
    (await api(app, "/api/events/e-libro", "GET", undefined, outsider)).response
      .status,
    403,
  );
  assert.equal(
    (await api(app, "/api/events/e-libro/messages", "GET", undefined, outsider))
      .response.status,
    403,
  );
});

test("solicitud privada requiere aprobación de moderación y no puede autoaprobarse", async (t) => {
  const app = await fixture(t);
  const guest = await syntheticUser(app, 1);
  const owner = await demo(app, "ines");
  assert.equal(
    (
      await api(
        app,
        "/api/communities/c-lectura/join",
        "POST",
        undefined,
        guest,
      )
    ).data.status,
    "pending",
  );
  assert.equal(
    (
      await api(
        app,
        `/api/communities/c-lectura/requests/${guest.id}`,
        "PATCH",
        { approve: true },
        guest,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (await api(app, "/api/events/e-libro", "GET", undefined, guest)).response
      .status,
    403,
  );
  assert.equal(
    (
      await api(
        app,
        "/api/communities/c-lectura/requests",
        "GET",
        undefined,
        owner,
      )
    ).data.length,
    1,
  );
  assert.equal(
    (
      await api(
        app,
        `/api/communities/c-lectura/requests/${guest.id}`,
        "PATCH",
        { approve: true },
        owner,
      )
    ).response.status,
    200,
  );
  assert.equal(
    (await api(app, "/api/events/e-libro", "GET", undefined, guest)).response
      .status,
    200,
  );
});

test("registro duplicado conserva una sola inscripción y las propuestas no admiten plazas", async (t) => {
  const app = await fixture(t);
  const mateo = await demo(app, "mateo");
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      api(
        app,
        "/api/events/e-dibujo/registration",
        "POST",
        { revision: 1 },
        mateo,
      ),
    ),
  );
  assert.ok(results.every((r) => r.response.status === 200));
  assert.equal(
    Number(
      app.store.one(
        "SELECT COUNT(*) n FROM registrations WHERE event_id='e-dibujo' AND user_id=?",
        mateo.id,
      )!.n,
    ),
    1,
  );
  const guest = await syntheticUser(app, 2);
  await api(app, "/api/communities/c-futbol/join", "POST", undefined, guest);
  assert.equal(
    (
      await api(
        app,
        "/api/events/e-futbol/registration",
        "POST",
        { revision: 1 },
        guest,
      )
    ).response.status,
    409,
  );
});

test("aforo persistente: cuatro workers compiten por una plaza, el resto espera", async (t) => {
  const app = await fixture(t);
  app.store.run("UPDATE events SET capacity=1 WHERE id='e-codigo'");
  const guests = [];
  for (let n = 10; n < 14; n++) {
    const guest = await syntheticUser(app, n);
    app.service.joinCommunity(guest.id, "c-codigo");
    guests.push(guest);
  }
  const signal = new SharedArrayBuffer(4);
  const flag = new Int32Array(signal);
  const workers = guests.map(
    (g) =>
      new Worker(new URL("./capacity.worker.js", import.meta.url), {
        workerData: {
          path: app.store.path,
          uid: g.id,
          event: "e-codigo",
          signal,
        },
      }),
  );
  const results = workers.map(
    (worker) =>
      new Promise<any>((resolve, reject) => {
        worker.on("message", (message) => {
          if (message.result || message.error) resolve(message);
        });
        worker.on("error", reject);
      }),
  );
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise<void>((resolve, reject) => {
          worker.on("message", (m) => {
            if (m.ready) resolve();
          });
          worker.on("error", reject);
        }),
    ),
  );
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
  const outputs = await Promise.all(results);
  assert.ok(outputs.every((r) => !r.error));
  assert.equal(outputs.filter((r) => r.result.status === "going").length, 1);
  assert.equal(outputs.filter((r) => r.result.status === "waiting").length, 3);
  assert.equal(
    Number(
      app.store.one(
        "SELECT COUNT(*) n FROM registrations WHERE event_id='e-codigo' AND status='going'",
      )!.n,
    ),
    1,
  );
  await Promise.all(workers.map((worker) => worker.terminate()));
});

test("SQLite protege el aforo incluso al omitir el servicio", async (t) => {
  const app = await fixture(t);
  app.store.run("UPDATE events SET capacity=1 WHERE id='e-dibujo'");
  assert.throws(
    () =>
      app.store.run(
        "INSERT INTO registrations(event_id,user_id,status,confirmed_revision,joined_at,updated_at) VALUES ('e-dibujo','demo-ines','going',1,?,?)",
        Date.now(),
        Date.now(),
      ),
    /capacity exceeded/,
  );
  assert.throws(() =>
    app.store.run("UPDATE events SET capacity=0 WHERE id='e-dibujo'"),
  );
});

test("cancelar promueve por orden y exige confirmar antes de escribir", async (t) => {
  const app = await fixture(t);
  app.store.run("UPDATE events SET capacity=1 WHERE id='e-dibujo'");
  const guest = await syntheticUser(app, 20);
  app.service.joinCommunity(guest.id, "c-arte");
  assert.equal(
    app.service.joinEvent(guest.id, "e-dibujo", 1).status,
    "waiting",
  );
  assert.throws(
    () => app.service.messages(guest.id, "e-dibujo"),
    (e: any) => e.status === 403,
  );
  app.service.cancel("demo-mateo", "e-dibujo");
  assert.equal(
    app.service.ownRegistration(guest.id, "e-dibujo")!.status,
    "going",
  );
  assert.throws(
    () =>
      app.service.postMessage(guest.id, "e-dibujo", { body: "Hola, me sumo." }),
    (e: any) => e.code === "reconfirm",
  );
  app.service.reconfirm(guest.id, "e-dibujo", 1);
  app.service.postMessage(guest.id, "e-dibujo", { body: "Hola, me sumo." });
  assert.equal(app.service.messages(guest.id, "e-dibujo").length, 1);
});

test("cambios importantes conservan plaza, notifican y requieren reconfirmación", async (t) => {
  const app = await fixture(t);
  const before = app.service.event("e-dibujo", "demo-lucia");
  app.service.updateEvent("demo-lucia", "e-dibujo", {
    revision: 1,
    title: before.title,
    description: before.description,
    startsAt: Number(before.starts_at) + 3600000,
    endsAt: Number(before.ends_at) + 3600000,
    capacity: before.capacity,
    venueId: before.venue_id,
    accessibility: before.accessibility,
  });
  assert.equal(
    app.service.ownRegistration("demo-mateo", "e-dibujo")!.status,
    "going",
  );
  assert.equal(app.service.event("e-dibujo", "demo-mateo").revision, 2);
  assert.throws(
    () =>
      app.service.postMessage("demo-mateo", "e-dibujo", {
        body: "Mensaje antes de confirmar.",
      }),
    (e: any) => e.code === "reconfirm",
  );
  assert.ok(
    app.service
      .notifications("demo-mateo")
      .some((n) => n.kind === "event.changed"),
  );
  app.service.reconfirm("demo-mateo", "e-dibujo", 2);
  app.service.postMessage("demo-mateo", "e-dibujo", {
    body: "Confirmado, gracias.",
  });
});

test("solo organización o moderación editan; solo moderación confirma propuestas", async (t) => {
  const app = await fixture(t);
  const guest = await syntheticUser(app, 30);
  app.service.joinCommunity(guest.id, "c-arte");
  const t0 = Date.now() + 10 * 86400000;
  const proposed = app.service.createEvent(guest.id, "c-arte", {
    title: "Encuentro sintético",
    description: "Una propuesta para la demostración.",
    startsAt: t0,
    endsAt: t0 + 3600000,
    capacity: 4,
    venueId: "plaza-demo",
    accessibility: "Accesibilidad por confirmar.",
  });
  assert.equal(proposed.status, "proposed");
  assert.throws(
    () => app.service.changeStatus(guest.id, proposed.id, "confirmed"),
    (e: any) => e.status === 403,
  );
  app.service.changeStatus("demo-lucia", proposed.id, "confirmed");
  assert.throws(
    () => app.service.changeStatus("demo-nora", proposed.id, "cancelled"),
    (e: any) => e.status === 403,
  );
  assert.throws(
    () => app.service.changeStatus("demo-lucia", proposed.id, "completed"),
    (e: any) => e.status === 409,
  );
});

test("cancelación quita acceso a la conversación y se puede repetir sin duplicar", async (t) => {
  const app = await fixture(t);
  assert.equal(
    app.service.cancel("demo-mateo", "e-dibujo").status,
    "cancelled",
  );
  assert.equal(app.service.cancel("demo-mateo", "e-dibujo").duplicate, true);
  assert.throws(
    () => app.service.messages("demo-mateo", "e-dibujo"),
    (e: any) => e.status === 403,
  );
});

test("bloquear a organización cancela la inscripción, oculta sus encuentros y aún permite reportarla", async (t) => {
  const app = await fixture(t);
  app.service.block("demo-mateo", "demo-lucia");
  assert.equal(
    app.service.ownRegistration("demo-mateo", "e-dibujo")!.status,
    "cancelled",
  );
  assert.ok(
    !app.service
      .discover("demo-mateo", new URLSearchParams())
      .some((e) => e.hostId === "demo-lucia"),
  );
  const report = app.service.report("demo-mateo", {
    eventId: "e-dibujo",
    subjectUserId: "demo-lucia",
    reason: "Motivo de demostración para moderación.",
  });
  assert.equal(report.status, "open");
});

test("reportes conservan evidencia y solo moderación sin conflicto puede resolver", async (t) => {
  const app = await fixture(t);
  app.service.postMessage("demo-mateo", "e-dibujo", {
    body: "Mensaje sintético a revisar.",
  });
  const mid = String(
    app.store.one("SELECT id FROM messages WHERE event_id='e-dibujo'")!.id,
  );
  const report = app.service.report("demo-ines", {
    eventId: "e-dibujo",
    subjectUserId: "demo-mateo",
    messageId: mid,
    reason: "Revisión de prueba.",
  });
  assert.equal(app.service.reportsForModerator("demo-nora").length, 0);
  assert.equal(app.service.reportsForModerator("demo-ines").length, 0);
  assert.throws(
    () =>
      app.service.resolveReport("demo-ines", report.id, {
        status: "resolved",
        resolution: "Resolución sintética.",
      }),
    (e: any) => e.code === "conflict",
  );
  assert.equal(app.service.reportsForModerator("demo-lucia").length, 1);
  app.service.hideMessage("demo-lucia", mid);
  assert.equal(app.service.messages("demo-mateo", "e-dibujo").length, 0);
  assert.match(
    String(
      app.store.one("SELECT evidence FROM reports WHERE id=?", report.id)!
        .evidence,
    ),
    /Mensaje sintético/,
  );
  app.service.resolveReport("demo-lucia", report.id, {
    status: "resolved",
    resolution: "Se ocultó el mensaje de prueba.",
  });
  assert.equal(app.service.myReports("demo-ines")[0]!.status, "resolved");
});

test("opiniones exigen actividad realizada e inscripción; no afirman asistencia verificada", async (t) => {
  const app = await fixture(t);
  assert.throws(
    () =>
      app.service.review("demo-mateo", "e-dibujo", {
        rating: 5,
        body: "Demostración.",
      }),
    (e: any) => e.status === 403,
  );
  assert.throws(
    () =>
      app.service.review("demo-nora", "e-pasado", {
        rating: 5,
        body: "Demostración.",
      }),
    (e: any) => e.status === 403,
  );
  assert.equal(
    app.service.reviews(null, "e-pasado")[0]!.origin,
    "Inscripción registrada; asistencia no verificada",
  );
  assert.throws(
    () =>
      app.service.review("demo-mateo", "e-pasado", {
        rating: 5,
        body: "Demostración.",
      }),
    (e: any) => e.code === "review_duplicate",
  );
});

test("notificaciones ajenas no pueden marcarse leídas", async (t) => {
  const app = await fixture(t);
  app.service.notify("demo-mateo", "test", "Notificación sintética.");
  const nid = String(app.service.notifications("demo-mateo")[0]!.id);
  assert.throws(
    () => app.service.readNotification("demo-nora", nid),
    (e: any) => e.status === 404,
  );
});

test("eliminar cuenta revoca sesiones, borra perfil/textos y libera plaza", async (t) => {
  const app = await fixture(t);
  const guest = await syntheticUser(app, 40);
  app.service.joinCommunity(guest.id, "c-arte");
  app.service.joinEvent(guest.id, "e-dibujo", 1);
  app.service.postMessage(guest.id, "e-dibujo", {
    body: "Mensaje de prueba para eliminación.",
  });
  const result = await api(
    app,
    "/api/account",
    "DELETE",
    { password: PASSWORD, confirm: "ELIMINAR" },
    guest,
  );
  assert.equal(result.response.status, 200);
  assert.equal(
    (await api(app, "/api/session", "GET", undefined, guest)).data.user,
    null,
  );
  const u = app.store.one("SELECT * FROM users WHERE id=?", guest.id)!;
  assert.equal(u.bio, "");
  assert.equal(u.password_hash, "");
  assert.notEqual(u.alias_key, "invitado_40");
  assert.equal(
    app.store.one("SELECT body FROM messages WHERE user_id=?", guest.id)!.body,
    "[eliminado]",
  );
  assert.equal(
    app.service.ownRegistration(guest.id, "e-dibujo")!.status,
    "cancelled",
  );
});

test("límites de intento persisten y el modo demo se puede desactivar", async (t) => {
  const app = await fixture(t, false);
  assert.equal(
    (await api(app, "/api/demo-login", "POST", { persona: "lucia" })).response
      .status,
    404,
  );
  for (let i = 0; i < 3; i++)
    rateLimit(app.store, "synthetic-rate", 3, 60000, 100);
  assert.throws(
    () => rateLimit(app.store, "synthetic-rate", 3, 60000, 100),
    (e: any) => e.status === 429,
  );
  const other = new Store(app.store.path);
  assert.throws(
    () => rateLimit(other, "synthetic-rate", 3, 60000, 100),
    (e: any) => e.status === 429,
  );
  other.close();
});

test("rechaza datos de contacto, aforo inválido y lugar ajeno al catálogo", async (t) => {
  const app = await fixture(t);
  assert.throws(
    () =>
      app.service.postMessage("demo-mateo", "e-dibujo", {
        body: "Mi teléfono es 999 888 777.",
      }),
    (e: any) => e.code === "personal_data",
  );
  assert.throws(() =>
    app.service.updateProfile("demo-mateo", {
      bio: "vivo en mi casa",
      zone: "dirección precisa",
      interests: ["arte"],
    }),
  );
  const t0 = Date.now() + 86400000;
  assert.throws(
    () =>
      app.service.createEvent("demo-lucia", "c-arte", {
        title: "Prueba de lugar",
        description: "Descripción para pruebas.",
        startsAt: t0,
        endsAt: t0 + 3600000,
        capacity: 4,
        venueId: "mi-domicilio",
        accessibility: "Por verificar.",
      }),
    (e: any) => e.status === 422,
  );
});

test("búsqueda manual y recomendaciones describen razones sin geolocalización", async (t) => {
  const app = await fixture(t);
  const results = app.service.discover(
    "demo-mateo",
    new URLSearchParams({
      interest: "programacion",
      zone: "Lima Centro",
      available: "1",
      order: "recommended",
    }),
  );
  assert.equal(results.length, 1);
  assert.ok(results[0]!.reasons.some((r) => r.includes("interés")));
  assert.ok(results[0]!.reasons.some((r) => r.includes("zona")));
  const catalog = (await api(app, "/api/catalog")).data;
  assert.equal(catalog.integrations.geolocation, false);
  assert.equal(catalog.ageVerification, "self-declaration-only");
});

test("política de retención limpia sesiones y notificaciones vencidas", async (t) => {
  const app = await fixture(t);
  app.service.notify("demo-mateo", "old", "Aviso sintético.");
  const future = Date.now() + 200 * 86400000;
  const result = cleanup(app.store, future);
  assert.ok(Number(result.notifications) > 0);
  assert.equal(app.service.notifications("demo-mateo").length, 0);
});

test("recorrido completo por HTTP: registro, intereses, búsqueda, comunidad, plaza, coordinación y cancelación", async (t) => {
  const app = await fixture(t);
  const registration = await api(app, "/api/register", "POST", {
    alias: "Recorrido_completo",
    password: PASSWORD,
    bio: "Persona ficticia de pruebas.",
    zone: "Lima Centro",
    interests: ["fotografia", "arte"],
    adultDeclaration: true,
    acceptPolicies: true,
  });
  assert.equal(registration.response.status, 201);
  const agent = {
    cookie: registration.response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: registration.data.csrf,
    id: registration.data.user.id,
  };
  assert.deepEqual(registration.data.user.interests, ["fotografia", "arte"]);
  const communities = (
    await api(
      app,
      "/api/communities?interest=fotografia",
      "GET",
      undefined,
      agent,
    )
  ).data;
  assert.equal(communities.length, 1);
  assert.equal(
    (await api(app, "/api/communities/c-foto/join", "POST", undefined, agent))
      .data.status,
    "active",
  );
  assert.equal(
    (
      await api(
        app,
        "/api/events/e-foto/registration",
        "POST",
        { revision: 1 },
        agent,
      )
    ).data.status,
    "going",
  );
  assert.equal(
    (
      await api(
        app,
        "/api/events/e-foto/messages",
        "POST",
        { body: "Mensaje de coordinación sintético." },
        agent,
      )
    ).response.status,
    201,
  );
  assert.equal(
    (await api(app, "/api/events/e-foto/messages", "GET", undefined, agent))
      .data[0].body,
    "Mensaje de coordinación sintético.",
  );
  assert.equal(
    (
      await api(
        app,
        "/api/events/e-foto/registration",
        "DELETE",
        undefined,
        agent,
      )
    ).data.status,
    "cancelled",
  );
  assert.equal(
    (await api(app, "/api/events/e-foto/messages", "GET", undefined, agent))
      .response.status,
    403,
  );
  assert.equal(
    (await api(app, "/api/notifications", "GET", undefined, agent)).data.length,
    2,
  );
});

test("solo la organización asigna roles; retirar membresía revoca coordinación y libera aforo", async (t) => {
  const app = await fixture(t);
  assert.throws(
    () => app.service.setModerator("demo-ines", "c-arte", "demo-mateo", true),
    (e: any) => e.code === "owner_required",
  );
  app.service.setModerator("demo-lucia", "c-arte", "demo-mateo", true);
  assert.equal(app.service.moderator("demo-mateo", "c-arte"), true);
  assert.throws(
    () => app.service.removeMember("demo-ines", "c-arte", "demo-mateo"),
    (e: any) => e.code === "role_boundary",
  );
  app.service.removeMember("demo-lucia", "c-arte", "demo-mateo");
  assert.equal(app.service.member("demo-mateo", "c-arte"), undefined);
  assert.equal(
    app.service.ownRegistration("demo-mateo", "e-dibujo")!.status,
    "cancelled",
  );
  assert.throws(
    () => app.service.messages("demo-mateo", "e-dibujo"),
    (e: any) => e.status === 403,
  );
});

test("retención elimina evidencia vencida y mensaje de origen en la misma ejecución", async (t) => {
  const app = await fixture(t);
  app.service.postMessage("demo-mateo", "e-dibujo", {
    body: "Evidencia sintética temporal.",
  });
  const mid = String(
    app.store.one("SELECT id FROM messages WHERE event_id='e-dibujo'")!.id,
  );
  const report = app.service.report("demo-ines", {
    eventId: "e-dibujo",
    subjectUserId: "demo-mateo",
    messageId: mid,
    reason: "Ejemplo de evidencia temporal.",
  });
  const future = Date.now() + 200 * 86400000;
  cleanup(app.store, future);
  assert.equal(
    app.store.one("SELECT id FROM reports WHERE id=?", report.id),
    undefined,
  );
  assert.equal(
    app.store.one("SELECT id FROM messages WHERE id=?", mid),
    undefined,
  );
});

test("JSON y cabeceras impiden tratar los mensajes como HTML ejecutable", async (t) => {
  const app = await fixture(t);
  const agent = await demo(app, "mateo");
  const body = "<img src=x onerror=alert(1)> contenido sintético";
  await api(app, "/api/events/e-dibujo/messages", "POST", { body }, agent);
  const result = await api(
    app,
    "/api/events/e-dibujo/messages",
    "GET",
    undefined,
    agent,
  );
  assert.equal(result.data[0].body, body);
  assert.match(
    result.response.headers.get("content-type")!,
    /application\/json/,
  );
  assert.match(
    result.response.headers.get("content-security-policy")!,
    /script-src 'self'/,
  );
  assert.ok(
    !result.response.headers
      .get("content-security-policy")!
      .includes("unsafe-inline"),
  );
  assert.equal(
    result.response.headers.get("x-content-type-options"),
    "nosniff",
  );
  assert.equal(
    result.response.headers.get("permissions-policy"),
    "geolocation=(),camera=(),microphone=()",
  );
});

test("reservar, reconfirmar o editar exige la versión que la persona revisó", async (t) => {
  const app = await fixture(t);
  const before = app.service.event("e-dibujo", "demo-lucia");
  const edit = {
    revision: 1,
    title: before.title,
    description: before.description,
    startsAt: Number(before.starts_at) + 3600000,
    endsAt: Number(before.ends_at) + 3600000,
    capacity: before.capacity,
    venueId: before.venue_id,
    accessibility: before.accessibility,
  };
  app.service.updateEvent("demo-lucia", "e-dibujo", edit);
  const guest = await syntheticUser(app, 70);
  app.service.joinCommunity(guest.id, "c-arte");
  assert.throws(
    () => app.service.joinEvent(guest.id, "e-dibujo", 1),
    (e: any) => e.code === "stale_revision",
  );
  assert.throws(
    () => app.service.reconfirm("demo-mateo", "e-dibujo", 1),
    (e: any) => e.code === "stale_revision",
  );
  assert.throws(
    () => app.service.updateEvent("demo-lucia", "e-dibujo", edit),
    (e: any) => e.code === "stale_revision",
  );
  assert.equal(
    app.service.ownRegistration("demo-mateo", "e-dibujo")!.confirmed_revision,
    1,
  );
  app.service.reconfirm("demo-mateo", "e-dibujo", 2);
  assert.equal(
    app.service.ownRegistration("demo-mateo", "e-dibujo")!.confirmed_revision,
    2,
  );
});

test("el límite HTTP de acceso conserva su clave al reiniciar la aplicación", async (t) => {
  const app = await fixture(t);
  for (let n = 0; n < 10; n++)
    assert.equal(
      (
        await api(app, "/api/login", "POST", {
          alias: "Alias_inexistente",
          password: PASSWORD,
        })
      ).response.status,
      401,
    );
  const salt = String(
    app.store.one("SELECT value FROM settings WHERE key='rate_salt'")!.value,
  );
  const restarted = await buildApplication({
    dbPath: app.store.path,
    publicDir: resolve("public"),
    demo: true,
    secureCookie: false,
  });
  try {
    assert.equal(
      String(
        restarted.store.one("SELECT value FROM settings WHERE key='rate_salt'")!
          .value,
      ),
      salt,
    );
    restarted.server.listen(0, "127.0.0.1");
    await once(restarted.server, "listening");
    const address = restarted.server.address();
    assert.ok(address && typeof address === "object");
    const other = { base: `http://127.0.0.1:${address.port}` };
    assert.equal(
      (
        await api(other, "/api/login", "POST", {
          alias: "Alias_inexistente",
          password: PASSWORD,
        })
      ).response.status,
      429,
    );
  } finally {
    restarted.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      restarted.server.close(() => resolve()),
    );
    restarted.store.close();
  }
});
