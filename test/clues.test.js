const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const PORT = 3219;
const BASE = "http://127.0.0.1:" + PORT;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(process) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (process.exitCode !== null) {
      throw new Error("server exited before becoming ready");
    }
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error("server did not become ready");
}

async function readState(code, seat) {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/events?code=${code}&seat=${seat}`, {
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

async function createRoom() {
  return fetch(`${BASE}/api/rooms`, { method: "POST" }).then((response) => response.json());
}

async function postAction(payload) {
  const response = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  return { response, body };
}

async function createRoomWithTargetHand(predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const room = await createRoom();
    const state = await readState(room.code, "A");
    const hand = state.players.find((player) => player.seat === "B").hand;
    const match = predicate(hand);
    if (match) {
      return { room, state, hand, match };
    }
  }
  throw new Error("Could not create a room with the requested target hand.");
}

function duplicateRankGroup(hand) {
  for (const rank of [1, 2, 3, 4, 5]) {
    const cards = hand.filter((card) => card.rank === rank);
    if (cards.length >= 2) return { rank, cards };
  }
  return null;
}

function invalidMixedPair(hand) {
  for (const first of hand) {
    if (first.color === "rainbow") continue;
    for (const second of hand) {
      if (first.id === second.id || second.color === "rainbow") continue;
      if (first.rank !== second.rank && first.color !== second.color) {
        return [first, second];
      }
    }
  }
  return null;
}

function singleRainbowWithPresentAndAbsentColor(hand) {
  const rainbows = hand.filter((card) => card.color === "rainbow");
  if (rainbows.length !== 1) return null;
  const presentColor = ["red", "yellow", "green", "blue", "white"].find((colorId) =>
    hand.some((card) => card.color === colorId)
  );
  const absentColor = ["red", "yellow", "green", "blue", "white"].find((colorId) =>
    hand.every((card) => card.color !== colorId)
  );
  return presentColor && absentColor ? { rainbow: rainbows[0], presentColor, absentColor } : null;
}

function rankClueLabel(rank, count) {
  const labels = {
    1: "One",
    2: "Two",
    3: "Three",
    4: "Four",
    5: "Five"
  };
  return `${labels[rank]}${count === 1 ? "" : "s"}`;
}

test("retired built-in clue-card actions are rejected by the system clue flow", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const room = await fetch(`${BASE}/api/rooms`, { method: "POST" }).then((response) => response.json());
  const giverState = await readState(room.code, "A");
  const receiverHand = giverState.players.find((player) => player.seat === "B").hand;
  const selected = receiverHand.slice(0, 2).map((card) => card.id);

  assert.equal("clueTokens" in giverState, false);
  assert.equal("clues" in giverState.players.find((player) => player.seat === "A").hand[0], false);

  const response = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: room.code,
      viewerSeat: "A",
      type: "clue-cards",
      targetSeat: "B",
      cardIds: selected,
      clueType: "rank",
      clueValue: String(receiverHand[0].rank)
    })
  });

  const body = await response.json();
  assert.equal(response.status, 400, JSON.stringify(body));

  const receiverState = await readState(room.code, "B");
  const receiver = receiverState.players.find((player) => player.seat === "B");
  const marked = receiver.hand.filter((card) => selected.includes(card.id));
  assert.equal(marked.length, 2);
  assert.equal("clueTokens" in receiverState, false);
  assert.equal("clues" in marked[0], false);
  assert.equal("rank" in marked[0], false, "receiver still must not see own rank");
  assert.equal("color" in marked[0], false, "receiver still must not see own color");
});

test("committed clues must name the exact selected rank or color set", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const duplicateRank = await createRoomWithTargetHand(duplicateRankGroup);
  const rank = duplicateRank.match.rank;
  const selectedRankIds = duplicateRank.match.cards.map((card) => card.id);
  const validRankClue = await postAction({
    code: duplicateRank.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: selectedRankIds,
    clue: { kind: "rank", value: rank }
  });

  assert.equal(validRankClue.response.status, 200, JSON.stringify(validRankClue.body));
  assert.deepEqual(validRankClue.body.clueSelection, {
    seat: "B",
    cardIds: selectedRankIds,
    committed: true,
    clue: {
      kind: "rank",
      value: rank,
      label: rankClueLabel(rank, selectedRankIds.length)
    }
  });

  const missingRank = await createRoomWithTargetHand(duplicateRankGroup);
  const missingRankClue = await postAction({
    code: missingRank.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: [missingRank.match.cards[0].id],
    clue: { kind: "rank", value: missingRank.match.rank }
  });

  assert.equal(missingRankClue.response.status, 400, JSON.stringify(missingRankClue.body));
  assert.equal(missingRankClue.body.error, `Select all ${missingRank.match.rank}s.`);

  const invalidPair = await createRoomWithTargetHand(invalidMixedPair);
  const invalidClue = await postAction({
    code: invalidPair.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: invalidPair.match.map((card) => card.id),
    clue: { kind: "rank", value: invalidPair.match[0].rank }
  });

  assert.equal(invalidClue.response.status, 400, JSON.stringify(invalidClue.body));
  assert.equal(invalidClue.body.error, "No valid clue for those cards.");

  const rainbowClueRoom = await createRoom();
  const rainbowState = await readState(rainbowClueRoom.code, "A");
  const targetCard = rainbowState.players.find((player) => player.seat === "B").hand[0];
  const rainbowClue = await postAction({
    code: rainbowClueRoom.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: [targetCard.id],
    clue: { kind: "color", value: "rainbow" }
  });

  assert.equal(rainbowClue.response.status, 400, JSON.stringify(rainbowClue.body));
  assert.equal(rainbowClue.body.error, "No valid clue for those cards.");
});

test("rainbow-only selections can be clued as absent colors only", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const validRainbowRoom = await createRoomWithTargetHand(singleRainbowWithPresentAndAbsentColor);
  const absentColorClue = await postAction({
    code: validRainbowRoom.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: [validRainbowRoom.match.rainbow.id],
    clue: { kind: "color", value: validRainbowRoom.match.absentColor }
  });

  assert.equal(absentColorClue.response.status, 200, JSON.stringify(absentColorClue.body));
  assert.deepEqual(absentColorClue.body.clueSelection, {
    seat: "B",
    cardIds: [validRainbowRoom.match.rainbow.id],
    committed: true,
    clue: {
      kind: "color",
      value: validRainbowRoom.match.absentColor,
      label: `${validRainbowRoom.match.absentColor[0].toUpperCase()}${validRainbowRoom.match.absentColor.slice(1)}`
    }
  });

  const invalidRainbowRoom = await createRoomWithTargetHand(singleRainbowWithPresentAndAbsentColor);
  const presentColorClue = await postAction({
    code: invalidRainbowRoom.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: [invalidRainbowRoom.match.rainbow.id],
    clue: { kind: "color", value: invalidRainbowRoom.match.presentColor }
  });

  assert.equal(presentColorClue.response.status, 400, JSON.stringify(presentColorClue.body));
  assert.equal(presentColorClue.body.error, `Select all ${invalidRainbowRoom.match.presentColor[0].toUpperCase()}${invalidRainbowRoom.match.presentColor.slice(1)}s.`);
});

test("live clue previews do not clear the previous committed clue", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const rankRoom = await createRoomWithTargetHand(duplicateRankGroup);
  const firstClue = await postAction({
    code: rankRoom.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: rankRoom.match.cards.map((card) => card.id),
    clue: { kind: "rank", value: rankRoom.match.rank }
  });

  assert.equal(firstClue.response.status, 200, JSON.stringify(firstClue.body));
  const committedClue = firstClue.body.clueSelection;
  const aCards = firstClue.body.players.find((player) => player.seat === "A").hand;
  const previewCardIds = [aCards[0].id];
  const preview = await postAction({
    code: rankRoom.room.code,
    viewerSeat: "B",
    type: "clue-selection",
    targetSeat: "A",
    cardIds: previewCardIds
  });

  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.clueSelection, committedClue);
  assert.deepEqual(preview.body.cluePreview, {
    seat: "A",
    cardIds: previewCardIds,
    committed: false
  });
});
