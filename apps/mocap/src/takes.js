// Recorded takes, kept in the browser (IndexedDB). Rigger reads the same
// store, so a saved take shows up in its 4 ANIMATE list for the Human
// skeleton without any files. A take: { id, name, created, fps, frames
// (Float32Array, FRAME floats each), calib, inT, outT, legs, clip (the
// baked AnimationClip as JSON, on Rigger's Human template skeleton) }.
export const DB = 'vros-mocap', STORE = 'takes';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const listTakes = async () => ((await run('readonly', (s) => s.getAll())) || []).sort((a, b) => a.created - b.created);
export const saveTake = (take) => run('readwrite', (s) => s.put(take));
export const deleteTake = (id) => run('readwrite', (s) => s.delete(id));
