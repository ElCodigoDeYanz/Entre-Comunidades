import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Store } from "./database.js";
import {
  Problem,
  LIMITS,
  POLICY_VERSION,
  type Row,
  type Profile,
} from "./types.js";
import * as v from "./validation.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [version, saltHex, keyHex] = stored.split("$");
  if (
    version !== "scrypt-v1" ||
    !saltHex ||
    !keyHex ||
    saltHex.length !== 32 ||
    keyHex.length !== 128
  )
    return false;
  const candidate = await derive(password, Buffer.from(saltHex, "hex"));
  return timingSafeEqual(candidate, Buffer.from(keyHex, "hex"));
}
export function profile(row: Row): Profile {
  return {
    id: String(row.id),
    alias: String(row.alias),
    bio: String(row.bio),
    zone: String(row.zone),
    interests: JSON.parse(String(row.interests)) as string[],
    ageDeclaration: "18+ por autodeclaración; identidad y edad no comprobadas",
    role: String(row.role),
  };
}
export type Auth = { user: Row; csrf: string; tokenHash: string };
export function authenticate(store: Store, req: IncomingMessage): Auth | null {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("entre_session="));
  const token = cookie?.slice("entre_session=".length);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const tokenHash = hash(token);
  const session = store.one(
    "SELECT s.*,u.deleted_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?",
    tokenHash,
  );
  if (
    !session ||
    session.deleted_at !== null ||
    Number(session.expires_at) <= Date.now()
  ) {
    store.run("DELETE FROM sessions WHERE token_hash=?", tokenHash);
    return null;
  }
  const user = store.one(
    "SELECT * FROM users WHERE id=?",
    String(session.user_id),
  );
  return user ? { user, csrf: String(session.csrf), tokenHash } : null;
}
export function need(auth: Auth | null): Auth {
  if (!auth)
    throw new Problem(401, "login_required", "Inicia sesión para continuar.");
  return auth;
}
export function checkCsrf(req: IncomingMessage, auth: Auth): void {
  const candidate = req.headers["x-csrf-token"];
  if (
    typeof candidate !== "string" ||
    candidate.length !== auth.csrf.length ||
    !timingSafeEqual(Buffer.from(candidate), Buffer.from(auth.csrf))
  )
    throw new Problem(
      403,
      "csrf",
      "La sesión necesita actualizarse. Recarga la página.",
    );
}
export function checkOrigin(
  req: IncomingMessage,
  expectedOrigin?: string,
): void {
  const origin = req.headers.origin;
  if (!origin) return;
  let allowed = false;
  try {
    allowed = expectedOrigin
      ? origin === expectedOrigin
      : new URL(origin).host === req.headers.host;
  } catch {
    /* denied */
  }
  if (!allowed)
    throw new Problem(403, "origin", "Origen de la solicitud no admitido.");
}
export function rateLimit(
  store: Store,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): void {
  store.transaction(() => {
    const row = store.one("SELECT * FROM rate_limits WHERE key=?", key);
    if (!row || Number(row.reset_at) <= now) {
      store.run(
        "INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,reset_at=excluded.reset_at",
        key,
        now + windowMs,
      );
      return;
    }
    if (Number(row.count) >= max)
      throw new Problem(
        429,
        "rate_limit",
        "Demasiados intentos. Espera antes de repetir.",
      );
    store.run("UPDATE rate_limits SET count=count+1 WHERE key=?", key);
  });
}
export function rateKey(
  pepper: string,
  req: IncomingMessage,
  route: string,
): string {
  return hash(`${pepper}|${route}|${req.socket.remoteAddress ?? "local"}`);
}
export function newSession(store: Store, user: Row, secure: boolean) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const now = Date.now();
  store.run(
    "INSERT INTO sessions VALUES (?,?,?,?,?)",
    hash(token),
    String(user.id),
    csrf,
    now,
    now + LIMITS.sessionHours * 3600000,
  );
  return {
    body: { user: profile(user), csrf },
    cookie: `entre_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${LIMITS.sessionHours * 3600}${secure ? "; Secure" : ""}`,
  };
}
export async function register(store: Store, input: unknown): Promise<Row> {
  const o = v.object(input, [
    "alias",
    "password",
    "bio",
    "zone",
    "interests",
    "adultDeclaration",
    "acceptPolicies",
  ]);
  const alias = v.alias(o.alias);
  const password = v.password(o.password);
  const bio = v.publicText(o.bio ?? "", "presentación", 0, 200);
  const zone = v.zone(o.zone);
  const interests = v.interests(o.interests);
  if (
    !v.bool(o.adultDeclaration, "declaración de edad") ||
    !v.bool(o.acceptPolicies, "aceptación de políticas")
  )
    throw new Problem(
      422,
      "consent_required",
      "El piloto exige declaración de mayoría de edad y aceptación del aviso de privacidad y reglas.",
    );
  const key = alias.toLocaleLowerCase("es");
  if (store.one("SELECT id FROM users WHERE alias_key=?", key))
    throw new Problem(409, "alias_taken", "Elige otro alias.");
  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  const now = Date.now();
  try {
    store.run(
      "INSERT INTO users(id,alias,alias_key,bio,zone,interests,password_hash,age_declared_at,policy_version,consent_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      id,
      alias,
      key,
      bio,
      zone,
      JSON.stringify(interests),
      passwordHash,
      now,
      POLICY_VERSION,
      now,
      now,
    );
  } catch (error) {
    if (store.one("SELECT id FROM users WHERE alias_key=?", key))
      throw new Problem(409, "alias_taken", "Elige otro alias.");
    throw error;
  }
  return store.one("SELECT * FROM users WHERE id=?", id)!;
}
export async function login(store: Store, input: unknown): Promise<Row> {
  const o = v.object(input, ["alias", "password"]);
  const alias = v.text(o.alias, "alias", 1, 24);
  const password = v.password(o.password);
  const row = store.one(
    "SELECT * FROM users WHERE alias_key=? AND deleted_at IS NULL",
    alias.normalize("NFKC").toLocaleLowerCase("es"),
  );
  if (!row) {
    await derive(password, Buffer.alloc(16));
    throw new Problem(
      401,
      "invalid_login",
      "Alias o frase de acceso incorrectos.",
    );
  }
  if (!(await verifyPassword(password, String(row.password_hash))))
    throw new Problem(
      401,
      "invalid_login",
      "Alias o frase de acceso incorrectos.",
    );
  return row;
}
export function audit(
  store: Store,
  actor: string | null,
  action: string,
  resource: string,
) {
  store.run(
    "INSERT INTO audit VALUES (?,?,?,?,?)",
    randomUUID(),
    actor,
    action,
    resource,
    Date.now(),
  );
}
