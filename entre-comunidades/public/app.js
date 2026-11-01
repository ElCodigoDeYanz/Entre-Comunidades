let session = { user: null, csrf: null, demo: true };
let catalog;
let communities = [];
let view = "explore";
let chosenInterest = "";
let loadGeneration = 0;
let toastTimer;
const el = (id) => {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Elemento ausente: ${id}`);
    return node;
};
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
const dialog = el("modal");
const date = (time, withTime = true) => new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
}).format(time);
const localTime = (time) => new Date(time - 5 * 3600000).toISOString().slice(0, 16);
const parseTime = (value) => new Date(value + "-05:00").getTime();
const statuses = {
    confirmed: "Confirmado",
    proposed: "Propuesta",
    cancelled: "Cancelado",
    completed: "Realizado",
};
const selectedInterest = (id) => catalog.interests.find((i) => i.id === id);
function message(text, error = false) {
    if (dialog.open) {
        let box = document.getElementById("modal-notice");
        if (!box) {
            box = document.createElement("div");
            box.id = "modal-notice";
            box.setAttribute("role", "status");
            box.setAttribute("aria-live", "polite");
            el("modal-content").prepend(box);
        }
        box.className = error ? "inline-error" : "detail-message";
        box.textContent = text;
        return;
    }
    const node = el("toast");
    node.textContent = text;
    node.classList.toggle("error", error);
    node.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        node.hidden = true;
    }, 6500);
}
function showError(error) {
    message(error instanceof Error
        ? error.message
        : "No se pudo completar la acción. Intenta de nuevo.", true);
}
async function api(path, method = "GET", body) {
    const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(method !== "GET" && session.csrf
                ? { "X-CSRF-Token": session.csrf }
                : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) {
        const text = typeof result === "object" && result !== null && "message" in result
            ? String(result.message)
            : "La solicitud no pudo completarse.";
        throw new Error(text);
    }
    return result;
}
async function busy(button, action) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
        await action();
    }
    catch (error) {
        showError(error);
    }
    finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
    }
}
function openModal(title, eyebrow, html) {
    el("modal-title").textContent = title;
    el("modal-eyebrow").textContent = eyebrow;
    el("modal-content").innerHTML = `<div class="modal-body">${html}</div>`;
    if (!dialog.open)
        dialog.showModal();
    dialog.scrollTop = 0;
}
const options = (list, selected = "", emptyLabel) => (emptyLabel !== undefined
    ? `<option value="">${esc(emptyLabel)}</option>`
    : "") +
    list
        .map((s) => `<option ${s === selected ? "selected" : ""} value="${esc(s)}">${esc(s)}</option>`)
        .join("");
const interestOptions = (selected = []) => `<div class="interest-options">${catalog.interests.map((i) => `<label><input type="checkbox" name="interests" value="${i.id}" ${selected.includes(i.id) ? "checked" : ""}> ${i.symbol} ${esc(i.label)}</label>`).join("")}</div>`;
const formInterests = (form) => Array.from(form.querySelectorAll("input[name=interests]:checked")).map((i) => i.value);
function illustration(interest) {
    const start = '<svg viewBox="0 0 200 150" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">';
    const end = "</svg>";
    const drawings = {
        arte: '<circle cx="81" cy="73" r="49" fill="#e3ac8b"/><path d="M92 18h59v101H92z" fill="#faf5e9" transform="rotate(10 122 69)"/><path d="m105 88 20-44 17 26-18 30z" fill="#a896bc"/><path d="m52 119 41-71 8 5-39 72z" fill="#9b789c"/><path d="m53 118 2 14 9-8" fill="#b18b60"/>',
        programacion: '<rect x="37" y="25" width="125" height="85" rx="9" fill="#a18cba"/><rect x="46" y="33" width="107" height="67" rx="4" fill="#f8f1ea"/><path d="m78 54-14 14 14 14m42-28 14 14-14 14m-14-35-12 42" stroke="#8d75ad" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 111h151l-11 15H37z" fill="#b9a5ca"/><circle cx="169" cy="29" r="11" fill="#d8b3a0"/>',
        futbol: '<circle cx="100" cy="76" r="49" fill="#f7f4df"/><path d="m100 54 20 15-8 23H88l-8-23z" fill="#8d9f86"/><path d="m100 54-4-26m24 41 27-1m-35 24 14 25m-38-25-15 24m7-47-28-4" stroke="#8d9f86" stroke-width="6"/><path d="m139 43 10 25-14 20m-61-49 22-11 24 6m-68 31 6 27 15 24m53 1 9-29m-62 28 26 9 27-8" stroke="#8d9f86" stroke-width="4"/><circle cx="33" cy="33" r="8" fill="#a5b597"/>',
        fotografia: '<circle cx="108" cy="74" r="52" fill="#e3d3a2"/><path d="M47 50h29l8-13h37l9 13h24v61H47z" fill="#ab958d"/><rect x="52" y="57" width="96" height="48" rx="5" fill="#f6ecda"/><circle cx="102" cy="80" r="27" fill="#b2a9bd"/><circle cx="102" cy="80" r="18" fill="#e8e0ee"/><circle cx="102" cy="80" r="10" fill="#9f8faa"/><path d="m158 37 8-9m-9 16 14 1" stroke="#af9c75" stroke-width="3" stroke-linecap="round"/>',
        lectura: '<circle cx="99" cy="75" r="54" fill="#ddb9c8"/><path d="M44 37c24-8 39-6 57 7 17-13 37-15 58-7v80c-22-6-40-6-58 7-18-13-35-13-57-7z" fill="#fcf6e7"/><path d="M101 44v80M54 57c14-3 23-1 35 5m-35 9c14-3 23-1 35 5m-35 9c14-3 23-1 35 5m25-28c11-6 22-8 35-5m-35 19c11-6 22-8 35-5m-35 19c11-6 22-8 35-5" stroke="#bd9baa" stroke-width="3" stroke-linecap="round"/>',
        naturaleza: '<circle cx="102" cy="74" r="51" fill="#bccdb6"/><path d="M78 99h49l-8 32H86z" fill="#c6977d"/><path d="M101 104V41m0 42C71 82 60 70 59 54c23-2 40 8 42 29m0-14c26-3 41-13 42-32-22-3-39 13-42 32m0-15C83 50 80 34 86 20c18 7 23 18 15 34" stroke="#748b6b" stroke-width="4" stroke-linejoin="round" fill="#8fa585"/>',
    };
    return start + (drawings[interest] ?? drawings.arte) + end;
}
function eventCard(e) {
    const interest = selectedInterest(e.interest);
    const registration = e.registration?.status === "going"
        ? e.registration.needsConfirmation
            ? "Por reconfirmar"
            : "Tienes una plaza"
        : e.registration?.status === "waiting"
            ? "En lista de espera"
            : null;
    return `<article class="event-card"><div class="poster ${esc(interest?.color ?? "lilac")}"><span class="poster-tag">${esc(interest?.label ?? e.interest)}</span>${illustration(e.interest)}<span class="poster-stamp">ENCUENTRO DE DEMOSTRACIÓN</span></div><div class="card-body"><div class="card-date">${esc(date(e.startsAt, false))}<span class="status-label ${esc(e.status)}">${esc(statuses[e.status] ?? e.status)}</span></div><h3>${esc(e.title)}</h3><p class="card-location">${esc(e.zone)} <span>·</span> ${esc(date(e.startsAt).split(",").slice(-1).join(","))}<br>${esc(e.venue.label)}</p><div class="card-community"><span class="mini-avatar">${esc(e.hostAlias[0] ?? "E")}</span> ${esc(e.communityName)} ${e.communityPrivacy === "private" ? "· privada" : ""}</div>${el("order").value === "recommended" && e.reasons.length ? `<div class="reasons">${e.reasons.map(esc).join(" · ")}</div>` : ""}<div class="card-bottom"><span class="capacity">${registration ? `<strong>${registration}</strong>` : e.status === "proposed" ? "Aún sin inscripciones" : e.status === "completed" ? "Opiniones con inscripción registrada" : `<strong>${e.available} plazas</strong> de ${e.capacity}`}</span><button type="button" data-event="${e.id}">Ver encuentro ↗</button></div></div></article>`;
}
function communityCard(c) {
    const i = selectedInterest(c.interest);
    return `<article class="community-card"><span class="community-symbol">${esc(i?.symbol ?? "✳")}</span><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><div class="community-meta">${esc(c.zone)} · ${c.privacy === "private" ? "Ingreso con aprobación" : "Comunidad abierta"}</div>${c.rules ? `<details><summary>Reglas de la comunidad</summary><p>${esc(c.rules)}</p></details>` : ""}<div class="card-bottom">${c.membership?.status === "active" ? `<span class="badge">${c.membership.role === "owner" ? "Organizas esta comunidad" : c.membership.role === "moderator" ? "Moderación" : "Ya eres parte"}</span>` : c.membership?.status === "pending" ? '<span class="badge">Solicitud pendiente</span>' : `<button class="button soft" data-join-community="${c.id}">${c.privacy === "private" ? "Solicitar ingreso" : "Unirme a la comunidad"} ↗</button>`}${c.canModerate ? `<button data-community-mod="${c.id}">Gestionar ↗</button>` : ""}</div>${c.membership?.status === "active" ? `<button class="text-button" data-propose="${c.id}">Proponer un encuentro ＋</button>` : ""}</article>`;
}
function filters() {
    const p = new URLSearchParams();
    const q = el("query").value.trim();
    if (q)
        p.set("q", q);
    if (chosenInterest)
        p.set("interest", chosenInterest);
    if (el("zone").value)
        p.set("zone", el("zone").value);
    p.set("order", el("order").value);
    if (el("only-available").checked)
        p.set("available", "1");
    const from = el("date-from").value;
    const to = el("date-to").value;
    if (from)
        p.set("from", String(parseTime(from + "T00:00")));
    if (to)
        p.set("to", String(parseTime(to + "T23:59")));
    return p;
}
async function refreshNotifications() {
    el("notifications").hidden = !session.user;
    if (!session.user)
        return;
    const rows = await api("/api/notifications");
    const count = rows.filter((n) => !n.read_at).length;
    el("notification-count").textContent = String(count);
    el("notification-count").hidden = count === 0;
}
async function load() {
    const generation = ++loadGeneration;
    el("results").setAttribute("aria-busy", "true");
    el("hero").hidden = view !== "explore" || Boolean(session.user);
    el("account").textContent = session.user
        ? session.user.alias
        : "Crear mi perfil ↗";
    document
        .querySelectorAll("[data-view]")
        .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    el("create-action").hidden = !session.user;
    el("create-action").textContent =
        view === "communities" ? "Crear comunidad ＋" : "Proponer encuentro ＋";
    const words = view === "communities"
        ? [
            "PERSONAS CON ALGO EN COMÚN",
            "Encuentra tu comunidad.",
            "Un espacio con intereses, reglas y maneras de compartir.",
        ]
        : view === "mine"
            ? [
                "TU AGENDA, A TU RITMO",
                "Los planes que elegiste.",
                "Plazas reservadas, listas de espera y encuentros que organizas.",
            ]
            : [
                "ENCUENTROS VOLUNTARIOS",
                session.user
                    ? `${session.user.alias}, ¿qué te gustaría compartir?`
                    : "Tu próximo plan empieza aquí.",
                "Explora propuestas y encuentros confirmados. Tú decides a cuáles sumarte.",
            ];
    el("view-kicker").textContent = words[0] ?? "";
    el("view-title").textContent = words[1] ?? "";
    el("view-description").textContent = words[2] ?? "";
    el("filters").hidden = view === "mine";
    try {
        const loadedCommunities = await api("/api/communities");
        if (generation !== loadGeneration)
            return;
        communities = loadedCommunities;
        if (view === "communities") {
            const list = await api("/api/communities?" + filters());
            if (generation !== loadGeneration)
                return;
            el("results").innerHTML =
                list.map(communityCard).join("") ||
                    '<div class="empty-state"><h3>Aún no hay coincidencias.</h3>Prueba con otro interés o una zona distinta.</div>';
            el("result-count").textContent =
                `${list.length} comunidades en esta exploración`;
        }
        else if (view === "mine" && !session.user) {
            el("results").innerHTML =
                '<div class="empty-state"><h3>Tu agenda comienza con un primer plan.</h3><p>Crea un perfil o inicia sesión para ver tus encuentros.</p><button class="button soft" id="empty-login">Crear mi perfil ↗</button></div>';
            el("result-count").textContent = "Inicia sesión para continuar";
            el("empty-login").addEventListener("click", () => showAuth("register"));
        }
        else {
            const events = await api(view === "mine" ? "/api/my-events" : "/api/events?" + filters());
            if (generation !== loadGeneration)
                return;
            el("results").innerHTML =
                events.map(eventCard).join("") ||
                    '<div class="empty-state"><h3>Hay espacio para un próximo plan.</h3>Prueba otros filtros o explora una comunidad para empezar.</div>';
            el("result-count").textContent =
                `${events.length} ${view === "mine" ? "planes en tu agenda" : "encuentros para explorar"}`;
        }
        bindCards();
        await refreshNotifications();
    }
    finally {
        if (generation === loadGeneration)
            el("results").setAttribute("aria-busy", "false");
    }
}
function bindCards() {
    document
        .querySelectorAll("[data-event]")
        .forEach((b) => b.addEventListener("click", () => void busy(b, () => showEvent(b.dataset.event ?? ""))));
    document
        .querySelectorAll("[data-join-community]")
        .forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        if (!session.user) {
            showAuth("register");
            return;
        }
        const r = await api(`/api/communities/${b.dataset.joinCommunity}/join`, "POST");
        await load();
        message(r.status === "pending"
            ? "Solicitud enviada. La moderación revisará tu ingreso."
            : "Ya eres parte de la comunidad. Ahora puedes inscribirte en sus encuentros.");
    })));
    document
        .querySelectorAll("[data-community-mod]")
        .forEach((b) => b.addEventListener("click", () => void busy(b, () => showCommunityModeration(b.dataset.communityMod ?? ""))));
    document
        .querySelectorAll("[data-propose]")
        .forEach((b) => b.addEventListener("click", () => showEventForm(b.dataset.propose ?? "")));
}
function showAuth(mode = "register") {
    openModal(mode === "register"
        ? "Tu próximo plan empieza contigo."
        : "Qué gusto encontrarte de nuevo.", "UN PERFIL, TUS INTERESES", `<div class="auth-tabs"><button type="button" id="tab-register" class="${mode === "register" ? "selected" : ""}">Crear perfil</button><button type="button" id="tab-login" class="${mode === "login" ? "selected" : ""}">Iniciar sesión</button></div><form id="auth-form"><div class="form-grid"><label class="field">Alias<input name="alias" id="auth-alias" autocomplete="username" minlength="3" maxlength="24" required placeholder="Elige cómo quieres aparecer"></label><label class="field">Frase de acceso<input name="password" id="auth-password" type="password" autocomplete="${mode === "register" ? "new-password" : "current-password"}" minlength="12" maxlength="128" required placeholder="Al menos 12 caracteres"></label>${mode === "register" ? `<label class="field">Zona aproximada<select id="auth-zone">${options(catalog.zones, "Lima Centro")}</select></label><label class="field">Presentación breve (opcional)<input id="auth-bio" maxlength="200" placeholder="Algo sobre lo que te gusta compartir"></label>` : ""}</div>${mode === "register" ? `<p class="form-section-label">Elige al menos un interés</p>${interestOptions()}<p class="hint">Puedes cambiar tus intereses después. Selección manual de zona, sin geolocalización.</p><label class="consent"><input id="adult-check" type="checkbox" required><span>Declaro tener 18 años o más. Entiendo que esta declaración no verifica la edad ni la identidad.</span></label><label class="consent"><input id="policies-check" type="checkbox" required><span>Acepto las reglas de convivencia y el <a class="text-link" href="/privacy" target="_blank" rel="noopener">aviso de privacidad del piloto</a>. En esta demostración usaré datos sintéticos.</span></label>` : '<p class="hint">Este piloto no utiliza correo ni tiene recuperación automática de contraseña. Conserva tu frase de acceso.</p>'}<div class="form-actions"><button class="button dark full-width" id="auth-submit" type="submit">${mode === "register" ? "Crear mi perfil" : "Iniciar sesión"} ↗</button></div></form>${session.demo ? `<div class="demo-choice"><p>O recorre el piloto con un perfil <strong>ficticio</strong>. Esta función solo existe en modo de demostración.</p><div class="demo-buttons"><button data-demo="lucia">Lucía · arte y moderación</button><button data-demo="mateo">Mateo · programación</button><button data-demo="nora">Nora · fútbol</button><button data-demo="ines">Inés · lectura y moderación</button></div></div>` : ""}`);
    el("tab-register").addEventListener("click", () => showAuth("register"));
    el("tab-login").addEventListener("click", () => showAuth("login"));
    el("auth-form").addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("auth-submit"), async () => {
            const body = {
                alias: el("auth-alias").value,
                password: el("auth-password").value,
            };
            if (mode === "register") {
                body.bio = el("auth-bio").value;
                body.zone = el("auth-zone").value;
                body.interests = formInterests(el("auth-form"));
                body.adultDeclaration = el("adult-check").checked;
                body.acceptPolicies = el("policies-check").checked;
            }
            session = {
                ...session,
                ...(await api("/api/" + (mode === "register" ? "register" : "login"), "POST", body)),
            };
            dialog.close();
            view = "explore";
            await load();
            message(mode === "register"
                ? "Tu perfil está listo. Explora una comunidad que comparta tus intereses."
                : "Sesión iniciada. Tus encuentros te esperan.");
        });
    });
    document.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        session = {
            ...session,
            ...(await api("/api/demo-login", "POST", { persona: b.dataset.demo })),
        };
        dialog.close();
        view = "explore";
        await load();
        message("Entraste con un perfil ficticio de demostración.");
    })));
}
async function showEvent(eid) {
    const event = await api("/api/events/" + eid);
    const reviews = await api(`/api/events/${eid}/reviews`);
    const canChat = Boolean(session.user &&
        event.isMember &&
        (event.canManage ||
            event.canModerate ||
            event.registration?.status === "going"));
    let messages = [];
    if (canChat)
        messages = await api(`/api/events/${eid}/messages`);
    const confirmed = event.status === "confirmed";
    const future = event.startsAt > Date.now();
    const registered = event.registration?.status === "going";
    const waiting = event.registration?.status === "waiting";
    const needs = event.registration?.needsConfirmation;
    const canReview = Boolean(session.user &&
        event.status === "completed" &&
        registered &&
        !reviews.some((r) => r.alias === session.user?.alias));
    let actions = !session.user
        ? '<button class="button dark full-width" id="event-login">Crear mi perfil para participar ↗</button>'
        : !event.isMember
            ? `<button class="button dark full-width" id="event-membership">${event.communityPrivacy === "private" ? "Solicitar ingreso a la comunidad" : "Unirme a la comunidad"}</button>`
            : event.canManage
                ? '<p class="detail-message">Organizas o moderas este encuentro. El aforo cuenta plazas de participantes; la organización queda aparte.</p>'
                : registered
                    ? `${needs ? '<div class="detail-message">El encuentro cambió o tu plaza se liberó de la espera. Revisa esta versión y confirma para coordinar.</div><button class="button plum full-width" id="reconfirm">Confirmar mi participación ↗</button>' : '<div class="detail-message">Tienes una plaza reservada en este encuentro.</div>'}<button class="button outline full-width" id="cancel-registration">Cancelar mi inscripción</button>`
                    : waiting
                        ? `<div class="detail-message">Estás en lista de espera. Recibirás una notificación si se libera una plaza.</div><button class="button outline full-width" id="cancel-registration">Salir de la lista de espera</button>`
                        : confirmed && future
                            ? `<button class="button dark full-width" id="join-event">${event.available > 0 ? "Reservar una plaza" : "Entrar en lista de espera"} ↗</button>`
                            : '<p class="detail-message">' +
                                (event.status === "proposed"
                                    ? "Esta actividad es una propuesta. Las inscripciones se abrirán cuando moderación la confirme."
                                    : "Este encuentro no admite nuevas inscripciones.") +
                                "</p>";
    if (event.canManage &&
        future &&
        ["confirmed", "proposed"].includes(event.status))
        actions += `<div class="form-actions"><button class="button outline" id="edit-event">Editar detalles</button>${event.canModerate && event.status === "proposed" ? '<button class="button plum" id="confirm-event">Confirmar propuesta</button>' : ""}<button class="text-button" id="cancel-event">Cancelar encuentro</button></div>`;
    if (event.canModerate &&
        event.status === "confirmed" &&
        event.endsAt < Date.now())
        actions +=
            '<button class="button outline" id="complete-event">Marcar como realizado</button>';
    openModal(event.title, `${statuses[event.status] ?? event.status} · ${event.communityName}`, `<div class="detail-grid"><section class="detail-info"><span class="status-label ${event.status}">${statuses[event.status]} · versión ${event.revision}</span><p class="detail-description">${esc(event.description)}</p><div class="detail-meta"><div><strong>CUÁNDO · HORA DE PERÚ (UTC−5)</strong>${esc(date(event.startsAt))} — ${esc(new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }).format(event.endsAt))}</div><div><strong>LUGAR PÚBLICO PROPUESTO · SINTÉTICO</strong>${esc(event.venue.label)} · ${esc(event.zone)}</div><div><strong>PLAZAS PARA PARTICIPANTES</strong>${event.going} de ${event.capacity} reservadas · ${event.waiting} en espera</div><div><strong>ACCESIBILIDAD · INFORMACIÓN DECLARADA</strong>${esc(event.accessibility)}</div><div><strong>ORGANIZA</strong>${esc(event.hostAlias)} · perfil ficticio del piloto</div></div><div class="form-actions">${actions}</div><div class="safety-note">Coordina aquí y prioriza un lugar público. No compartas teléfonos, domicilios ni rutas. Puedes cancelar. La declaración 18+ y las opiniones no verifican identidad ni garantizan seguridad.</div>${session.user && session.user.id !== event.hostId ? '<div class="detail-tools"><button class="text-button" id="report-host">Reportar un problema</button><button class="text-button" id="block-host">Bloquear a esta persona</button></div>' : ""}</section><section class="coordination"><div class="coordination-heading"><h3>La conversación del encuentro</h3><p>Visible para participantes con plaza, organización y moderación. Sin mensajes privados ni datos de contacto.</p></div>${canChat ? `<div class="messages" id="message-list">${messages.map((m) => `<article class="message"><header><strong>${esc(m.alias)}</strong><span>${esc(date(m.createdAt))}</span></header><p>${esc(m.body)}</p><div class="message-tools">${!m.own ? `<button class="text-button" data-report-message="${m.id}" data-author="${m.userId}">Reportar</button><button class="text-button" data-block-user="${m.userId}">Bloquear</button>` : ""}${event.canModerate ? `<button class="text-button" data-hide-message="${m.id}">Ocultar · moderación</button>` : ""}</div></article>`).join("") || '<p class="hint">Todavía no hay mensajes. Puedes iniciar la coordinación con una pregunta.</p>'}</div>${confirmed && event.endsAt > Date.now() && !needs ? '<form id="message-form" class="message-form"><label class="sr-only" for="message-body">Mensaje para el encuentro</label><textarea id="message-body" maxlength="1000" required placeholder="Una pregunta, una idea, algo para coordinar…"></textarea><button class="button plum" id="send-message" type="submit">Enviar mensaje ↗</button></form>' : '<div class="closed-chat">' + (needs ? "Confirma los cambios para escribir." : "La conversación ya no admite nuevos mensajes.") + "</div>"}` : '<div class="closed-chat">La coordinación se abre al reservar una plaza. Las personas en espera o ajenas al encuentro no pueden leer los mensajes.</div>'}</section></div><section class="review-section"><h3>Opiniones sobre la actividad</h3><p class="hint">Solo pueden opinar cuentas con una inscripción registrada cuando moderación marca la actividad como realizada. Esto no acredita asistencia ni verifica la seguridad del encuentro.</p>${reviews.map((r) => `<article class="review"><strong>${esc(r.alias)} · ${r.rating}/5</strong><p>${esc(r.body)}</p><p class="hint">${esc(r.origin)}</p></article>`).join("") || '<p class="hint">Aún no hay opiniones para esta actividad.</p>'}${canReview ? '<form id="review-form" class="form-grid"><label class="field">Tu valoración<select id="review-rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></label><label class="field full">Tu experiencia<textarea id="review-body" required minlength="5" maxlength="500"></textarea></label><button class="button outline" id="send-review" type="submit">Publicar opinión</button></form>' : ""}</section>`);
    const bind = (id, fn) => {
        const button = document.getElementById(id);
        if (button)
            button.addEventListener("click", () => void busy(button, () => fn(button)));
    };
    bind("event-login", async () => showAuth("register"));
    bind("event-membership", async () => {
        await api(`/api/communities/${event.communityId}/join`, "POST");
        await load();
        await showEvent(eid);
        message("Ya formas parte de la comunidad. Ahora puedes reservar una plaza.");
    });
    bind("join-event", async () => {
        const result = await api(`/api/events/${eid}/registration`, "POST", { revision: event.revision });
        await load();
        await showEvent(eid);
        message(result.status === "going"
            ? "Plaza reservada. Ya puedes coordinar dentro del encuentro."
            : "Te sumaste a la lista de espera. Te avisaremos si obtienes una plaza.");
    });
    bind("cancel-registration", async () => {
        await api(`/api/events/${eid}/registration`, "DELETE");
        await load();
        await showEvent(eid);
        message("Tu inscripción fue cancelada. Si había espera, la plaza se asignó por orden.");
    });
    bind("reconfirm", async () => {
        await api(`/api/events/${eid}/reconfirm`, "POST", {
            revision: event.revision,
        });
        await load();
        await showEvent(eid);
        message("Confirmaste esta versión del encuentro.");
    });
    bind("edit-event", async () => showEventForm(event.communityId, event));
    bind("confirm-event", async () => {
        await api(`/api/events/${eid}/status`, "PATCH", { status: "confirmed" });
        await load();
        await showEvent(eid);
    });
    bind("complete-event", async () => {
        await api(`/api/events/${eid}/status`, "PATCH", { status: "completed" });
        await load();
        await showEvent(eid);
    });
    bind("cancel-event", async () => {
        openModal("¿Cancelar este encuentro?", "DECISIÓN DE ORGANIZACIÓN", `<p class="detail-description">Se notificará a las personas inscritas y se cancelarán sus plazas y esperas. Esta acción no se revierte.</p><div class="form-actions"><button id="confirm-cancel-event" class="button danger">Sí, cancelar encuentro</button><button id="back-to-event" class="button outline">Volver</button></div>`);
        el("back-to-event").addEventListener("click", () => void showEvent(eid).catch(showError));
        el("confirm-cancel-event").addEventListener("click", () => void busy(el("confirm-cancel-event"), async () => {
            await api(`/api/events/${eid}/status`, "PATCH", {
                status: "cancelled",
            });
            await load();
            await showEvent(eid);
            message("El encuentro fue cancelado y sus participantes recibieron un aviso.");
        }));
    });
    bind("report-host", async () => showReport(event, event.hostId));
    bind("block-host", async () => confirmBlock(event, event.hostId));
    const messageForm = document.getElementById("message-form");
    messageForm?.addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("send-message"), async () => {
            await api(`/api/events/${eid}/messages`, "POST", {
                body: el("message-body").value,
            });
            await showEvent(eid);
        });
    });
    document
        .querySelectorAll("[data-report-message]")
        .forEach((b) => b.addEventListener("click", () => showReport(event, b.dataset.author ?? "", b.dataset.reportMessage)));
    document
        .querySelectorAll("[data-block-user]")
        .forEach((b) => b.addEventListener("click", () => confirmBlock(event, b.dataset.blockUser ?? "")));
    document
        .querySelectorAll("[data-hide-message]")
        .forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        await api(`/api/messages/${b.dataset.hideMessage}/hide`, "POST");
        await showEvent(eid);
        message("Mensaje oculto por moderación. El reporte, si existe, conserva su evidencia limitada.");
    })));
    const reviewForm = document.getElementById("review-form");
    reviewForm?.addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("send-review"), async () => {
            await api(`/api/events/${eid}/reviews`, "POST", {
                rating: Number(el("review-rating").value),
                body: el("review-body").value,
            });
            await showEvent(eid);
        });
    });
}
function showReport(event, target, mid) {
    openModal("Cuéntanos qué pasó.", "REPORTE A MODERACIÓN", `<p class="hint">Tu reporte será visible solo para la moderación de esta comunidad que no tenga conflicto directo en el caso. Describe el problema sin añadir teléfonos ni domicilios. No es un servicio de emergencias.</p><form id="report-form"><label class="field">Motivo<textarea id="report-reason" required minlength="5" maxlength="800" placeholder="Describe lo sucedido para que pueda revisarse."></textarea></label><p class="hint">Se conservará una copia limitada del mensaje señalado, si lo hay. Consulta los plazos en el aviso de privacidad.</p><div class="form-actions"><button id="send-report" class="button plum" type="submit">Enviar reporte</button></div></form>`);
    el("report-form").addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("send-report"), async () => {
            await api("/api/reports", "POST", {
                eventId: event.id,
                subjectUserId: target,
                ...(mid ? { messageId: mid } : {}),
                reason: el("report-reason").value,
            });
            dialog.close();
            message("Reporte enviado. Puedes consultar su estado desde tu perfil.");
        });
    });
}
function confirmBlock(event, target) {
    openModal("Pon un límite a la interacción.", "BLOQUEO DE USUARIOS", `<p class="detail-description">El bloqueo oculta los mensajes entre ambos y los encuentros organizados por esa persona. Si uno organiza un encuentro donde el otro participa, se cancela esa inscripción. No garantiza separación física ni borra reportes.</p><div class="form-actions"><button class="button danger" id="apply-block">Bloquear y dejar constancia</button><button class="button outline" id="block-back">Volver</button></div>`);
    el("block-back").addEventListener("click", () => void showEvent(event.id).catch(showError));
    el("apply-block").addEventListener("click", () => void busy(el("apply-block"), async () => {
        await api(`/api/blocks/${target}`, "POST");
        await load();
        showReport(event, target);
        message("Bloqueo aplicado. Si lo necesitas, puedes enviar un reporte ahora; es opcional.");
    }));
}
function showEventForm(cid = "", editing) {
    if (!session.user) {
        showAuth("register");
        return;
    }
    const active = communities.filter((c) => c.membership?.status === "active");
    if (!active.length) {
        openModal("Empieza por una comunidad.", "ENCUENTROS CON CONTEXTO", '<p class="detail-description">Únete a una comunidad antes de proponer una actividad. Si es privada, espera la aprobación de moderación.</p><button class="button plum" id="browse-communities">Explorar comunidades ↗</button>');
        el("browse-communities").addEventListener("click", () => {
            dialog.close();
            void switchView("communities");
        });
        return;
    }
    const defaultStart = Date.now() + 7 * 86400000;
    openModal(editing
        ? "Revisar los detalles del encuentro."
        : "Una idea para compartir.", "PROPUESTA · LUGAR PÚBLICO", `<form id="event-form"><div class="form-grid">${!editing ? `<label class="field full">Comunidad<select id="event-community">${active.map((c) => `<option value="${c.id}" ${cid === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}<label class="field full">Título<input id="event-title" required minlength="5" maxlength="100" value="${esc(editing?.title ?? "")}" placeholder="Algo que te gustaría hacer en compañía"></label><label class="field full">Descripción<textarea id="event-description" required minlength="10" maxlength="1000">${esc(editing?.description ?? "")}</textarea></label><label class="field">Inicio · hora de Perú<input id="event-start" type="datetime-local" required value="${localTime(editing?.startsAt ?? defaultStart)}"></label><label class="field">Fin · hora de Perú<input id="event-end" type="datetime-local" required value="${localTime(editing?.endsAt ?? defaultStart + 90 * 60000)}"></label><label class="field">Aforo de participantes (sin organización)<input id="event-capacity" type="number" min="1" max="100" required value="${editing?.capacity ?? 8}"></label><label class="field">Lugar público de demostración<select id="event-venue">${catalog.venues.map((p) => `<option value="${p.id}" ${editing?.venue.id === p.id ? "selected" : ""}>${esc(p.label)} · ${esc(p.zone)}</option>`).join("")}</select></label><label class="field full">Accesibilidad y necesidades por confirmar<textarea id="event-access" minlength="5" maxlength="300" required>${esc(editing?.accessibility ?? "Lugar de demostración. Las condiciones de acceso deberán verificarse antes de un encuentro real.")}</textarea></label></div><p class="hint">${editing ? "Cualquier edición en este piloto crea una nueva versión. Las personas con plaza deberán reconfirmar; no se liberan sus plazas automáticamente." : "Se crea como propuesta. Moderación deberá confirmarla antes de abrir inscripciones."} Horarios UTC−5. Lugares, aforo y accesibilidad son datos sintéticos; no constituyen una reserva de local.</p><div class="form-actions"><button class="button dark" id="save-event" type="submit">${editing ? "Guardar y notificar cambios" : "Publicar propuesta"} ↗</button></div></form>`);
    el("event-form").addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("save-event"), async () => {
            const input = {
                title: el("event-title").value,
                description: el("event-description").value,
                startsAt: parseTime(el("event-start").value),
                endsAt: parseTime(el("event-end").value),
                capacity: Number(el("event-capacity").value),
                venueId: el("event-venue").value,
                accessibility: el("event-access").value,
            };
            const result = await api(editing
                ? `/api/events/${editing.id}`
                : `/api/communities/${el("event-community").value}/events`, editing ? "PATCH" : "POST", { ...input, ...(editing ? { revision: editing.revision } : {}) });
            await load();
            await showEvent(result.id);
            message(editing
                ? "Cambios guardados. Se avisó a las personas inscritas."
                : "Propuesta creada. La moderación de la comunidad puede confirmarla.");
        });
    });
}
function showCommunityForm() {
    if (!session.user) {
        showAuth("register");
        return;
    }
    openModal("Un espacio para lo que comparten.", "CREAR COMUNIDAD", `<form id="community-form"><div class="form-grid"><label class="field full">Nombre<input id="community-name" required minlength="5" maxlength="70" placeholder="Un nombre para tu comunidad"></label><label class="field full">Descripción<textarea id="community-description" required minlength="10" maxlength="600"></textarea></label><label class="field">Interés principal<select id="community-interest">${catalog.interests.map((i) => `<option value="${i.id}">${esc(i.label)}</option>`).join("")}</select></label><label class="field">Zona aproximada<select id="community-zone">${options(catalog.zones, session.user.zone)}</select></label><label class="field">Ingreso<select id="community-privacy"><option value="public">Comunidad abierta</option><option value="private">Privada · solicitud y aprobación</option></select></label><label class="field full">Reglas de convivencia<textarea id="community-rules" required minlength="10" maxlength="1000">Respeta los límites de las demás personas. Coordina en lugares públicos, no compartas datos personales y utiliza el reporte cuando sea necesario.</textarea></label></div><p class="hint">Serás la persona organizadora de la comunidad. Toda comunidad creada aquí forma parte de la demostración sintética.</p><div class="form-actions"><button class="button dark" id="save-community" type="submit">Crear comunidad ↗</button></div></form>`);
    el("community-form").addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("save-community"), async () => {
            await api("/api/communities", "POST", {
                name: el("community-name").value,
                description: el("community-description").value,
                interest: el("community-interest").value,
                zone: el("community-zone").value,
                privacy: el("community-privacy").value,
                rules: el("community-rules").value,
            });
            dialog.close();
            await switchView("communities");
            message("Comunidad creada. Ahora puedes proponer su primer encuentro.");
        });
    });
}
async function showCommunityModeration(cid) {
    const community = communities.find((c) => c.id === cid);
    if (!community)
        return;
    const [requests, members] = await Promise.all([
        api(`/api/communities/${cid}/requests`),
        api(`/api/communities/${cid}/members`),
    ]);
    openModal(community.name, "MODERACIÓN DE LA COMUNIDAD", `<p class="hint">Las aprobaciones habilitan el acceso al contenido de la comunidad. No constituyen una verificación de identidad ni garantizan la seguridad de una persona.</p><h3>Solicitudes de ingreso</h3>${requests.map((r) => `<article class="request"><strong>${esc(r.alias)}</strong><p class="hint">Solicitud: ${esc(date(r.createdAt))}</p><div class="form-actions"><button class="button plum" data-approve="${r.userId}">Aprobar ingreso</button><button class="button outline" data-reject="${r.userId}">No aprobar</button></div></article>`).join("") || '<p class="hint">No hay solicitudes pendientes.</p>'}<hr class="divider"><h3>Miembros y moderación</h3><p class="hint">Solo la organización asigna roles. Retirar una membresía revoca la coordinación y cancela sus inscripciones en esta comunidad.</p>${members.map((m) => `<article class="request"><strong>${esc(m.alias)}</strong> · ${m.role === "owner" ? "Organización" : m.role === "moderator" ? "Moderación" : "Miembro"}<div class="form-actions">${community.membership?.role === "owner" && m.role !== "owner" ? `<button class="text-button" data-member-role="${m.userId}" data-moderator="${m.role === "moderator" ? "0" : "1"}">${m.role === "moderator" ? "Retirar rol de moderación" : "Asignar moderación"}</button>` : ""}${m.role !== "owner" && (m.role === "member" || community.membership?.role === "owner") ? `<button class="text-button" data-remove-member="${m.userId}">Retirar membresía</button>` : ""}</div></article>`).join("")}<hr class="divider"><button class="button outline" id="community-reports">Revisar reportes de mis comunidades ↗</button>`);
    document
        .querySelectorAll("[data-approve],[data-reject]")
        .forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        await api(`/api/communities/${cid}/requests/${b.dataset.approve ?? b.dataset.reject}`, "PATCH", { approve: Boolean(b.dataset.approve) });
        await load();
        await showCommunityModeration(cid);
        message("Solicitud revisada. Se notificó el resultado a la persona.");
    })));
    document
        .querySelectorAll("[data-member-role]")
        .forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        await api(`/api/communities/${cid}/members/${b.dataset.memberRole}/role`, "PATCH", { moderator: b.dataset.moderator === "1" });
        await load();
        await showCommunityModeration(cid);
        message("Rol actualizado y notificado.");
    })));
    document
        .querySelectorAll("[data-remove-member]")
        .forEach((b) => b.addEventListener("click", () => {
        const target = b.dataset.removeMember ?? "";
        openModal("Retirar una membresía.", "DECISIÓN DE MODERACIÓN", `<p class="detail-description">Se cancelarán sus inscripciones de esta comunidad y se cerrarán los encuentros que organiza aquí. La acción quedará registrada y se notificará a la persona.</p><div class="form-actions"><button class="button danger" id="confirm-member-removal">Confirmar retiro</button><button class="button outline" id="cancel-member-removal">Volver</button></div>`);
        el("cancel-member-removal").addEventListener("click", () => void showCommunityModeration(cid).catch(showError));
        el("confirm-member-removal").addEventListener("click", () => void busy(el("confirm-member-removal"), async () => {
            await api(`/api/communities/${cid}/members/${target}/remove`, "POST");
            await load();
            await showCommunityModeration(cid);
            message("Membresía retirada. Sus plazas se liberaron.");
        }));
    }));
    el("community-reports").addEventListener("click", () => void showModeration().catch(showError));
}
async function showModeration() {
    const reports = await api("/api/moderation/reports");
    openModal("Cuidar el espacio compartido.", "REVISIÓN DE REPORTES", `<p class="hint">Solo aparecen reportes de tus comunidades en los que no eres la persona reportada ni quien presentó el reporte. Los casos con conflicto deben revisarse por otra persona moderadora.</p>${reports.map((r) => `<article class="report"><header><strong>${esc(r.community_name)}</strong><span class="badge">${r.status === "open" ? "Pendiente" : r.status === "resolved" ? "Resuelto" : "Desestimado"}</span></header><p>${esc(r.reason)}</p><details><summary>Evidencia limitada del reporte</summary><div class="report-evidence">${esc(r.evidence)}</div></details>${r.status === "open" ? `<form data-report-form="${r.id}"><label class="field">Respuesta de moderación<textarea name="resolution" required minlength="5" maxlength="800" placeholder="Explica la decisión de forma comprensible."></textarea></label><div class="form-actions">${r.message_id ? `<button type="button" class="button outline" data-hide-report-message="${r.message_id}">Ocultar mensaje</button>` : ""}<button class="button plum" type="submit">Cerrar como resuelto</button><button type="button" class="text-button" data-dismiss="${r.id}">Desestimar con explicación</button></div></form>` : ""}</article>`).join("") || '<div class="empty-state">No hay reportes revisables para tu cuenta.</div>'}`);
    document
        .querySelectorAll("[data-report-form]")
        .forEach((form) => form.addEventListener("submit", (e) => {
        e.preventDefault();
        const button = form.querySelector("button[type=submit]");
        void busy(button, async () => {
            await api(`/api/moderation/reports/${form.dataset.reportForm}`, "PATCH", {
                status: "resolved",
                resolution: form.querySelector("[name=resolution]")
                    .value,
            });
            await showModeration();
        });
    }));
    document.querySelectorAll("[data-dismiss]").forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        const form = b.closest("form");
        await api(`/api/moderation/reports/${b.dataset.dismiss}`, "PATCH", {
            status: "dismissed",
            resolution: form.querySelector("[name=resolution]")
                .value,
        });
        await showModeration();
    })));
    document
        .querySelectorAll("[data-hide-report-message]")
        .forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        await api(`/api/messages/${b.dataset.hideReportMessage}/hide`, "POST");
        message("Mensaje oculto. Completa la decisión del reporte con una explicación.");
    })));
}
async function showNotifications() {
    if (!session.user) {
        showAuth("login");
        return;
    }
    const rows = await api("/api/notifications");
    openModal("Lo nuevo en tus comunidades.", "NOTIFICACIONES INTERNAS", `<p class="hint">Los avisos quedan guardados en tu cuenta. No se envían correos, SMS ni notificaciones push.</p>${rows.map((n) => `<article class="notification ${n.read_at ? "" : "unread"}"><header><span>${n.read_at ? "Leída" : "Sin leer"}</span><span>${esc(date(n.created_at))}</span></header><p>${esc(n.text)}</p><div class="form-actions">${n.event_id ? `<button class="text-button" data-event="${n.event_id}">Ver encuentro ↗</button>` : ""}${!n.read_at ? `<button class="text-button" data-read="${n.id}">Marcar como leída</button>` : ""}</div></article>`).join("") || '<div class="empty-state">Cuando algo cambie en tus planes, lo encontrarás aquí.</div>'}`);
    bindCards();
    document.querySelectorAll("[data-read]").forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        await api(`/api/notifications/${b.dataset.read}/read`, "POST");
        await refreshNotifications();
        await showNotifications();
    })));
}
async function showAccount() {
    if (!session.user) {
        showAuth("register");
        return;
    }
    const user = session.user;
    const [blocks, reports] = await Promise.all([
        api("/api/blocks"),
        api("/api/reports/mine"),
    ]);
    openModal("Tu perfil, a tu manera.", "ALIAS Y ZONA APROXIMADA", `<form id="profile-form"><div class="form-grid"><label class="field">Alias<input disabled value="${esc(user.alias)}"></label><label class="field">Zona aproximada<select id="profile-zone">${options(catalog.zones, user.zone)}</select></label><label class="field full">Presentación breve<textarea id="profile-bio" maxlength="200">${esc(user.bio)}</textarea></label></div><p class="form-section-label">Tus intereses</p>${interestOptions(user.interests)}<p class="hint">${esc(user.ageDeclaration)}. El piloto no solicita documentos ni biometría.</p><div class="form-actions"><button class="button plum" id="save-profile" type="submit">Guardar perfil</button></div></form><div class="account-links"><button class="text-button" id="export-account">Descargar mis datos</button><button class="text-button" id="account-moderation">Revisar moderación</button><button class="text-button" id="logout">Cerrar sesión</button></div><hr class="divider"><h3>Personas bloqueadas</h3>${blocks.map((b) => `<div class="request">${esc(b.alias)} <button class="text-button" data-unblock="${b.blocked_id}">Desbloquear</button></div>`).join("") || '<p class="hint">No tienes personas bloqueadas.</p>'}<h3>Estado de mis reportes</h3>${reports.map((r) => `<div class="request"><span class="badge">${r.status === "open" ? "Pendiente" : r.status === "resolved" ? "Resuelto" : "Desestimado"}</span> · ${esc(date(r.created_at))}<p class="hint">Referencia: ${esc(r.id)}</p></div>`).join("") || '<p class="hint">No has presentado reportes.</p>'}<hr class="divider"><p class="hint">Puedes eliminar tu cuenta. Las inscripciones se cancelarán y tus textos dejarán de ser visibles. Los reportes conservan evidencia limitada durante el plazo del aviso de privacidad.</p><div class="form-actions"><button class="text-button" id="delete-account">Eliminar mi cuenta</button>${session.demo ? '<button class="text-button" id="switch-demo">Cambiar a otro perfil ficticio</button>' : ""}</div>`);
    el("profile-form").addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("save-profile"), async () => {
            const result = await api("/api/profile", "PATCH", {
                bio: el("profile-bio").value,
                zone: el("profile-zone").value,
                interests: formInterests(el("profile-form")),
            });
            session.user = result.user;
            await load();
            message("Perfil actualizado. Tus recomendaciones usan los intereses y la zona que elegiste.");
        });
    });
    el("logout").addEventListener("click", () => void busy(el("logout"), async () => {
        await api("/api/logout", "POST");
        session = { ...session, user: null, csrf: null };
        dialog.close();
        view = "explore";
        await load();
        message("Cerraste tu sesión.");
    }));
    el("account-moderation").addEventListener("click", () => void showModeration().catch(showError));
    el("export-account").addEventListener("click", () => void busy(el("export-account"), async () => {
        const data = await api("/api/account/export");
        const link = document.createElement("a");
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
        }));
        link.href = url;
        link.download = "entre-mis-datos.json";
        link.click();
        URL.revokeObjectURL(url);
        message("Descarga preparada con los datos de tu cuenta.");
    }));
    document.querySelectorAll("[data-unblock]").forEach((b) => b.addEventListener("click", () => void busy(b, async () => {
        await api(`/api/blocks/${b.dataset.unblock}`, "DELETE");
        await load();
        await showAccount();
    })));
    el("delete-account").addEventListener("click", showDelete);
    document
        .getElementById("switch-demo")
        ?.addEventListener("click", () => showAuth("login"));
}
function showDelete() {
    openModal("Eliminar tu cuenta.", "CONTROL SOBRE TUS DATOS", `<p class="detail-description">Se revocarán tus sesiones, se cancelarán tus inscripciones y se retirarán tu perfil, mensajes y opiniones. Las comunidades que organizas se archivarán y sus encuentros futuros se cancelarán. Los reportes conservan evidencia limitada según el aviso de privacidad.</p><p class="hint">Necesitas la frase de acceso que elegiste al registrarte. Los perfiles ficticios precargados no tienen una contraseña pública.</p><form id="delete-form"><div class="form-grid"><label class="field">Tu frase de acceso<input id="delete-password" type="password" autocomplete="current-password" minlength="12" required></label><label class="field">Escribe ELIMINAR<input id="delete-confirm" pattern="ELIMINAR" required></label></div><div class="form-actions"><button class="button danger" id="confirm-delete" type="submit">Eliminar definitivamente mi cuenta</button></div></form>`);
    el("delete-form").addEventListener("submit", (e) => {
        e.preventDefault();
        void busy(el("confirm-delete"), async () => {
            await api("/api/account", "DELETE", {
                password: el("delete-password").value,
                confirm: el("delete-confirm").value,
            });
            session = { ...session, user: null, csrf: null };
            dialog.close();
            view = "explore";
            await load();
            message("Tu cuenta fue eliminada y tus sesiones revocadas.");
        });
    });
}
async function switchView(next) {
    view = next;
    await load();
    if (next !== "explore")
        el("discover").scrollIntoView({ block: "start" });
}
function setup() {
    document.querySelectorAll("a.brand").forEach((a) => a.addEventListener("click", (event) => {
        event.preventDefault();
        void switchView("explore")
            .then(() => window.scrollTo({ top: 0, behavior: "instant" }))
            .catch(showError);
    }));
    el("interest-chips").innerHTML =
        '<button class="interest-chip active" data-interest="">Todos los intereses</button>' +
            catalog.interests
                .map((i) => `<button class="interest-chip" data-interest="${i.id}"><span class="chip-symbol">${i.symbol}</span>${esc(i.label)}</button>`)
                .join("");
    el("zone").innerHTML = options(catalog.zones, "", "Cualquier zona");
    document.querySelectorAll("[data-interest]").forEach((b) => b.addEventListener("click", () => {
        chosenInterest = b.dataset.interest ?? "";
        document
            .querySelectorAll("[data-interest]")
            .forEach((node) => node.classList.toggle("active", node.dataset.interest === chosenInterest));
        void load().catch(showError);
    }));
    document
        .querySelectorAll("[data-view]")
        .forEach((b) => b.addEventListener("click", () => void switchView(b.dataset.view ?? "explore").catch(showError)));
    el("filters").addEventListener("submit", (e) => {
        e.preventDefault();
        void load().catch(showError);
    });
    el("reset-filters").addEventListener("click", () => {
        el("filters").reset();
        chosenInterest = "";
        document
            .querySelectorAll("[data-interest]")
            .forEach((node) => node.classList.toggle("active", node.dataset.interest === ""));
        void load().catch(showError);
    });
    el("account").addEventListener("click", () => void showAccount().catch(showError));
    el("mobile-account").addEventListener("click", () => void showAccount().catch(showError));
    el("notifications").addEventListener("click", () => void showNotifications().catch(showError));
    el("open-demo").hidden = !session.demo;
    el("open-demo").addEventListener("click", () => showAuth("login"));
    el("create-action").addEventListener("click", () => view === "communities" ? showCommunityForm() : showEventForm());
    el("close-modal").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            const rect = dialog.getBoundingClientRect();
            if (event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom)
                dialog.close();
        }
    });
}
async function bootstrap() {
    [catalog, session] = await Promise.all([
        api("/api/catalog"),
        api("/api/session"),
    ]);
    setup();
    await load();
}
void bootstrap().catch((error) => {
    el("results").innerHTML =
        '<div class="empty-state"><h3>No pudimos cargar los encuentros.</h3>Recarga la página para volver a intentarlo.</div>';
    showError(error);
});
export {};
