import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./database.js";
export function cleanup(store, now = Date.now()) {
    const day = 86400000;
    return store.transaction(() => {
        // Remove expired report references first, so source messages can be purged in this run.
        const reports = store.run("DELETE FROM reports WHERE (status='open' AND created_at<?) OR (status!='open' AND resolved_at<?)", now - 180 * day, now - 90 * day).changes;
        const result = {
            reports,
            sessions: store.run("DELETE FROM sessions WHERE expires_at<=?", now)
                .changes,
            notifications: store.run("DELETE FROM notifications WHERE created_at<?", now - 90 * day).changes,
            messages: store.run("DELETE FROM messages WHERE event_id IN (SELECT id FROM events WHERE ends_at<?) AND id NOT IN (SELECT message_id FROM reports WHERE message_id IS NOT NULL)", now - 30 * day).changes,
            rateLimits: store.run("DELETE FROM rate_limits WHERE reset_at<?", now - day).changes,
            audit: store.run("DELETE FROM audit WHERE created_at<?", now - 180 * day)
                .changes,
        };
        store.run("UPDATE users SET age_declared_at=0,consent_at=0,policy_version='erased' WHERE deleted_at IS NOT NULL AND deleted_at<?", now - 180 * day);
        return result;
    });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const store = new Store(process.env.ENTRE_DB ?? resolve(root, "runtime/entre.sqlite3"));
    try {
        console.log(JSON.stringify(cleanup(store)));
    }
    finally {
        store.close();
    }
}
