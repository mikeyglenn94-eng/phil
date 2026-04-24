// Tiny IndexedDB-backed FIFO queue for offline-tolerant autosaves.
// One database, one object store, auto-incrementing keys.

const DB_NAME = "mg-coach-app";
const STORE = "autosave-queue";
const VERSION = 1;

export type QueuedAutosave = {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  body: unknown;
  enqueuedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function enqueue(payload: QueuedAutosave): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("enqueue failed"));
    });
  } catch (err) {
    // Last-resort fallback so we never lose the user's input.
    try {
      const raw = sessionStorage.getItem("mg.autosave.fallback");
      const arr = raw ? (JSON.parse(raw) as QueuedAutosave[]) : [];
      arr.push(payload);
      sessionStorage.setItem("mg.autosave.fallback", JSON.stringify(arr));
    } catch { /* swallow */ }
    console.warn("[idb-queue] enqueue fell back to sessionStorage:", err);
  }
}

export async function count(): Promise<number> {
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("count failed"));
    });
  } catch {
    try {
      const raw = sessionStorage.getItem("mg.autosave.fallback");
      return raw ? (JSON.parse(raw) as QueuedAutosave[]).length : 0;
    } catch { return 0; }
  }
}

/** Drains queued items in FIFO order. Stops on the first handler rejection
 *  so failed items remain enqueued for the next drain. */
export async function drain(handler: (item: QueuedAutosave) => Promise<void>): Promise<number> {
  let drained = 0;
  try {
    const db = await openDb();
    // Read all keys + values upfront so we can iterate without holding a tx.
    const items = await new Promise<{ key: IDBValidKey; value: QueuedAutosave }[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const out: { key: IDBValidKey; value: QueuedAutosave }[] = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          out.push({ key: cursor.primaryKey, value: cursor.value as QueuedAutosave });
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error("cursor failed"));
    });

    for (const { key, value } of items) {
      try {
        await handler(value);
      } catch {
        return drained; // stop, leave remaining items in the queue
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
      });
      drained += 1;
    }
  } catch (err) {
    console.warn("[idb-queue] drain error:", err);
  }
  return drained;
}
