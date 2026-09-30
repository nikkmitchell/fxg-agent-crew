/**
 * WHAT RUNS IN A LIVE PIECE'S WORKER (shared/piece-wire.ts has the why).
 *
 * Plain JavaScript in a string, because a worker made from a data: URL is the
 * whole point (an opaque origin of its own) and a data: URL cannot import our
 * bundle. The page puts `const importPiece = (url) => import(url);` in front
 * and starts it; the tests run the very same string with a stand-in `self` and
 * `importPiece` (src/kit/pieces/host.test.ts), so what is tested is what ships.
 *
 * It gives the piece its `saha` object and turns every call into a message.
 * Nothing here is trusted by the page: the page checks every message again.
 * A handler that throws is reported, and the piece carries on.
 */
export const PIECE_RUNTIME = String.raw`
"use strict";
let nextId = 1;
let started = false;
let state = {};
const parts = new Map();
const listeners = { state: new Set(), event: new Set(), press: new Set() };
const send = (message) => self.postMessage(message);
const report = (error) => send({ t: "log", text: "error: " + String((error && error.stack) || error).slice(0, 480) });
const call = (fn, ...args) => { try { const out = fn(...args); if (out && typeof out.catch === "function") out.catch(report); } catch (error) { report(error); } };
const plain = (value) => { try { return JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch (error) { return null; } };

function part(id) {
  const handlers = new Set();
  const node = {
    id,
    set(spec) { send({ t: "set", id, spec: plain(spec) }); return node; },
    tween(to, ms) { send({ t: "tween", id, to: plain(to), ms: Number(ms) || 0 }); return node; },
    add(spec) { return saha.add(Object.assign({}, spec, { parent: id })); },
    remove() { parts.delete(id); send({ t: "remove", id }); },
    on(name, fn) {
      if (name !== "press" || typeof fn !== "function") return () => {};
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
  };
  parts.set(id, { node, handlers });
  return node;
}

const saha = {
  api: 1,
  env: null,
  space: null,
  you: null,
  get state() { return Object.assign({}, state); },
  add(spec) {
    const id = nextId++;
    const node = part(id);
    send({ t: "add", id, spec: plain(spec) });
    return node;
  },
  set(key, value) {
    const v = plain(value);
    if (v === null) delete state[key]; else state[key] = v;
    send({ t: "state", k: String(key), v });
    for (const fn of listeners.state) call(fn, String(key), v, saha.you ? saha.you.id : null);
  },
  emit(name, data) {
    const d = plain(data);
    send({ t: "emit", name: String(name), data: d });
    // A moment reaches this piece too, so one handler can play it for everyone, you included.
    for (const fn of listeners.event) call(fn, String(name), d, saha.you ? saha.you.id : null);
  },
  sound(sound) { send({ t: "sound", sound: plain(sound) }); },
  on(name, fn) {
    const set = listeners[name];
    if (!set || typeof fn !== "function") return () => {};
    set.add(fn);
    return () => set.delete(fn);
  },
  log(...words) { send({ t: "log", text: words.map((word) => typeof word === "string" ? word : JSON.stringify(word)).join(" ").slice(0, 480) }); },
};

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.t === "start") {
    if (started) return;
    started = true;
    saha.env = message.env;
    saha.space = message.space;
    saha.you = message.you || null;
    state = Object.assign({}, message.state || {});
    Promise.resolve()
      .then(() => importPiece(message.url))
      .then((module) => {
        const start = module && module.default;
        if (typeof start !== "function") throw new Error("A live piece must export default function (saha) { ... }");
        return start(saha);
      })
      .then(() => send({ t: "ready" }))
      .catch((error) => send({ t: "failed", text: String((error && error.stack) || error).slice(0, 480) }));
  } else if (message.t === "press") {
    const entry = parts.get(message.id);
    const info = { by: message.by || null, hand: message.hand, point: message.point };
    if (entry) for (const fn of entry.handlers) call(fn, info);
    if (entry) for (const fn of listeners.press) call(fn, entry.node, info);
  } else if (message.t === "state") {
    if (message.v === null) delete state[message.k]; else state[message.k] = message.v;
    for (const fn of listeners.state) call(fn, message.k, message.v, message.by || null);
  } else if (message.t === "event") {
    for (const fn of listeners.event) call(fn, message.name, message.data, message.from || null);
  } else if (message.t === "ping") {
    send({ t: "pong", n: message.n });
  }
});
`;

/** The worker's whole source: the runtime, importing the piece by its address. */
export function pieceWorkerSource(): string {
  return `const importPiece = (url) => import(url);\n${PIECE_RUNTIME}`;
}
