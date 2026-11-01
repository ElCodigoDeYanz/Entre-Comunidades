import { createServer, } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { Store } from "./database.js";
import { Communities } from "./service.js";
import { seed } from "./seed.js";
import { INTERESTS, ZONES, VENUES, LIMITS, POLICY_VERSION, Problem, } from "./types.js";
import { authenticate, need, checkCsrf, checkOrigin, rateLimit, rateKey, register, login, newSession, profile, verifyPassword, } from "./security.js";
import * as v from "./validation.js";
async function readJson(req) {
    if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
        "application/json")
        throw new Problem(415, "content_type", "Envía JSON.");
    const chunks = [];
    let length = 0;
    for await (const raw of req) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        length += chunk.length;
        if (length > LIMITS.body)
            throw new Problem(413, "body_limit", "La solicitud supera 32 KiB.");
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        throw new Problem(400, "invalid_json", "No se pudo leer el JSON.");
    }
}
export async function buildApplication(options) {
    const store = new Store(options.dbPath);
    if (options.demo)
        await seed(store);
    const service = new Communities(store);
    store.run("INSERT OR IGNORE INTO settings VALUES ('rate_salt',?)", randomBytes(32).toString("hex"));
    const pepper = String(store.one("SELECT value FROM settings WHERE key='rate_salt'").value);
    const server = createServer(async (req, res) => {
        const requestId = randomUUID();
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Permissions-Policy", "geolocation=(),camera=(),microphone=()");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
        const json = (body, status = 200) => {
            res.writeHead(status, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(body));
        };
        try {
            const url = new URL(req.url ?? "/", "http://local");
            const path = url.pathname;
            const method = req.method ?? "GET";
            const auth = authenticate(store, req);
            const uid = auth ? String(auth.user.id) : null;
            const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
            if (mutating) {
                checkOrigin(req, options.publicOrigin);
                const exemption = [
                    "/api/register",
                    "/api/login",
                    "/api/demo-login",
                ].includes(path);
                if (!exemption) {
                    need(auth);
                    checkCsrf(req, auth);
                }
                rateLimit(store, rateKey(pepper, req, "mutations"), 120, 60000);
            }
            if (method === "OPTIONS")
                throw new Problem(405, "method", "No se admite acceso desde otros orígenes.");
            if (path === "/api/catalog" && method === "GET") {
                json({
                    interests: INTERESTS,
                    zones: ZONES,
                    venues: VENUES,
                    policyVersion: POLICY_VERSION,
                    demo: options.demo,
                    integrations: {
                        email: false,
                        sms: false,
                        geolocation: false,
                        map: false,
                    },
                    ageVerification: "self-declaration-only",
                });
                return;
            }
            if (path === "/api/session" && method === "GET") {
                json(auth
                    ? { user: profile(auth.user), csrf: auth.csrf, demo: options.demo }
                    : { user: null, csrf: null, demo: options.demo });
                return;
            }
            if (path === "/api/register" && method === "POST") {
                rateLimit(store, rateKey(pepper, req, "register"), 5, 3600000);
                const user = await register(store, await readJson(req));
                const session = newSession(store, user, options.secureCookie);
                res.setHeader("Set-Cookie", session.cookie);
                json(session.body, 201);
                return;
            }
            if (path === "/api/login" && method === "POST") {
                rateLimit(store, rateKey(pepper, req, "login"), 10, 15 * 60000);
                const user = await login(store, await readJson(req));
                const session = newSession(store, user, options.secureCookie);
                res.setHeader("Set-Cookie", session.cookie);
                json(session.body);
                return;
            }
            if (path === "/api/demo-login" && method === "POST") {
                if (!options.demo)
                    throw new Problem(404, "demo_disabled", "La entrada demo está desactivada.");
                rateLimit(store, rateKey(pepper, req, "demo-login"), 15, 60000);
                const o = v.object(await readJson(req), ["persona"]);
                const persona = v.choice(o.persona, ["lucia", "mateo", "nora", "ines"], "una persona ficticia");
                const user = service.user(`demo-${persona}`);
                const session = newSession(store, user, options.secureCookie);
                res.setHeader("Set-Cookie", session.cookie);
                json(session.body);
                return;
            }
            if (path === "/api/logout" && method === "POST") {
                store.run("DELETE FROM sessions WHERE token_hash=?", need(auth).tokenHash);
                res.setHeader("Set-Cookie", `entre_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${options.secureCookie ? "; Secure" : ""}`);
                json({ loggedOut: true });
                return;
            }
            if (path === "/api/profile" && method === "PATCH") {
                json({
                    user: service.updateProfile(String(need(auth).user.id), await readJson(req)),
                });
                return;
            }
            if (path === "/api/account/export" && method === "GET") {
                const user = need(auth).user;
                const me = String(user.id);
                json({
                    profile: profile(user),
                    consents: {
                        adultDeclarationAt: user.age_declared_at,
                        policyVersion: user.policy_version,
                        consentAt: user.consent_at,
                    },
                    memberships: store.all("SELECT community_id,status,role,created_at FROM memberships WHERE user_id=?", me),
                    registrations: store.all("SELECT event_id,status,confirmed_revision,joined_at FROM registrations WHERE user_id=?", me),
                    messages: store.all("SELECT event_id,body,created_at FROM messages WHERE user_id=? AND deleted_at IS NULL", me),
                    reviews: store.all("SELECT event_id,rating,body,created_at FROM reviews WHERE user_id=?", me),
                    reports: service.myReports(me),
                    notifications: service.notifications(me),
                });
                return;
            }
            if (path === "/api/account" && method === "DELETE") {
                const me = need(auth).user;
                const o = v.object(await readJson(req), ["password", "confirm"]);
                if (o.confirm !== "ELIMINAR")
                    throw new Problem(422, "confirmation", "Escribe ELIMINAR para confirmar.");
                const pass = v.password(o.password);
                if (!(await verifyPassword(pass, String(me.password_hash))))
                    throw new Problem(401, "password", "Frase de acceso incorrecta.");
                json(service.deleteAccount(String(me.id)));
                return;
            }
            if (path === "/api/communities" && method === "GET") {
                json(service.listCommunities(uid, url.searchParams));
                return;
            }
            if (path === "/api/communities" && method === "POST") {
                json(service.createCommunity(String(need(auth).user.id), await readJson(req)), 201);
                return;
            }
            let match = path.match(/^\/api\/communities\/([^/]+)\/join$/);
            if (match && method === "POST") {
                json(service.joinCommunity(String(need(auth).user.id), match[1]));
                return;
            }
            match = path.match(/^\/api\/communities\/([^/]+)\/requests$/);
            if (match && method === "GET") {
                json(service.membershipRequests(String(need(auth).user.id), match[1]));
                return;
            }
            match = path.match(/^\/api\/communities\/([^/]+)\/requests\/([^/]+)$/);
            if (match && method === "PATCH") {
                const o = v.object(await readJson(req), ["approve"]);
                json(service.decideMembership(String(need(auth).user.id), match[1], match[2], v.bool(o.approve, "aprobación")));
                return;
            }
            match = path.match(/^\/api\/communities\/([^/]+)\/members$/);
            if (match && method === "GET") {
                json(service.membersForModeration(String(need(auth).user.id), match[1]));
                return;
            }
            match = path.match(/^\/api\/communities\/([^/]+)\/members\/([^/]+)\/role$/);
            if (match && method === "PATCH") {
                const o = v.object(await readJson(req), ["moderator"]);
                json(service.setModerator(String(need(auth).user.id), match[1], match[2], v.bool(o.moderator, "rol de moderación")));
                return;
            }
            match = path.match(/^\/api\/communities\/([^/]+)\/members\/([^/]+)\/remove$/);
            if (match && method === "POST") {
                json(service.removeMember(String(need(auth).user.id), match[1], match[2]));
                return;
            }
            match = path.match(/^\/api\/communities\/([^/]+)\/events$/);
            if (match && method === "POST") {
                json(service.createEvent(String(need(auth).user.id), match[1], await readJson(req)), 201);
                return;
            }
            if (path === "/api/events" && method === "GET") {
                json(service.discover(uid, url.searchParams));
                return;
            }
            match = path.match(/^\/api\/events\/([^/]+)$/);
            if (match && method === "GET") {
                json(service.eventView(service.event(match[1], uid), uid));
                return;
            }
            if (match && method === "PATCH") {
                json(service.updateEvent(String(need(auth).user.id), match[1], await readJson(req)));
                return;
            }
            match = path.match(/^\/api\/events\/([^/]+)\/status$/);
            if (match && method === "PATCH") {
                const o = v.object(await readJson(req), ["status"]);
                json(service.changeStatus(String(need(auth).user.id), match[1], v.choice(o.status, ["confirmed", "cancelled", "completed"], "estado")));
                return;
            }
            match = path.match(/^\/api\/events\/([^/]+)\/registration$/);
            if (match && method === "POST") {
                const o = v.object(await readJson(req), ["revision"]);
                json(service.joinEvent(String(need(auth).user.id), match[1], v.integer(o.revision, "versión", 1, 1000000000)));
                return;
            }
            if (match && method === "DELETE") {
                json(service.cancel(String(need(auth).user.id), match[1]));
                return;
            }
            match = path.match(/^\/api\/events\/([^/]+)\/reconfirm$/);
            if (match && method === "POST") {
                const o = v.object(await readJson(req), ["revision"]);
                json(service.reconfirm(String(need(auth).user.id), match[1], v.integer(o.revision, "versión", 1, 1000000000)));
                return;
            }
            match = path.match(/^\/api\/events\/([^/]+)\/messages$/);
            if (match && method === "GET") {
                json(service.messages(String(need(auth).user.id), match[1]));
                return;
            }
            if (match && method === "POST") {
                const me = String(need(auth).user.id);
                rateLimit(store, `message:${me}`, 20, 60000);
                json(service.postMessage(me, match[1], await readJson(req)), 201);
                return;
            }
            match = path.match(/^\/api\/messages\/([^/]+)\/hide$/);
            if (match && method === "POST") {
                json(service.hideMessage(String(need(auth).user.id), match[1]));
                return;
            }
            match = path.match(/^\/api\/events\/([^/]+)\/reviews$/);
            if (match && method === "GET") {
                json(service.reviews(uid, match[1]));
                return;
            }
            if (match && method === "POST") {
                json(service.review(String(need(auth).user.id), match[1], await readJson(req)), 201);
                return;
            }
            if (path === "/api/notifications" && method === "GET") {
                json(service.notifications(String(need(auth).user.id)));
                return;
            }
            match = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
            if (match && method === "POST") {
                json(service.readNotification(String(need(auth).user.id), match[1]));
                return;
            }
            if (path === "/api/blocks" && method === "GET") {
                json(store.all("SELECT b.blocked_id,u.alias FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=?", String(need(auth).user.id)));
                return;
            }
            match = path.match(/^\/api\/blocks\/([^/]+)$/);
            if (match && method === "POST") {
                json(service.block(String(need(auth).user.id), match[1]));
                return;
            }
            if (match && method === "DELETE") {
                json(service.unblock(String(need(auth).user.id), match[1]));
                return;
            }
            if (path === "/api/reports" && method === "POST") {
                const me = String(need(auth).user.id);
                rateLimit(store, `report:${me}`, 10, 86400000);
                json(service.report(me, await readJson(req)), 201);
                return;
            }
            if (path === "/api/reports/mine" && method === "GET") {
                json(service.myReports(String(need(auth).user.id)));
                return;
            }
            if (path === "/api/moderation/reports" && method === "GET") {
                json(service.reportsForModerator(String(need(auth).user.id)));
                return;
            }
            match = path.match(/^\/api\/moderation\/reports\/([^/]+)$/);
            if (match && method === "PATCH") {
                json(service.resolveReport(String(need(auth).user.id), match[1], await readJson(req)));
                return;
            }
            if (path === "/api/my-events" && method === "GET") {
                const me = String(need(auth).user.id);
                const result = [];
                for (const row of store.all("SELECT DISTINCT e.id FROM events e LEFT JOIN registrations r ON r.event_id=e.id WHERE (r.user_id=? AND r.status IN ('going','waiting')) OR e.host_id=? ORDER BY e.starts_at", me, me)) {
                    try {
                        result.push(service.eventView(service.event(String(row.id), me), me));
                    }
                    catch (error) {
                        if (!(error instanceof Problem))
                            throw error;
                    }
                }
                json(result);
                return;
            }
            if (path.startsWith("/api/"))
                throw new Problem(404, "route", "Ruta no encontrada.");
            if (!["GET", "HEAD"].includes(method))
                throw new Problem(405, "method", "Método no admitido.");
            const staticFiles = {
                "/": ["index.html", "text/html; charset=utf-8"],
                "/index.html": ["index.html", "text/html; charset=utf-8"],
                "/app.js": ["app.js", "text/javascript; charset=utf-8"],
                "/style.css": ["style.css", "text/css; charset=utf-8"],
                "/privacy": ["privacy.html", "text/html; charset=utf-8"],
                "/favicon.svg": ["favicon.svg", "image/svg+xml"],
            };
            const file = staticFiles[path];
            if (!file || !existsSync(join(options.publicDir, file[0])))
                throw new Problem(404, "file", "Página no encontrada.");
            res.writeHead(200, {
                "Content-Type": file[1],
                "Cache-Control": "no-cache",
            });
            res.end(method === "HEAD"
                ? undefined
                : readFileSync(join(options.publicDir, file[0])));
        }
        catch (error) {
            if (res.headersSent) {
                res.end();
                return;
            }
            if (error instanceof Problem) {
                if (error.status === 429)
                    res.setHeader("Retry-After", "60");
                json({ error: error.code, message: error.message, requestId }, error.status);
            }
            else {
                console.error(JSON.stringify({
                    event: "request_failed",
                    requestId,
                    errorType: error instanceof Error ? error.name : "unknown",
                }));
                json({
                    error: "internal",
                    message: "No se pudo completar la acción. Intenta de nuevo.",
                    requestId,
                }, 500);
            }
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.maxHeadersCount = 40;
    return { server, store, service };
}
