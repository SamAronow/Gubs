// Thin storage layer with two interchangeable backends:
//   - Firebase Realtime Database (when firebase-config.js has a databaseURL)
//   - a localStorage-backed stand-in for practice / testing (also forced by ?local=1)
// Both expose: watch(path, cb), read(path), write(path, value), transact(path, fn).

import { firebaseConfig, DB_ROOT } from '../firebase-config.js';

const params = new URLSearchParams(location.search);
export const LOCAL = params.has('local') || !firebaseConfig.databaseURL;

// Turn Firebase errors into something a player can act on.
export function explain(e) {
  const m = String((e && (e.code || e.message)) || e);
  if (/permission/i.test(m)) return 'The database refused access. In the Firebase console, open Realtime Database -> Rules and allow read/write under "gubs-v2" (see README).';
  return 'Could not reach the database: ' + m;
}

let backend;

async function firebaseBackend() {
  const V = '10.12.2';
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const db = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
  const app = initializeApp(firebaseConfig);
  const database = db.getDatabase(app);
  const r = path => db.ref(database, `${DB_ROOT}/${path}`);
  return {
    watch: (path, cb, onError) => db.onValue(r(path), snap => cb(snap.val()), err => onError && onError(err)),
    read: async path => (await db.get(r(path))).val(),
    write: (path, value) => db.set(r(path), value),
    // fn(current) returns the new value, or undefined to abort.
    transact: async (path, fn) => {
      const res = await db.runTransaction(r(path), cur => fn(cur), { applyLocally: false });
      return { committed: res.committed, value: res.snapshot.val() };
    },
  };
}

function localBackend() {
  const KEY = 'gubs-local-db';
  const watchers = new Set();
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const at = (tree, path) => path.split('/').reduce((n, k) => (n == null ? null : n[k]), tree) ?? null;
  const put = (tree, path, value) => {
    const keys = path.split('/'); let n = tree;
    keys.slice(0, -1).forEach(k => { n = n[k] ??= {}; });
    if (value == null) delete n[keys.at(-1)]; else n[keys.at(-1)] = value;
  };
  const fire = () => { const t = load(); watchers.forEach(w => w.cb(at(t, w.path))); };
  const save = tree => { localStorage.setItem(KEY, JSON.stringify(tree)); fire(); };
  window.addEventListener('storage', e => { if (e.key === KEY) fire(); });
  return {
    watch: (path, cb) => { const w = { path, cb }; watchers.add(w); cb(at(load(), path)); return () => watchers.delete(w); },
    read: async path => at(load(), path),
    write: async (path, value) => { const t = load(); put(t, path, value); save(t); },
    transact: async (path, fn) => {
      const t = load(); const next = fn(at(t, path));
      if (next === undefined) return { committed: false, value: at(t, path) };
      put(t, path, next); save(t);
      return { committed: true, value: next };
    },
  };
}

export async function net() {
  if (!backend) backend = LOCAL ? localBackend() : await firebaseBackend();
  return backend;
}

// ---------- identity (per browser; ?as=2 gives a second identity for testing) ----------

const suffix = params.get('as') || '';
export function myId() {
  const k = 'gubs-pid' + suffix;
  let id = localStorage.getItem(k);
  if (!id) { id = 'u' + Math.random().toString(36).slice(2, 10); localStorage.setItem(k, id); }
  return id;
}
export const myName = () => localStorage.getItem('gubs-name' + suffix) || '';
export const setMyName = n => localStorage.setItem('gubs-name' + suffix, n);

// Keep ?local / ?as when moving between pages.
export function link(page, extra = {}) {
  const q = new URLSearchParams(extra);
  for (const k of ['local', 'as']) if (params.has(k)) q.set(k, params.get(k));
  const s = q.toString();
  return page + (s ? '?' + s : '');
}
