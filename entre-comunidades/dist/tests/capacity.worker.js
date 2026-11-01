import { parentPort, workerData } from "node:worker_threads";
import { Store } from "../server/database.js";
import { Communities } from "../server/service.js";
const data = workerData;
const store = new Store(data.path);
const signal = new Int32Array(data.signal);
parentPort.postMessage({ ready: true });
Atomics.wait(signal, 0, 0);
try {
    parentPort.postMessage({
        result: new Communities(store).joinEvent(data.uid, data.event, 1),
    });
}
catch (error) {
    parentPort.postMessage({
        error: error instanceof Error ? error.message : "error",
    });
}
finally {
    store.close();
    parentPort.close();
}
