// Thumbnail cache on disk. It holds the bytes exactly as the server stores them,
// i.e. still encrypted under each photo's own key, so nothing readable is ever
// written to the browser's storage and the cache is useless without the passphrase.
const DB_NAME = 'kura-vault';
const STORE = 'thumbs';
const MAX_ENTRIES = 5000;
const PRUNE_EVERY = 200;

interface Entry {
  id: string;
  data: ArrayBuffer;
  at: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
// Used when IndexedDB is unavailable (some private windows, storage blocked)
const memory = new Map<string, ArrayBuffer>();
let writesSincePrune = 0;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('at', 'at');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getThumbCiphertext(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return memory.get(id) ?? null;
  try {
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as Entry | undefined)?.data ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function hasThumbCiphertext(id: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return memory.has(id);
  try {
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).count(id);
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function putThumbCiphertext(id: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(id, data);
    if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
    return;
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, data, at: Date.now() } satisfies Entry);
    await done(tx);
    if (++writesSincePrune >= PRUNE_EVERY) {
      writesSincePrune = 0;
      void prune(db);
    }
  } catch {
    // Quota exceeded or storage revoked: the cache is an optimisation, never required
  }
}

/** Drop the oldest entries beyond the cap. */
async function prune(db: IDBDatabase): Promise<void> {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let excess = countRequest.result - MAX_ENTRIES;
      if (excess <= 0) return;
      const cursorRequest = store.index('at').openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || excess <= 0) return;
        cursor.delete();
        excess--;
        cursor.continue();
      };
    };
    await done(tx);
  } catch {
    // best effort
  }
}

export async function removeThumbCiphertext(id: string): Promise<void> {
  memory.delete(id);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await done(tx);
  } catch {
    // best effort
  }
}

export async function clearThumbStore(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  } catch {
    // best effort
  }
}
