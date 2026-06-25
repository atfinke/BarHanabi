const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const PORT = 3291;

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

async function createRoom(base) {
  const response = await fetch(`${base}/api/rooms`, { method: "POST" });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

async function openEvents(base, code, seat) {
  const controller = new AbortController();
  const response = await fetch(`${base}/events?code=${code}&seat=${seat}`, {
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async nextState() {
      while (true) {
        const delimiter = buffer.indexOf("\n\n");
        if (delimiter !== -1) {
          const frame = buffer.slice(0, delimiter);
          buffer = buffer.slice(delimiter + 2);
          if (!frame.includes("event: state")) continue;
          const data = frame.split("\n").find((line) => line.startsWith("data: "));
          assert.ok(data, `Missing data line in frame: ${frame}`);
          return JSON.parse(data.slice(6));
        }

        const { done, value } = await reader.read();
        if (done) {
          throw new Error("event stream closed before state arrived");
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close() {
      controller.abort();
    }
  };
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("room state reports other-player presence as event streams connect and close", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  const base = baseUrl(PORT);
  await waitForServer(server, base);

  const room = await createRoom(base);
  const seatA = await openEvents(base, room.code, "A");
  t.after(() => seatA.close());

  const onlyA = await withTimeout(seatA.nextState(), 1000, "initial seat A state");
  assert.deepEqual(onlyA.presence, { A: true, B: false });

  const seatB = await openEvents(base, room.code, "B");
  t.after(() => seatB.close());

  const bothFromA = await withTimeout(seatA.nextState(), 1000, "seat B connection update");
  assert.deepEqual(bothFromA.presence, { A: true, B: true });

  const bothFromB = await withTimeout(seatB.nextState(), 1000, "seat B initial state");
  assert.deepEqual(bothFromB.presence, { A: true, B: true });

  seatB.close();

  const afterBLeaves = await withTimeout(seatA.nextState(), 1000, "seat B disconnect update");
  assert.deepEqual(afterBLeaves.presence, { A: true, B: false });
});
