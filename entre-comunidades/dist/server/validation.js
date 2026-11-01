import { Problem, INTERESTS, ZONES, VENUES } from "./types.js";
export function object(value, allowed) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Problem(422, "invalid_body", "Se requiere un objeto JSON.");
    const record = value;
    if (Object.keys(record).some((k) => !allowed.includes(k)))
        throw new Problem(422, "unknown_field", "Hay campos no admitidos.");
    return record;
}
export function text(value, name, min = 1, max = 500) {
    if (typeof value !== "string")
        throw new Problem(422, "invalid_field", `Revisa ${name}.`);
    const result = value.normalize("NFKC").trim();
    if (result.length < min ||
        result.length > max ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(result))
        throw new Problem(422, "invalid_field", `${name}: entre ${min} y ${max} caracteres.`);
    return result;
}
export function publicText(value, name, min = 1, max = 500) {
    const result = text(value, name, min, max);
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(result) ||
        /(?:\+?\d[\s().-]*){7,}/.test(result) ||
        /\b(?:domicilio|direcci[oó]n\s+personal|mi\s+casa|vivo\s+en|calle|jiron|jirón|avenida|pasaje)\b/i.test(result))
        throw new Problem(422, "personal_data", "Evita teléfonos, correos y domicilios. Coordina con el lugar público del encuentro.");
    return result;
}
export function alias(value) {
    const result = text(value, "alias", 3, 24);
    if (!/^[\p{L}\p{N}_.-]+$/u.test(result))
        throw new Problem(422, "invalid_alias", "Alias: letras, números, punto, guion o guion bajo.");
    return result;
}
export function password(value) {
    if (typeof value !== "string" || value.length < 12 || value.length > 128)
        throw new Problem(422, "invalid_password", "Usa una frase de acceso de 12 a 128 caracteres.");
    return value;
}
export function integer(value, name, min, max) {
    if (typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max)
        throw new Problem(422, "invalid_field", `Revisa ${name}: ${min} a ${max}.`);
    return value;
}
export function bool(value, name) {
    if (typeof value !== "boolean")
        throw new Problem(422, "invalid_field", `Revisa ${name}.`);
    return value;
}
export function choice(value, choices, name) {
    if (typeof value !== "string" || !choices.includes(value))
        throw new Problem(422, "invalid_field", `Elige ${name}.`);
    return value;
}
export function interests(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 6)
        throw new Problem(422, "interests", "Elige de uno a seis intereses.");
    return [
        ...new Set(value.map((v) => choice(v, INTERESTS.map((i) => i.id), "un interés del catálogo"))),
    ];
}
export const zone = (value) => choice(value, ZONES, "una zona aproximada");
export function eventInput(value) {
    const o = object(value, [
        "title",
        "description",
        "startsAt",
        "endsAt",
        "capacity",
        "venueId",
        "accessibility",
    ]);
    const startsAt = integer(o.startsAt, "inicio", Date.now() + 60_000, Date.now() + 366 * 86400000);
    const endsAt = integer(o.endsAt, "fin", startsAt + 15 * 60_000, startsAt + 12 * 3600_000);
    return {
        title: publicText(o.title, "título", 5, 100),
        description: publicText(o.description, "descripción", 10, 1000),
        startsAt,
        endsAt,
        capacity: integer(o.capacity, "aforo", 1, 100),
        venueId: choice(o.venueId, VENUES.map((v) => v.id), "un lugar público de demostración"),
        accessibility: publicText(o.accessibility, "accesibilidad", 5, 300),
    };
}
