import { randomUUID } from "node:crypto";
import { Problem, INTERESTS, VENUES } from "./types.js";
import * as v from "./validation.js";
import { audit, profile } from "./security.js";
const id = (r) => String(r.id);
const now = () => Date.now();
export class Communities {
    store;
    constructor(store) {
        this.store = store;
    }
    user(uid) {
        const row = this.store.one("SELECT * FROM users WHERE id=? AND deleted_at IS NULL", uid);
        if (!row)
            throw new Problem(401, "account", "La cuenta no está activa.");
        return row;
    }
    community(cid) {
        const c = this.store.one("SELECT * FROM communities WHERE id=? AND archived=0", cid);
        if (!c)
            throw new Problem(404, "community", "Comunidad no disponible.");
        return c;
    }
    member(uid, cid) {
        return this.store.one("SELECT * FROM memberships WHERE community_id=? AND user_id=? AND status='active'", cid, uid);
    }
    moderator(uid, cid) {
        const m = this.member(uid, cid);
        return Boolean(m && (m.role === "owner" || m.role === "moderator"));
    }
    requireModerator(uid, cid) {
        this.community(cid);
        if (!this.moderator(uid, cid))
            throw new Problem(403, "moderator_required", "Esta acción requiere moderación de la comunidad.");
    }
    blocked(a, b) {
        return Boolean(this.store.one("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)", a, b, b, a));
    }
    canRead(uid, c) {
        if (c.privacy === "public")
            return true;
        return Boolean(uid && this.member(uid, id(c)));
    }
    requireRead(uid, c) {
        if (!this.canRead(uid, c))
            throw new Problem(403, "private_community", "La comunidad es privada. Solicita ingreso y espera aprobación.");
    }
    event(eid, uid, allowBlocked = false) {
        const e = this.store.one("SELECT e.*,c.name community_name,c.privacy community_privacy,c.interest,c.zone,c.archived,u.alias host_alias,u.deleted_at host_deleted FROM events e JOIN communities c ON c.id=e.community_id JOIN users u ON u.id=e.host_id WHERE e.id=?", eid);
        if (!e || e.archived || e.host_deleted !== null)
            throw new Problem(404, "event", "Encuentro no disponible.");
        this.requireRead(uid, {
            id: e.community_id,
            privacy: e.community_privacy,
        });
        if (uid && !allowBlocked && this.blocked(uid, String(e.host_id)))
            throw new Problem(403, "blocked", "El bloqueo limita el acceso a encuentros de esta persona.");
        return e;
    }
    notify(uid, kind, text, eid = null) {
        if (!this.store.one("SELECT id FROM users WHERE id=? AND deleted_at IS NULL", uid))
            return;
        this.store.run("INSERT INTO notifications VALUES (?,?,?,?,?,?,NULL)", randomUUID(), uid, kind, text, eid, now());
    }
    notifyModerators(cid, kind, text, eid = null) {
        for (const m of this.store.all("SELECT user_id FROM memberships WHERE community_id=? AND status='active' AND role IN ('owner','moderator')", cid))
            this.notify(String(m.user_id), kind, text, eid);
    }
    ownRegistration(uid, eid) {
        return uid
            ? this.store.one("SELECT status,confirmed_revision FROM registrations WHERE event_id=? AND user_id=?", eid, uid)
            : undefined;
    }
    eventView(e, uid) {
        const registered = this.store.one("SELECT COUNT(*) count FROM registrations WHERE event_id=? AND status='going'", id(e));
        const waiting = this.store.one("SELECT COUNT(*) count FROM registrations WHERE event_id=? AND status='waiting'", id(e));
        const registration = this.ownRegistration(uid, id(e));
        const matching = uid ? this.user(uid) : undefined;
        const ownInterests = matching
            ? JSON.parse(String(matching.interests))
            : [];
        const reasons = [];
        let score = 0;
        if (ownInterests.includes(String(e.interest))) {
            reasons.push(`Coincide con tu interés en ${INTERESTS.find((i) => i.id === e.interest)?.label ?? e.interest}`);
            score += 2;
        }
        if (matching && matching.zone === e.zone) {
            reasons.push(`En tu zona elegida: ${e.zone}`);
            score += 2;
        }
        if (Number(registered.count) < Number(e.capacity) &&
            e.status === "confirmed") {
            reasons.push("Tiene plazas disponibles");
            score++;
        }
        const membership = uid
            ? this.member(uid, String(e.community_id))
            : undefined;
        return {
            id: id(e),
            communityId: String(e.community_id),
            communityName: String(e.community_name),
            communityPrivacy: String(e.community_privacy),
            interest: String(e.interest),
            zone: String(e.zone),
            hostId: String(e.host_id),
            hostAlias: String(e.host_alias),
            title: String(e.title),
            description: String(e.description),
            startsAt: Number(e.starts_at),
            endsAt: Number(e.ends_at),
            capacity: Number(e.capacity),
            going: Number(registered.count),
            waiting: Number(waiting.count),
            available: Math.max(0, Number(e.capacity) - Number(registered.count)),
            venue: VENUES.find((p) => p.id === e.venue_id),
            accessibility: String(e.accessibility),
            status: String(e.status),
            revision: Number(e.revision),
            synthetic: true,
            registration: registration
                ? {
                    status: String(registration.status),
                    needsConfirmation: registration.status === "going" &&
                        Number(registration.confirmed_revision) !== Number(e.revision),
                }
                : null,
            isMember: Boolean(membership),
            canManage: Boolean(uid &&
                (e.host_id === uid || this.moderator(uid, String(e.community_id)))),
            canModerate: Boolean(uid && this.moderator(uid, String(e.community_id))),
            reasons,
            score,
        };
    }
    discover(uid, filters) {
        const q = (filters.get("q") ?? "")
            .trim()
            .toLocaleLowerCase("es")
            .slice(0, 80);
        const interest = filters.get("interest") ?? "";
        const zone = filters.get("zone") ?? "";
        const from = filters.get("from") ? Number(filters.get("from")) : now();
        const to = filters.get("to") ? Number(filters.get("to")) : Infinity;
        if (!Number.isFinite(from) ||
            !(Number.isFinite(to) || to === Infinity) ||
            to < from)
            throw new Problem(422, "filters", "Revisa el intervalo de fechas.");
        const all = this.store.all("SELECT e.*,c.name community_name,c.privacy community_privacy,c.interest,c.zone,c.archived,u.alias host_alias,u.deleted_at host_deleted FROM events e JOIN communities c ON c.id=e.community_id JOIN users u ON u.id=e.host_id WHERE c.archived=0 AND u.deleted_at IS NULL AND e.status IN ('proposed','confirmed') AND e.starts_at>=? ORDER BY e.starts_at,e.id LIMIT 500", from);
        const result = all
            .filter((e) => this.canRead(uid, {
            id: e.community_id,
            privacy: e.community_privacy,
        }) &&
            (!uid || !this.blocked(uid, String(e.host_id))) &&
            (!interest || e.interest === interest) &&
            (!zone || e.zone === zone) &&
            Number(e.starts_at) <= to &&
            (!q ||
                `${e.title} ${e.description} ${e.community_name}`
                    .toLocaleLowerCase("es")
                    .includes(q)))
            .map((e) => this.eventView(e, uid))
            .filter((e) => filters.get("available") !== "1" ||
            (e.status === "confirmed" && e.available > 0));
        result.sort(filters.get("order") === "recommended"
            ? (a, b) => b.score - a.score || a.startsAt - b.startsAt
            : (a, b) => a.startsAt - b.startsAt);
        return result.slice(0, 100);
    }
    listCommunities(uid, filters) {
        const q = (filters.get("q") ?? "").toLocaleLowerCase("es").slice(0, 80);
        return this.store
            .all("SELECT c.*,u.alias owner_alias FROM communities c JOIN users u ON u.id=c.owner_id WHERE c.archived=0 ORDER BY c.name LIMIT 100")
            .filter((c) => (!q ||
            `${c.name} ${c.interest}`.toLocaleLowerCase("es").includes(q)) &&
            (!filters.get("interest") ||
                c.interest === filters.get("interest")) &&
            (!filters.get("zone") || c.zone === filters.get("zone")) &&
            (!uid || !this.blocked(uid, String(c.owner_id))))
            .map((c) => {
            const m = uid
                ? this.store.one("SELECT status,role FROM memberships WHERE community_id=? AND user_id=?", id(c), uid)
                : undefined;
            const readable = this.canRead(uid, c);
            return {
                id: id(c),
                name: String(c.name),
                description: readable
                    ? String(c.description)
                    : "Comunidad privada. Su contenido y encuentros requieren aprobación.",
                interest: String(c.interest),
                zone: String(c.zone),
                privacy: String(c.privacy),
                rules: readable ? String(c.rules) : null,
                membership: m
                    ? { status: String(m.status), role: String(m.role) }
                    : null,
                ownerAlias: readable ? String(c.owner_alias) : null,
                canModerate: Boolean(uid && this.moderator(uid, id(c))),
                synthetic: true,
            };
        });
    }
    createCommunity(uid, input) {
        this.user(uid);
        const o = v.object(input, [
            "name",
            "description",
            "interest",
            "zone",
            "privacy",
            "rules",
        ]);
        const cid = randomUUID();
        this.store.transaction(() => {
            const count = this.store.one("SELECT COUNT(*) count FROM communities WHERE owner_id=? AND archived=0", uid);
            if (Number(count.count) >= 5)
                throw new Problem(409, "community_limit", "El piloto admite hasta cinco comunidades por persona.");
            this.store.run("INSERT INTO communities VALUES (?,?,?,?,?,?,?,?,0,1,?)", cid, v.publicText(o.name, "nombre", 5, 70), v.publicText(o.description, "descripción", 10, 600), v.choice(o.interest, INTERESTS.map((i) => i.id), "un interés"), v.zone(o.zone), v.choice(o.privacy, ["public", "private"], "privacidad"), v.publicText(o.rules, "reglas", 10, 1000), uid, now());
            this.store.run("INSERT INTO memberships VALUES (?,?,'active','owner',?)", cid, uid, now());
            audit(this.store, uid, "community.created", cid);
        });
        return { id: cid };
    }
    joinCommunity(uid, cid) {
        this.user(uid);
        const c = this.community(cid);
        if (this.blocked(uid, String(c.owner_id)))
            throw new Problem(403, "blocked", "No puedes solicitar ingreso mientras exista este bloqueo.");
        return this.store.transaction(() => {
            const old = this.store.one("SELECT * FROM memberships WHERE community_id=? AND user_id=?", cid, uid);
            if (old?.status === "active" || old?.status === "pending")
                return { status: String(old.status), duplicate: true };
            if (old)
                throw new Problem(403, "membership_restricted", "Moderación debe revisar tu ingreso nuevamente.");
            const status = c.privacy === "public" ? "active" : "pending";
            this.store.run("INSERT INTO memberships VALUES (?,?,?,'member',?)", cid, uid, status, now());
            if (status === "pending")
                this.notifyModerators(cid, "membership.request", "Hay una nueva solicitud de ingreso.");
            return { status, duplicate: false };
        });
    }
    membershipRequests(uid, cid) {
        this.requireModerator(uid, cid);
        return this.store
            .all("SELECT m.user_id,u.alias,m.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community_id=? AND m.status='pending' AND u.deleted_at IS NULL ORDER BY m.created_at", cid)
            .map((r) => ({
            userId: String(r.user_id),
            alias: String(r.alias),
            createdAt: Number(r.created_at),
        }));
    }
    decideMembership(uid, cid, target, approved) {
        this.user(uid);
        this.requireModerator(uid, cid);
        this.store.transaction(() => {
            const m = this.store.one("SELECT * FROM memberships WHERE community_id=? AND user_id=?", cid, target);
            if (!m || m.status !== "pending")
                throw new Problem(409, "request", "La solicitud ya no está pendiente.");
            if (this.blocked(uid, target))
                throw new Problem(403, "blocked", "El bloqueo impide aprobar esta solicitud.");
            this.store.run("UPDATE memberships SET status=? WHERE community_id=? AND user_id=?", approved ? "active" : "rejected", cid, target);
            this.notify(target, "membership.result", approved
                ? "Tu ingreso a la comunidad fue aprobado."
                : "Tu solicitud de ingreso no fue aprobada.");
            audit(this.store, uid, approved ? "membership.approved" : "membership.rejected", `${cid}:${target}`);
        });
        return { approved };
    }
    membersForModeration(uid, cid) {
        this.user(uid);
        this.requireModerator(uid, cid);
        return this.store
            .all("SELECT m.user_id,u.alias,m.role,m.status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community_id=? AND m.status='active' AND u.deleted_at IS NULL ORDER BY m.role,u.alias", cid)
            .map((r) => ({
            userId: String(r.user_id),
            alias: String(r.alias),
            role: String(r.role),
        }));
    }
    setModerator(uid, cid, target, makeModerator) {
        this.user(uid);
        const c = this.community(cid);
        if (c.owner_id !== uid)
            throw new Problem(403, "owner_required", "Solo quien organiza la comunidad puede asignar o retirar moderación.");
        return this.store.transaction(() => {
            const m = this.member(target, cid);
            if (!m)
                throw new Problem(404, "member", "La persona debe ser miembro activo.");
            if (m.role === "owner")
                throw new Problem(409, "owner_role", "La organización no cambia mediante esta acción.");
            this.store.run("UPDATE memberships SET role=? WHERE community_id=? AND user_id=?", makeModerator ? "moderator" : "member", cid, target);
            this.notify(target, "membership.role", makeModerator
                ? "Ahora puedes moderar esta comunidad."
                : "Tu rol en la comunidad cambió a miembro.");
            audit(this.store, uid, makeModerator ? "moderator.assigned" : "moderator.revoked", `${cid}:${target}`);
            return { role: makeModerator ? "moderator" : "member" };
        });
    }
    removeMember(uid, cid, target) {
        this.user(uid);
        this.requireModerator(uid, cid);
        const c = this.community(cid);
        return this.store.transaction(() => {
            const m = this.member(target, cid);
            if (!m)
                throw new Problem(404, "member", "No es miembro activo.");
            if (m.role === "owner" || (m.role === "moderator" && c.owner_id !== uid))
                throw new Problem(403, "role_boundary", "No puedes retirar a la organización ni a otra persona moderadora desde este rol.");
            this.store.run("UPDATE memberships SET status='removed' WHERE community_id=? AND user_id=?", cid, target);
            for (const row of this.store.all("SELECT r.event_id FROM registrations r JOIN events e ON e.id=r.event_id WHERE e.community_id=? AND r.user_id=? AND r.status IN ('going','waiting')", cid, target))
                this.cancelInside(target, String(row.event_id));
            for (const e of this.store.all("SELECT id FROM events WHERE community_id=? AND host_id=? AND status IN ('proposed','confirmed')", cid, target)) {
                this.store.run("UPDATE events SET status='cancelled' WHERE id=?", id(e));
                for (const r of this.store.all("SELECT user_id FROM registrations WHERE event_id=? AND status IN ('going','waiting')", id(e)))
                    this.notify(String(r.user_id), "event.cancelled", "El encuentro fue cancelado por una decisión de moderación.", id(e));
                this.store.run("UPDATE registrations SET status='cancelled',updated_at=? WHERE event_id=?", now(), id(e));
            }
            this.notify(target, "membership.removed", "Moderación retiró tu membresía de una comunidad.");
            audit(this.store, uid, "membership.removed", `${cid}:${target}`);
            return { removed: true };
        });
    }
    createEvent(uid, cid, input) {
        this.user(uid);
        this.community(cid);
        if (!this.member(uid, cid))
            throw new Problem(403, "membership", "Necesitas pertenecer a esta comunidad.");
        const data = v.eventInput(input);
        const eid = randomUUID();
        this.store.transaction(() => {
            const count = this.store.one("SELECT COUNT(*) count FROM events WHERE host_id=? AND status IN ('proposed','confirmed')", uid);
            if (Number(count.count) >= 50)
                throw new Problem(409, "limit", "Máximo 50 encuentros abiertos por persona.");
            this.store.run("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,'proposed',1,1,?)", eid, cid, uid, data.title, data.description, data.startsAt, data.endsAt, data.capacity, data.venueId, data.accessibility, now());
            this.notifyModerators(cid, "event.proposed", "Una actividad propuesta espera confirmación de moderación.", eid);
            audit(this.store, uid, "event.proposed", eid);
        });
        return this.eventView(this.event(eid, uid), uid);
    }
    updateEvent(uid, eid, input) {
        this.user(uid);
        const e = this.event(eid, uid);
        if (e.host_id !== uid && !this.moderator(uid, String(e.community_id)))
            throw new Problem(403, "event_owner", "Solo organización o moderación pueden editar.");
        if (!["proposed", "confirmed"].includes(String(e.status)) ||
            Number(e.starts_at) <= now())
            throw new Problem(409, "event_closed", "El encuentro ya no admite cambios.");
        const raw = v.object(input, [
            "title",
            "description",
            "startsAt",
            "endsAt",
            "capacity",
            "venueId",
            "accessibility",
            "revision",
        ]);
        const revision = v.integer(raw.revision, "versión", 1, 1000000000);
        const { revision: ignored, ...fields } = raw;
        const data = v.eventInput(fields);
        return this.store.transaction(() => {
            const latest = this.event(eid, uid);
            if (revision !== Number(latest.revision) ||
                !["proposed", "confirmed"].includes(String(latest.status)))
                throw new Problem(409, "stale_revision", "El encuentro cambió. Abre la versión actual antes de editar.");
            const reserved = Number(this.store.one("SELECT COUNT(*) count FROM registrations WHERE event_id=? AND status='going'", eid).count);
            if (data.capacity < reserved)
                throw new Problem(409, "capacity", "El aforo no puede ser menor que las plazas ya reservadas.");
            this.store.run("UPDATE events SET title=?,description=?,starts_at=?,ends_at=?,capacity=?,venue_id=?,accessibility=?,revision=revision+1 WHERE id=?", data.title, data.description, data.startsAt, data.endsAt, data.capacity, data.venueId, data.accessibility, eid);
            for (const r of this.store.all("SELECT user_id FROM registrations WHERE event_id=? AND status IN ('going','waiting')", eid))
                this.notify(String(r.user_id), "event.changed", "Cambió el encuentro. Revisa los cambios y confirma de nuevo tu participación.", eid);
            audit(this.store, uid, "event.changed", eid);
            this.promote(eid);
            return this.eventView(this.event(eid, uid), uid);
        });
    }
    changeStatus(uid, eid, status) {
        this.user(uid);
        const e = this.event(eid, uid);
        if (status === "cancelled") {
            if (e.host_id !== uid && !this.moderator(uid, String(e.community_id)))
                throw new Problem(403, "moderator_required", "Solo organización o moderación pueden cancelar.");
            if (!["proposed", "confirmed"].includes(String(e.status)))
                throw new Problem(409, "state", "El encuentro ya está cerrado.");
        }
        else {
            this.requireModerator(uid, String(e.community_id));
            if (status === "confirmed" &&
                (e.status !== "proposed" || Number(e.starts_at) <= now()))
                throw new Problem(409, "state", "No se puede confirmar esta propuesta.");
            if (status === "completed" &&
                (e.status !== "confirmed" || Number(e.ends_at) > now()))
                throw new Problem(409, "state", "Solo se puede cerrar como realizada una actividad finalizada.");
        }
        this.store.transaction(() => {
            const changed = this.store.run("UPDATE events SET status=? WHERE id=? AND status=? AND revision=?", status, eid, String(e.status), Number(e.revision));
            if (changed.changes !== 1)
                throw new Problem(409, "stale_revision", "El estado del encuentro cambió. Revisa los detalles actuales.");
            for (const r of this.store.all("SELECT user_id FROM registrations WHERE event_id=? AND status IN ('going','waiting')", eid)) {
                this.notify(String(r.user_id), "event.status", status === "cancelled"
                    ? "El encuentro fue cancelado."
                    : status === "confirmed"
                        ? "La propuesta fue confirmada."
                        : "El encuentro fue marcado como realizado por moderación.", eid);
            }
            if (status === "cancelled")
                this.store.run("UPDATE registrations SET status='cancelled',updated_at=? WHERE event_id=?", now(), eid);
            audit(this.store, uid, `event.${status}`, eid);
        });
        return { status };
    }
    joinEvent(uid, eid, revision) {
        this.user(uid);
        const e = this.event(eid, uid);
        if (!this.member(uid, String(e.community_id)))
            throw new Problem(403, "membership", "Únete a la comunidad antes de inscribirte.");
        if (e.status !== "confirmed" || Number(e.starts_at) <= now())
            throw new Problem(409, "not_confirmed", "Las inscripciones requieren un encuentro confirmado y futuro.");
        if (e.host_id === uid)
            throw new Problem(409, "host", "La persona anfitriona ya coordina el encuentro; las plazas son para participantes.");
        return this.store.transaction(() => {
            const latest = this.event(eid, uid);
            if (revision !== Number(latest.revision))
                throw new Problem(409, "stale_revision", "El encuentro cambió. Vuelve a abrirlo y revisa la versión actual.");
            if (!this.member(uid, String(latest.community_id)))
                throw new Problem(403, "membership", "Tu membresía ya no está activa.");
            if (latest.status !== "confirmed" || Number(latest.starts_at) <= now())
                throw new Problem(409, "closed", "El encuentro ya no admite inscripciones.");
            const previous = this.store.one("SELECT * FROM registrations WHERE event_id=? AND user_id=?", eid, uid);
            if (previous && previous.status !== "cancelled")
                return {
                    status: String(previous.status),
                    duplicate: true,
                    needsConfirmation: Number(previous.confirmed_revision) !== Number(latest.revision),
                };
            const occupied = Number(this.store.one("SELECT COUNT(*) count FROM registrations WHERE event_id=? AND status='going'", eid).count);
            const status = occupied < Number(latest.capacity) ? "going" : "waiting";
            if (previous)
                this.store.run("UPDATE registrations SET status=?,confirmed_revision=?,joined_at=?,updated_at=? WHERE event_id=? AND user_id=?", status, Number(latest.revision), now(), now(), eid, uid);
            else
                this.store.run("INSERT INTO registrations(event_id,user_id,status,confirmed_revision,joined_at,updated_at) VALUES (?,?,?,?,?,?)", eid, uid, status, Number(latest.revision), now(), now());
            this.notify(uid, "registration", status === "going"
                ? "Tu plaza está reservada. Coordina en la conversación del encuentro."
                : "Estás en lista de espera. Te avisaremos si obtienes una plaza.", eid);
            return { status, duplicate: false };
        });
    }
    promote(eid) {
        const e = this.store.one("SELECT * FROM events WHERE id=?", eid);
        if (!e || e.status !== "confirmed" || Number(e.starts_at) <= now())
            return;
        let count = Number(this.store.one("SELECT COUNT(*) count FROM registrations WHERE event_id=? AND status='going'", eid).count);
        for (const r of this.store.all("SELECT r.* FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=? AND r.status='waiting' ORDER BY r.joined_at,r.id", eid)) {
            if (count >= Number(e.capacity))
                break;
            const uid = String(r.user_id);
            if (!this.store.one("SELECT id FROM users WHERE id=? AND deleted_at IS NULL", uid) ||
                !this.member(uid, String(e.community_id)) ||
                this.blocked(uid, String(e.host_id))) {
                this.store.run("UPDATE registrations SET status='cancelled',updated_at=? WHERE id=?", now(), Number(r.id));
                continue;
            }
            this.store.run("UPDATE registrations SET status='going',confirmed_revision=0,updated_at=? WHERE id=?", now(), Number(r.id));
            this.notify(uid, "waitlist.promoted", "Se liberó una plaza para ti. Confirma la versión actual del encuentro antes de escribir.", eid);
            count++;
        }
    }
    cancelInside(uid, eid) {
        const row = this.store.one("SELECT status FROM registrations WHERE event_id=? AND user_id=?", eid, uid);
        if (!row || row.status === "cancelled")
            return { status: "cancelled", duplicate: true };
        this.store.run("UPDATE registrations SET status='cancelled',updated_at=? WHERE event_id=? AND user_id=?", now(), eid, uid);
        this.notify(uid, "registration.cancelled", "Tu inscripción fue cancelada.", eid);
        this.promote(eid);
        return { status: "cancelled", duplicate: false };
    }
    cancel(uid, eid) {
        this.user(uid);
        this.event(eid, uid);
        return this.store.transaction(() => this.cancelInside(uid, eid));
    }
    reconfirm(uid, eid, revision) {
        this.user(uid);
        return this.store.transaction(() => {
            const e = this.event(eid, uid);
            if (revision !== Number(e.revision))
                throw new Problem(409, "stale_revision", "El encuentro cambió. Revisa la versión actual antes de confirmar.");
            const r = this.store.one("SELECT * FROM registrations WHERE event_id=? AND user_id=? AND status='going'", eid, uid);
            if (!r || e.status !== "confirmed" || Number(e.starts_at) <= now())
                throw new Problem(409, "registration", "No hay una plaza futura que confirmar.");
            if (!this.member(uid, String(e.community_id)))
                throw new Problem(403, "membership", "Tu membresía ya no está activa.");
            this.store.run("UPDATE registrations SET confirmed_revision=?,updated_at=? WHERE event_id=? AND user_id=?", Number(e.revision), now(), eid, uid);
            return { confirmedRevision: Number(e.revision) };
        });
    }
    conversationAllowed(uid, e, write = false) {
        const mod = this.moderator(uid, String(e.community_id));
        const registration = this.ownRegistration(uid, id(e));
        if (!mod && e.host_id !== uid && registration?.status !== "going")
            throw new Problem(403, "conversation", "La conversación es para participantes con plaza, organización y moderación.");
        if (!this.member(uid, String(e.community_id)))
            throw new Problem(403, "membership", "Tu membresía no está activa.");
        if (write && (e.status !== "confirmed" || Number(e.ends_at) < now()))
            throw new Problem(409, "conversation_closed", "La conversación no admite nuevos mensajes.");
        if (write &&
            !mod &&
            e.host_id !== uid &&
            Number(registration?.confirmed_revision) !== Number(e.revision))
            throw new Problem(409, "reconfirm", "Revisa los cambios y confirma tu participación antes de escribir.");
    }
    messages(uid, eid) {
        const e = this.event(eid, uid);
        this.conversationAllowed(uid, e);
        return this.store
            .all("SELECT m.id,m.user_id,m.body,m.created_at,u.alias FROM messages m JOIN users u ON u.id=m.user_id WHERE m.event_id=? AND m.hidden_at IS NULL AND m.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY m.created_at DESC,m.id LIMIT 100", eid)
            .filter((m) => !this.blocked(uid, String(m.user_id)))
            .reverse()
            .map((m) => ({
            id: id(m),
            userId: String(m.user_id),
            alias: String(m.alias),
            body: String(m.body),
            createdAt: Number(m.created_at),
            own: m.user_id === uid,
        }));
    }
    postMessage(uid, eid, input) {
        this.user(uid);
        const e = this.event(eid, uid);
        this.conversationAllowed(uid, e, true);
        const o = v.object(input, ["body"]);
        const body = v.publicText(o.body, "mensaje", 1, 1000);
        const mid = randomUUID();
        this.store.run("INSERT INTO messages VALUES (?,?,?,?,?,NULL,NULL)", mid, eid, uid, body, now());
        return { id: mid };
    }
    hideMessage(uid, mid) {
        this.user(uid);
        const m = this.store.one("SELECT m.*,e.community_id FROM messages m JOIN events e ON e.id=m.event_id WHERE m.id=?", mid);
        if (!m)
            throw new Problem(404, "message", "Mensaje no encontrado.");
        this.requireModerator(uid, String(m.community_id));
        this.store.transaction(() => {
            this.store.run("UPDATE messages SET hidden_at=? WHERE id=?", now(), mid);
            audit(this.store, uid, "message.hidden", mid);
        });
        return { hidden: true };
    }
    block(uid, target) {
        this.user(uid);
        if (target === uid)
            throw new Problem(422, "self_block", "No puedes bloquearte.");
        this.user(target);
        this.store.transaction(() => {
            this.store.run("INSERT OR IGNORE INTO blocks VALUES (?,?,?)", uid, target, now());
            for (const e of this.store.all("SELECT id,host_id FROM events WHERE host_id IN (?,?) AND status='confirmed' AND starts_at>?", uid, target, now())) {
                const participant = e.host_id === uid ? target : uid;
                this.cancelInside(participant, id(e));
            }
            audit(this.store, uid, "user.blocked", target);
        });
        return { blocked: true };
    }
    unblock(uid, target) {
        this.user(uid);
        this.store.run("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?", uid, target);
        return { blocked: false };
    }
    report(uid, input) {
        this.user(uid);
        const o = v.object(input, [
            "eventId",
            "subjectUserId",
            "messageId",
            "reason",
        ]);
        const eid = v.text(o.eventId, "encuentro", 1, 80);
        const e = this.event(eid, uid, true);
        if (!this.member(uid, String(e.community_id)))
            throw new Problem(403, "membership", "Solo miembros pueden reportar contenido de esta comunidad.");
        const target = v.text(o.subjectUserId, "persona", 1, 80);
        if (target === uid)
            throw new Problem(422, "self_report", "El reporte debe referirse a otra persona.");
        this.user(target);
        let evidence = {
            type: "user",
            eventId: eid,
            subjectUserId: target,
            message: null,
        };
        const mid = o.messageId ? v.text(o.messageId, "mensaje", 1, 80) : null;
        if (mid) {
            this.conversationAllowed(uid, e);
            const m = this.store.one("SELECT * FROM messages WHERE id=? AND event_id=? AND user_id=? AND deleted_at IS NULL", mid, eid, target);
            if (!m)
                throw new Problem(404, "message", "No se encontró el mensaje señalado.");
            evidence = { ...evidence, type: "message", message: String(m.body) };
        }
        else if (e.host_id !== target &&
            !this.store.one("SELECT 1 FROM registrations WHERE event_id=? AND user_id=? AND status='going'", eid, target))
            throw new Problem(422, "report_scope", "El reporte debe referirse a organización o participantes del encuentro.");
        const reason = v.publicText(o.reason, "motivo", 5, 800);
        const rid = randomUUID();
        this.store.transaction(() => {
            this.store.run("INSERT INTO reports VALUES (?,?,?,?,?,?,?,'open',NULL,NULL,?,NULL)", rid, uid, String(e.community_id), target, mid, reason, JSON.stringify(evidence), now());
            this.notifyModerators(String(e.community_id), "report.new", "Hay un nuevo reporte de la comunidad.");
            audit(this.store, uid, "report.created", rid);
        });
        return { id: rid, status: "open" };
    }
    myReports(uid) {
        return this.store.all("SELECT id,status,created_at,resolved_at FROM reports WHERE reporter_id=? ORDER BY created_at DESC LIMIT 100", uid);
    }
    reportsForModerator(uid) {
        return this.store.all("SELECT r.*,c.name community_name FROM reports r JOIN communities c ON c.id=r.community_id JOIN memberships m ON m.community_id=r.community_id WHERE m.user_id=? AND m.status='active' AND m.role IN ('owner','moderator') AND r.subject_user_id!=? AND r.reporter_id!=? ORDER BY r.created_at DESC LIMIT 100", uid, uid, uid);
    }
    resolveReport(uid, rid, input) {
        this.user(uid);
        const r = this.store.one("SELECT * FROM reports WHERE id=?", rid);
        if (!r)
            throw new Problem(404, "report", "Reporte no encontrado.");
        this.requireModerator(uid, String(r.community_id));
        if (r.subject_user_id === uid || r.reporter_id === uid)
            throw new Problem(403, "conflict", "Otra persona moderadora debe revisar este caso.");
        const o = v.object(input, ["status", "resolution"]);
        const status = v.choice(o.status, ["resolved", "dismissed"], "resolución");
        const resolution = v.publicText(o.resolution, "resolución", 5, 800);
        this.store.transaction(() => {
            if (r.status !== "open")
                throw new Problem(409, "resolved", "El reporte ya fue cerrado.");
            const updated = this.store.run("UPDATE reports SET status=?,resolution=?,resolver_id=?,resolved_at=? WHERE id=? AND status='open'", status, resolution, uid, now(), rid);
            if (updated.changes !== 1)
                throw new Problem(409, "resolved", "El reporte ya fue cerrado por otra revisión.");
            this.notify(String(r.reporter_id), "report.result", "Tu reporte fue revisado. Consulta su estado en tu cuenta.");
            audit(this.store, uid, `report.${status}`, rid);
        });
        return { status };
    }
    review(uid, eid, input) {
        this.user(uid);
        const e = this.event(eid, uid);
        const r = this.ownRegistration(uid, eid);
        if (e.status !== "completed" ||
            Number(e.ends_at) > now() ||
            r?.status !== "going")
            throw new Problem(403, "review_eligibility", "Las opiniones requieren una inscripción registrada en una actividad marcada como realizada. La asistencia no se verifica.");
        const o = v.object(input, ["rating", "body"]);
        try {
            this.store.run("INSERT INTO reviews VALUES (?,?,?,?,?,'registration-only',?)", randomUUID(), eid, uid, v.integer(o.rating, "valoración", 1, 5), v.publicText(o.body, "opinión", 5, 500), now());
        }
        catch (error) {
            if (this.store.one("SELECT id FROM reviews WHERE event_id=? AND user_id=?", eid, uid))
                throw new Problem(409, "review_duplicate", "Ya publicaste una opinión para esta actividad.");
            throw error;
        }
        return {
            origin: "registration-only",
            verification: "Inscripción registrada; asistencia no verificada.",
        };
    }
    reviews(uid, eid) {
        this.event(eid, uid);
        return this.store
            .all("SELECT r.id,r.user_id,r.rating,r.body,r.origin,r.created_at,u.alias FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.event_id=? AND u.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 50", eid)
            .filter((r) => !uid || !this.blocked(uid, String(r.user_id)))
            .map((r) => ({
            id: id(r),
            alias: String(r.alias),
            rating: Number(r.rating),
            body: String(r.body),
            origin: "Inscripción registrada; asistencia no verificada",
            createdAt: Number(r.created_at),
        }));
    }
    notifications(uid) {
        return this.store.all("SELECT id,kind,text,event_id,created_at,read_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100", uid);
    }
    readNotification(uid, nid) {
        this.user(uid);
        const r = this.store.run("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?", now(), nid, uid);
        if (!r.changes)
            throw new Problem(404, "notification", "Notificación no encontrada.");
        return { read: true };
    }
    updateProfile(uid, input) {
        this.user(uid);
        const o = v.object(input, ["bio", "zone", "interests"]);
        this.store.run("UPDATE users SET bio=?,zone=?,interests=? WHERE id=?", v.publicText(o.bio, "presentación", 0, 200), v.zone(o.zone), JSON.stringify(v.interests(o.interests)), uid);
        return profile(this.user(uid));
    }
    deleteAccount(uid) {
        return this.store.transaction(() => {
            for (const e of this.store.all("SELECT id FROM events WHERE host_id=? AND status IN ('proposed','confirmed')", uid)) {
                this.store.run("UPDATE events SET status='cancelled' WHERE id=?", id(e));
                for (const r of this.store.all("SELECT user_id FROM registrations WHERE event_id=? AND status IN ('going','waiting')", id(e)))
                    this.notify(String(r.user_id), "event.cancelled", "El encuentro fue cancelado por cierre de la cuenta organizadora.", id(e));
                this.store.run("UPDATE registrations SET status='cancelled',updated_at=? WHERE event_id=?", now(), id(e));
            }
            for (const r of this.store.all("SELECT event_id FROM registrations WHERE user_id=? AND status IN ('going','waiting')", uid))
                this.cancelInside(uid, String(r.event_id));
            this.store.run("UPDATE communities SET archived=1 WHERE owner_id=?", uid);
            for (const c of this.store.all("SELECT id FROM communities WHERE owner_id=?", uid))
                for (const e of this.store.all("SELECT id FROM events WHERE community_id=? AND status IN ('proposed','confirmed')", id(c))) {
                    this.store.run("UPDATE events SET status='cancelled' WHERE id=?", id(e));
                    for (const r of this.store.all("SELECT user_id FROM registrations WHERE event_id=? AND status IN ('going','waiting')", id(e)))
                        this.notify(String(r.user_id), "event.cancelled", "La comunidad fue archivada y este encuentro se canceló.", id(e));
                    this.store.run("UPDATE registrations SET status='cancelled',updated_at=? WHERE event_id=?", now(), id(e));
                }
            this.store.run("UPDATE messages SET body='[eliminado]',deleted_at=? WHERE user_id=?", now(), uid);
            this.store.run("DELETE FROM reviews WHERE user_id=?", uid);
            this.store.run("DELETE FROM notifications WHERE user_id=?", uid);
            this.store.run("DELETE FROM sessions WHERE user_id=?", uid);
            this.store.run("UPDATE memberships SET status='removed' WHERE user_id=?", uid);
            this.store.run("DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?", uid, uid);
            this.store.run("UPDATE users SET alias='Cuenta eliminada',alias_key=?,bio='',zone='',interests='[]',password_hash='',deleted_at=? WHERE id=?", `deleted-${randomUUID()}`, now(), uid);
            audit(this.store, null, "account.deleted", uid);
            return {
                deleted: true,
                reportsRetention: "Reportes abiertos: máximo 180 días; cerrados: 90 días desde resolución. Validación legal pendiente.",
            };
        });
    }
}
