// IndexedDB: meta(감싼 키), kv(암호화된 상태), media(암호화된 녹음/영상 조각)
let dbp;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('saenggibu-archive', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('meta'); d.createObjectStore('kv'); d.createObjectStore('media'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store); const rq = fn(s);
    t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
};
export const dbGet = (s, k) => tx(s, 'readonly', (o) => o.get(k));
export const dbPut = (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k));
export const dbDel = (s, k) => tx(s, 'readwrite', (o) => o.delete(k));
export const dbKeys = (s) => tx(s, 'readonly', (o) => o.getAllKeys());
export const dbClearAll = async () => { for (const s of ['meta', 'kv', 'media']) await tx(s, 'readwrite', (o) => o.clear()); };
