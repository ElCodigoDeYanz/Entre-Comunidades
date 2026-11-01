import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildApplication } from "./app.js";
import { cleanup } from "./maintenance.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const port = Number(arg("--port") ?? process.env.ENTRE_PORT ?? 8004);
const host = arg("--host") ?? process.env.ENTRE_HOST ?? "127.0.0.1";
const demo = process.env.ENTRE_DEMO !== "0";
const secureCookie = process.env.ENTRE_SECURE_COOKIE === "1";
const publicOrigin = process.env.ENTRE_PUBLIC_ORIGIN;
if (process.env.NODE_ENV === "production" &&
    (demo || !secureCookie || !publicOrigin?.startsWith("https://")))
    throw new Error("Production configuration requires demo disabled, Secure cookies and an explicit HTTPS origin. Additional production validation is still required.");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
const app = await buildApplication({
    dbPath: process.env.ENTRE_DB ?? resolve(root, "runtime/entre.sqlite3"),
    publicDir: resolve(root, "public"),
    demo,
    secureCookie,
    ...(publicOrigin ? { publicOrigin } : {}),
});
cleanup(app.store);
const maintenance = setInterval(() => {
    try {
        cleanup(app.store);
    }
    catch {
        console.error("maintenance_failed");
    }
}, 3600000);
maintenance.unref();
app.server.listen(port, host, () => console.log(`Entre · ${demo ? "demostración sintética" : "piloto local"} · http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
        app.server.close(() => {
            app.store.close();
            process.exit(0);
        });
    });
