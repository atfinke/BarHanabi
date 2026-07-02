const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { spawn } = require("node:child_process");

const PORT = 3298;
const BASE = "http://127.0.0.1:" + PORT;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (child.exitCode !== null) throw new Error("server exited before becoming ready");
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error("server did not become ready");
}

async function api(path, body) {
  const response = await fetch(`${BASE}${path}`, body ? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  } : undefined);
  const payload = await response.json();
  assert.ok(response.ok, `${path}: ${payload.error || response.status}`);
  return payload;
}

async function readState(code, seat) {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/events?code=${code}&seat=${seat}`, { signal: controller.signal });
  const reader = response.body.getReader();
  let text = "";
  while (!text.includes("data: ")) {
    const { value } = await reader.read();
    text += new TextDecoder().decode(value);
  }
  controller.abort();
  return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6));
}

// Drive a short real game: several plays and discards, then a misplay to end it.
async function playScriptedGame() {
  const { code } = await api("/api/rooms", { bombs: 0 });
  for (let turn = 0; turn < 14; turn += 1) {
    const probe = await readState(code, "A");
    if (probe.status === "ended") break;
    const actor = probe.turnSeat;
    const other = actor === "A" ? "B" : "A";
    const view = await readState(code, other);
    const hand = view.players.find((p) => p.seat === actor).hand;
    const playable = hand.find((c) => c.color && view.fireworks[c.color] + 1 === c.rank);
    if (turn >= 10) {
      const unplayable = hand.find((c) => c.color && view.fireworks[c.color] + 1 !== c.rank);
      if (unplayable) {
        await api("/api/actions", { type: "play", code, viewerSeat: actor, cardId: unplayable.id });
        continue;
      }
    }
    if (playable) {
      await api("/api/actions", { type: "play", code, viewerSeat: actor, cardId: playable.id });
    } else {
      const dead = hand.find((c) => c.color && c.rank <= view.fireworks[c.color]);
      await api("/api/actions", { type: "discard", code, viewerSeat: actor, cardId: (dead || hand[0]).id });
    }
  }
  const final = await readState(code, "A");
  assert.equal(final.status, "ended", "scripted game must end");
  return api(`/api/replay?code=${code}`);
}

// ---- Minimal DOM for executing the real client bundle ----

function syncEdges(el) {
  el.firstElementChild = el.children[0] || null;
  el.lastElementChild = el.children[el.children.length - 1] || null;
}

function matches(el, part) {
  for (const m of part.matchAll(/\.([\w-]+)/g)) {
    if (!el.classList.contains(m[1])) return false;
  }
  const attr = part.match(/\[data-([\w-]+)(?:="([^"]*)")?\]/);
  if (attr) {
    const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (attr[2] === undefined ? el.dataset[key] === undefined : el.dataset[key] !== attr[2]) return false;
  }
  return /[.\[]/.test(part);
}

function descendants(el, out = []) {
  for (const child of el.children || []) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function query(el, selector, all) {
  let pool = [el];
  for (const part of selector.trim().split(/\s+/)) {
    const next = [];
    for (const scope of pool) {
      for (const cand of descendants(scope)) {
        if (matches(cand, part)) next.push(cand);
      }
    }
    pool = next;
  }
  return all ? pool : (pool[0] || null);
}

function fakeElement() {
  const classes = new Set();
  const el = {
    checked: false, disabled: false, children: [], dataset: {},
    style: { setProperty() {} }, offsetWidth: 40, offsetHeight: 64,
    textContent: "", value: "",
    classList: {
      add(...n) { n.forEach((x) => classes.add(x)); },
      remove(...n) { n.forEach((x) => classes.delete(x)); },
      contains(n) { return classes.has(n); },
      toggle(n, f) { const v = f === undefined ? !classes.has(n) : Boolean(f); if (v) classes.add(n); else classes.delete(n); return v; },
      toString() { return [...classes].join(" "); }
    },
    addEventListener() {}, dispatchEvent() { return true; },
    append(...c) { c.forEach((x) => { x.remove?.(); el.children.push(x); x.parentElement = el; }); syncEdges(el); },
    replaceChildren(...c) {
      el.children.forEach((x) => { x.parentElement = null; });
      c.forEach((x) => { x.remove?.(); x.parentElement = el; });
      el.children = c;
      syncEdges(el);
    },
    insertBefore(c, before) {
      c.remove?.();
      const rest = el.children.filter((x) => x !== c);
      const i = before ? rest.indexOf(before) : -1;
      if (i === -1) rest.push(c); else rest.splice(i, 0, c);
      el.children = rest;
      c.parentElement = el;
      syncEdges(el);
    },
    remove() {
      if (!el.parentElement) return;
      el.parentElement.children = el.parentElement.children.filter((x) => x !== el);
      syncEdges(el.parentElement);
      el.parentElement = null;
    },
    querySelectorAll(sel) { return query(el, sel, true); },
    querySelector(sel) { return query(el, sel, false); },
    contains() { return false; },
    getBoundingClientRect() { return { left: 10, top: 10, width: 100, height: 100 }; },
    closest() { return fakeElement(); },
    setAttribute() {}
  };
  Object.defineProperty(el, "className", {
    get() { return [...classes].join(" "); },
    set(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); }
  });
  return el;
}

function loadClient(replay) {
  const elements = new Map();
  let timerId = 0;
  const pendingTimers = new Map();
  const body = fakeElement();
  const document = {
    querySelector(sel) {
      if (!elements.has(sel)) elements.set(sel, fakeElement());
      return elements.get(sel);
    },
    querySelectorAll(sel) {
      const roots = ["#selfHand", "#opponentHand", "#neededDiscard", "#spentDiscard", "#fireworks"]
        .map((s) => elements.get(s)).filter(Boolean);
      roots.push(body);
      const seen = new Set();
      const out = [];
      for (const root of roots) {
        for (const hit of query(root, sel, true)) {
          if (!seen.has(hit)) { seen.add(hit); out.push(hit); }
        }
      }
      return out;
    },
    createElement() { return fakeElement(); },
    body
  };
  const sandbox = {
    Element: function Element() {},
    document,
    window: {
      addEventListener() {},
      location: { hash: "", pathname: "/" },
      history: { replaceState() {} },
      requestAnimationFrame(cb) { cb(0); },
      cancelAnimationFrame() {},
      matchMedia() { return { matches: false, addEventListener() {} }; },
      setTimeout(cb, ms) { const id = ++timerId; pendingTimers.set(id, { cb, ms }); return id; },
      clearTimeout(id) { pendingTimers.delete(id); },
      getComputedStyle() { return { transform: "none", borderLeftWidth: "0px", borderTopWidth: "0px", borderRightWidth: "0px", paddingLeft: "0px", paddingTop: "0px", paddingRight: "0px", columnGap: "5px", rowGap: "5px", gap: "5px" }; }
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    URLSearchParams,
    requestAnimationFrame(cb) { cb(0); },
    getComputedStyle() { return { transform: "none" }; },
    setTimeout(cb) { const id = ++timerId; pendingTimers.set(id, { cb, ms: 0 }); return id; },
    clearTimeout(id) { pendingTimers.delete(id); },
    console,
    fetch: async () => { throw new Error("no fetch in fuzz"); },
    EventSource: function () { return { addEventListener() {}, close() {} }; }
  };

  vm.runInNewContext(
    `${fs.readFileSync("public/app.js", "utf8")}\nglobalThis.__client = { state, setReplayIndex, stepReplay, replayTimelineEvents, render, toggleReplayHandView, replayHandView };`,
    sandbox
  );
  const client = sandbox.__client;

  client.state.mySeat = "B";
  client.state.room = {
    code: replay.code, status: "ended", turnSeat: "A",
    maxHints: 8, maxBombs: 0,
    players: ["A", "B"].map((seat) => ({ seat, name: seat, hand: [] })),
    hints: 0, bombs: 0, deckCount: 0, discard: [], fireworks: {}, colors: replay.colors
  };
  client.state.replay.data = replay;
  client.state.replay.isOpen = true;
  client.state.replay.handViews = { B: "knowledge", A: "cards" };
  client.state.hasRenderedRoom = true;

  return { client, elements, pendingTimers };
}

function brokenBacks(client, elements) {
  const out = [];
  for (const [seat, sel] of [["B", "#selfHand"], ["A", "#opponentHand"]]) {
    if (client.replayHandView(seat) !== "knowledge") continue;
    for (const el of elements.get(sel)?.children || []) {
      if (el.classList.contains("is-revealed")) continue;
      const grid = el.querySelector(".knowledge-grid");
      const dots = grid ? grid.querySelectorAll("[data-knowledge-key]").length : 0;
      if (!grid || dots === 0) out.push(`${sel} ${el.dataset.cardId}`);
    }
  }
  return out;
}

test("scrubbing a real replay never breaks knowledge grids or crashes", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);
  const replay = await playScriptedGame();
  assert.ok(replay.actionEvents.length >= 5, "game must produce a timeline");

  for (const seedStart of [1, 42, 1234]) {
    const { client, elements, pendingTimers } = loadClient(replay);
    const events = client.replayTimelineEvents();
    client.state.replay.index = 0;
    client.render();

    let seed = seedStart;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const history = [];
    for (let op = 0; op < 250; op += 1) {
      const roll = rnd();
      if (roll < 0.38) { client.stepReplay(1); history.push("step(+1)"); }
      else if (roll < 0.66) { client.stepReplay(-1); history.push("step(-1)"); }
      else if (roll < 0.78) { const target = Math.floor(rnd() * events.length); client.setReplayIndex(target); history.push(`jump(${target})`); }
      else if (roll < 0.86) { const seat = rnd() < 0.5 ? "A" : "B"; client.toggleReplayHandView(seat); history.push(`flip(${seat})`); }
      else {
        const entries = [...pendingTimers.entries()].sort((a, b) => a[1].ms - b[1].ms);
        const count = Math.floor(rnd() * (entries.length + 1));
        for (let i = 0; i < count; i += 1) {
          pendingTimers.delete(entries[i][0]);
          entries[i][1].cb();
        }
        history.push(`flush(${count})`);
      }
      const broken = brokenBacks(client, elements);
      assert.deepEqual(broken, [], `seed ${seedStart}: gridless backs after ${history.slice(-6).join(" → ")}`);
    }
  }
});
