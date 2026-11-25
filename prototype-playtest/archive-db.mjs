const dbName = 'bet-arena-round-archive';
export const stores = ['session', 'rounds', 'frames'];
let database;

export function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openArchive() {
  if (!database) {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('session');
      db.createObjectStore('rounds', { keyPath: ['sessionId', 'roundNumber'] });
      db.createObjectStore('frames');
    };
    database = requestResult(request).then((db) => {
      db.onversionchange = () => { db.close(); database = null; };
      return db;
    }, (error) => { database = null; throw error; });
  }
  return database;
}

export async function archiveTransaction(mode, work) {
  const db = await openArchive();
  const transaction = db.transaction(stores, mode);
  const complete = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? Error('试玩事务已中止。'));
  });
  // Observe the abort even if an individual request rejects first.
  void complete.catch(() => {});
  try {
    const result = await work(...stores.map((name) => transaction.objectStore(name)));
    await complete;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction already stopped. */ }
    throw error;
  }
}

export function prefixRange(sessionId, roundNumber) {
  const key = roundNumber === undefined ? [sessionId] : [sessionId, roundNumber];
  return IDBKeyRange.bound(key, [...key, []], false, true);
}
