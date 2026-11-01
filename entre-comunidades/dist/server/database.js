import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, alias TEXT NOT NULL, alias_key TEXT NOT NULL UNIQUE,
 bio TEXT NOT NULL DEFAULT '', zone TEXT NOT NULL, interests TEXT NOT NULL DEFAULT '[]',
 password_hash TEXT NOT NULL, age_declared_at INTEGER NOT NULL,
 policy_version TEXT NOT NULL, consent_at INTEGER NOT NULL,
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 created_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS communities (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, interest TEXT NOT NULL,
 zone TEXT NOT NULL, privacy TEXT NOT NULL CHECK(privacy IN ('public','private')),
 rules TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), archived INTEGER NOT NULL DEFAULT 0,
 synthetic INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
 community_id TEXT NOT NULL REFERENCES communities(id), user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','removed')),
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','moderator','member')),
 created_at INTEGER NOT NULL, PRIMARY KEY(community_id,user_id)
);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY,community_id TEXT NOT NULL REFERENCES communities(id),
 host_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,
 starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 100),
 venue_id TEXT NOT NULL,accessibility TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','cancelled','completed')),
 revision INTEGER NOT NULL DEFAULT 1,synthetic INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,
 CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS events_discovery ON events(status,starts_at);
CREATE TABLE IF NOT EXISTS registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL REFERENCES events(id),
 user_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('going','waiting','cancelled')),
 confirmed_revision INTEGER NOT NULL,joined_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(event_id,user_id)
);
CREATE TRIGGER IF NOT EXISTS capacity_insert BEFORE INSERT ON registrations
 WHEN NEW.status='going' AND (SELECT COUNT(*) FROM registrations WHERE event_id=NEW.event_id AND status='going') >= (SELECT capacity FROM events WHERE id=NEW.event_id)
 BEGIN SELECT RAISE(ABORT,'capacity exceeded'); END;
CREATE TRIGGER IF NOT EXISTS capacity_update BEFORE UPDATE OF status ON registrations
 WHEN NEW.status='going' AND OLD.status!='going' AND (SELECT COUNT(*) FROM registrations WHERE event_id=NEW.event_id AND status='going') >= (SELECT capacity FROM events WHERE id=NEW.event_id)
 BEGIN SELECT RAISE(ABORT,'capacity exceeded'); END;
CREATE TRIGGER IF NOT EXISTS capacity_reduce BEFORE UPDATE OF capacity ON events
 WHEN NEW.capacity < (SELECT COUNT(*) FROM registrations WHERE event_id=NEW.id AND status='going')
 BEGIN SELECT RAISE(ABORT,'capacity below reservations'); END;
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,created_at INTEGER NOT NULL,hidden_at INTEGER,deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_event ON messages(event_id,created_at);
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,
 text TEXT NOT NULL,event_id TEXT REFERENCES events(id),created_at INTEGER NOT NULL,read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
CREATE TABLE IF NOT EXISTS blocks (
 blocker_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,
 PRIMARY KEY(blocker_id,blocked_id),CHECK(blocker_id!=blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),
 community_id TEXT NOT NULL REFERENCES communities(id),subject_user_id TEXT NOT NULL REFERENCES users(id),
 message_id TEXT REFERENCES messages(id),reason TEXT NOT NULL,evidence TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
 resolution TEXT,resolver_id TEXT REFERENCES users(id),created_at INTEGER NOT NULL,resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),body TEXT NOT NULL,
 origin TEXT NOT NULL DEFAULT 'registration-only',created_at INTEGER NOT NULL,UNIQUE(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,resource_id TEXT NOT NULL,created_at INTEGER NOT NULL
);
PRAGMA user_version=1;
`;
export class Store {
    path;
    db;
    constructor(path) {
        this.path = path;
        if (path !== ":memory:")
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(path);
        this.db.exec(SCHEMA);
    }
    one(sql, ...values) {
        return this.db.prepare(sql).get(...values);
    }
    all(sql, ...values) {
        return this.db.prepare(sql).all(...values);
    }
    run(sql, ...values) {
        return this.db.prepare(sql).run(...values);
    }
    transaction(fn) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const result = fn();
            this.db.exec("COMMIT");
            return result;
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    close() {
        this.db.close();
    }
}
