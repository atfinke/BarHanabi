const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const PORT = 3223;
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(port) {
  return "http://127.0.0.1:" + port;
}

async function waitForServer(process, base) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (process.exitCode !== null) {
      throw new Error("server exited before becoming ready");
    }
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error("server did not become ready");
}

async function createRoom(base, settings = {}) {
  const response = await fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

async function readState(base, code, seat = "A") {
  const controller = new AbortController();
  const response = await fetch(`${base}/events?code=${code}&seat=${seat}`, {
    signal: controller.signal
  });
  const reader = response.body.getReader();
  let text = "";
  while (!text.includes("\n\n")) {
    const { value } = await reader.read();
    text += new TextDecoder().decode(value);
  }
  controller.abort();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine.slice(6));
}

async function postAction(base, payload) {
  const response = await fetch(`${base}/api/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  return { response, body };
}

test("custom setup settings shape room state and survive reset", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  const base = baseUrl(PORT);
  await waitForServer(server, base);

  const room = await createRoom(base, { hints: 4, bombs: 1, rainbow: false });
  const initial = await readState(base, room.code, "A");

  assert.equal(initial.hints, 4);
  assert.equal(initial.maxHints, 4);
  assert.equal(initial.bombs, 0);
  assert.equal(initial.maxBombs, 1);
  assert.equal(initial.maxScore, 25);
  assert.equal(initial.deckCount, 40);
  assert.equal("rainbow" in initial.fireworks, false);
  assert.equal(
    initial.players.flatMap((player) => player.hand).some((card) => card.color === "rainbow"),
    false
  );

  const reset = await postAction(base, {
    code: room.code,
    viewerSeat: "A",
    type: "reset"
  });

  assert.equal(reset.response.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.hints, 4);
  assert.equal(reset.body.maxHints, 4);
  assert.equal(reset.body.maxBombs, 1);
  assert.equal(reset.body.maxScore, 25);
  assert.equal(reset.body.deckCount, 40);
  assert.equal("rainbow" in reset.body.fireworks, false);
});

test("reset alternates the starting player while preserving setup settings", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT + 1) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  const base = baseUrl(PORT + 1);
  await waitForServer(server, base);

  const room = await createRoom(base, { hints: 4, bombs: 1, rainbow: false });
  const initial = await readState(base, room.code, "A");
  assert.equal(initial.turnSeat, "A");

  const firstReset = await postAction(base, {
    code: room.code,
    viewerSeat: "A",
    type: "reset"
  });

  assert.equal(firstReset.response.status, 200, JSON.stringify(firstReset.body));
  assert.equal(firstReset.body.turnSeat, "B");
  assert.equal(firstReset.body.maxHints, 4);
  assert.equal(firstReset.body.maxBombs, 1);
  assert.equal(firstReset.body.maxScore, 25);

  const secondReset = await postAction(base, {
    code: room.code,
    viewerSeat: "B",
    type: "reset"
  });

  assert.equal(secondReset.response.status, 200, JSON.stringify(secondReset.body));
  assert.equal(secondReset.body.turnSeat, "A");

  const thirdReset = await postAction(base, {
    code: room.code,
    viewerSeat: "A",
    type: "reset"
  });

  assert.equal(thirdReset.response.status, 200, JSON.stringify(thirdReset.body));
  assert.equal(thirdReset.body.turnSeat, "B");
});

test("setup settings are sanitized conservatively", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT + 2) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  const base = baseUrl(PORT + 2);
  await waitForServer(server, base);

  const room = await createRoom(base, { hints: 99, bombs: -1, rainbow: "nope" });
  const state = await readState(base, room.code, "A");

  assert.equal(state.hints, 8);
  assert.equal(state.maxHints, 8);
  assert.equal(state.maxBombs, 0);
  assert.equal(state.maxScore, 30);
  assert.equal(state.deckCount, 50);
  assert.equal(state.fireworks.rainbow, 0);
});

test("setup allows zero bombs for no-mistake games", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT + 3) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  const base = baseUrl(PORT + 3);
  await waitForServer(server, base);

  const room = await createRoom(base, { bombs: 0 });
  const initial = await readState(base, room.code, "A");

  assert.equal(initial.bombs, 0);
  assert.equal(initial.maxBombs, 0);

  const reset = await postAction(base, {
    code: room.code,
    viewerSeat: "A",
    type: "reset"
  });

  assert.equal(reset.response.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.bombs, 0);
  assert.equal(reset.body.maxBombs, 0);
});
