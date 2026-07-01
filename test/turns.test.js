const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const PORT = 3221;
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

async function postAction(payload) {
  const response = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  return { response, body };
}

async function createRoomWithPlayableACard() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const room = await fetch(`${BASE}/api/rooms`, { method: "POST" }).then((response) => response.json());
    const stateB = await readState(room.code, "B");
    const aHand = stateB.players.find((player) => player.seat === "A").hand;
    const card = aHand.find((item) => item.rank === 1);
    if (card) return { room, card };
  }
  throw new Error("Could not create a room with a playable A card.");
}

async function createRoomWithUnplayableACard(settings) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const room = await createRoom(settings);
    const stateB = await readState(room.code, "B");
    const aHand = stateB.players.find((player) => player.seat === "A").hand;
    const card = aHand.find((item) => item.rank !== 1);
    if (card) return { room, card };
  }
  throw new Error("Could not create a room with an unplayable A card.");
}

async function createRoomWithUnplayableCardsForBoth(settings) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const room = await createRoom(settings);
    const stateA = await readState(room.code, "A");
    const stateB = await readState(room.code, "B");
    const aCard = playerForSeat(stateB, "A").hand.find((item) => item.rank !== 1);
    const bCard = playerForSeat(stateA, "B").hand.find((item) => item.rank !== 1);
    if (aCard && bCard) return { room, aCard, bCard };
  }
  throw new Error("Could not create a room with unplayable cards for both players.");
}

async function createRoom(settings) {
  return fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: settings ? JSON.stringify(settings) : undefined
  }).then((response) => response.json());
}

function playerForSeat(state, seat) {
  return state.players.find((player) => player.seat === seat);
}

function firstLegalClueForTarget(state, targetSeat, requiredCardId) {
  const candidates = legalClueCandidatesForTarget(state, targetSeat);
  const clue = requiredCardId
    ? candidates.find((candidate) => candidate.cardIds.includes(requiredCardId))
    : candidates[0];
  if (!clue) {
    throw new Error(`Could not find a legal clue for ${targetSeat}.`);
  }
  return clue;
}

function legalClueCandidatesForTarget(state, targetSeat) {
  const hand = playerForSeat(state, targetSeat).hand;
  const candidates = [];

  for (const rank of [1, 2, 3, 4, 5]) {
    const cards = hand.filter((card) => card.rank === rank);
    if (cards.length > 0) {
      candidates.push(clueCandidate(state, "rank", rank, cards));
    }
  }

  for (const color of state.colors.filter((item) => item.id !== "rainbow")) {
    const cards = hand.filter((card) => card.color === color.id || card.color === "rainbow");
    if (cards.length > 0) {
      candidates.push(clueCandidate(state, "color", color.id, cards));
    }
  }

  return candidates;
}

function clueCandidate(state, kind, value, cards) {
  const cardIds = cards.map((card) => card.id);
  return {
    cardIds,
    clue: { kind, value },
    expectedClue: {
      kind,
      value,
      label: clueLabel(state, kind, value, cardIds.length)
    }
  };
}

function clueLabel(state, kind, value, count) {
  if (kind === "rank") {
    const labels = {
      1: "One",
      2: "Two",
      3: "Three",
      4: "Four",
      5: "Five"
    };
    return `${labels[value]}${count === 1 ? "" : "s"}`;
  }
  const color = state.colors.find((item) => item.id === value);
  return `${color ? color.label : value}${count === 1 ? "" : "s"}`;
}

async function discardFirstCard(code, state) {
  const player = playerForSeat(state, state.turnSeat);
  return postAction({
    code,
    viewerSeat: state.turnSeat,
    type: "discard",
    cardId: player.hand[0].id
  });
}

async function takeTurnPreferringFailedPlay(code, state) {
  const activeSeat = state.turnSeat;
  const observerSeat = activeSeat === "A" ? "B" : "A";
  const observerState = await readState(code, observerSeat);
  const activeHand = playerForSeat(observerState, activeSeat).hand;
  const unplayable = activeHand.find((card) => card.rank !== state.fireworks[card.color] + 1);
  const actionCard = unplayable || playerForSeat(state, activeSeat).hand[0];
  const actionResult = await postAction({
    code,
    viewerSeat: activeSeat,
    type: unplayable ? "play" : "discard",
    cardId: actionCard.id
  });

  assert.equal(actionResult.response.status, 200, JSON.stringify(actionResult.body));
  return actionResult.body;
}

async function spendTwoHintsAndReturnToA(code, aCardId) {
  const stateA = await readState(code, "A");
  const bClue = firstLegalClueForTarget(stateA, "B");
  const firstClue = await postAction({
    code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: bClue.cardIds,
    clue: bClue.clue
  });
  assert.equal(firstClue.response.status, 200, JSON.stringify(firstClue.body));

  const stateB = await readState(code, "B");
  const aClue = firstLegalClueForTarget(stateB, "A", aCardId);
  const secondClue = await postAction({
    code,
    viewerSeat: "B",
    type: "give-clue",
    targetSeat: "A",
    cardIds: aClue.cardIds,
    clue: aClue.clue
  });
  assert.equal(secondClue.response.status, 200, JSON.stringify(secondClue.body));
  assert.equal(secondClue.body.turnSeat, "A");
  assert.equal(secondClue.body.hints, 6);
  return secondClue.body;
}

test("play and discard actions must follow the active turn", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const playable = await createRoomWithPlayableACard();
  const played = await postAction({
    code: playable.room.code,
    viewerSeat: "A",
    type: "play",
    cardId: playable.card.id
  });

  assert.equal(played.response.status, 200, JSON.stringify(played.body));
  assert.equal(played.body.fireworks[playable.card.color], 1);
  assert.deepEqual(played.body.lastResult, {
    type: "firework",
    action: "play",
    actorSeat: "A",
    cardId: playable.card.id,
    color: playable.card.color,
    rank: 1,
    card: {
      id: playable.card.id,
      color: playable.card.color,
      rank: 1
    }
  });

  const room = await fetch(`${BASE}/api/rooms`, { method: "POST" }).then((response) => response.json());
  const initialA = await readState(room.code, "A");
  const initialB = await readState(room.code, "B");
  const initialAHand = initialA.players.find((player) => player.seat === "A").hand;
  const initialAHandIds = new Set(initialAHand.map((card) => card.id));
  const aCard = initialAHand[0];
  const bCard = initialB.players.find((player) => player.seat === "B").hand[0];
  const aVisibleCards = initialB.players.find((player) => player.seat === "A").hand;
  const aVisibleCard = aVisibleCards.find((card) => card.id === aCard.id);

  assert.equal(initialA.turnSeat, "A");
  assert.equal(initialA.deckCount, 50);
  assert.equal(initialA.bombs, 0);
  assert.equal(initialA.hints, 8);
  assert.equal("strikes" in initialA, false);

  const renameBlocked = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "rename",
    name: "Andrew"
  });

  assert.equal(renameBlocked.response.status, 400, JSON.stringify(renameBlocked.body));

  const afterRename = await readState(room.code, "A");
  assert.equal(afterRename.players.find((player) => player.seat === "A").name, "Player A");
  assert.equal(afterRename.players.find((player) => player.seat === "B").name, "Player B");

  const blocked = await postAction({
    code: room.code,
    viewerSeat: "B",
    type: "discard",
    cardId: bCard.id
  });

  assert.equal(blocked.response.status, 400, JSON.stringify(blocked.body));

  const afterBlocked = await readState(room.code, "A");
  assert.equal(afterBlocked.turnSeat, "A");
  assert.equal(afterBlocked.deckCount, 50);

  const blockedClueSelection = await postAction({
    code: room.code,
    viewerSeat: "B",
    type: "clue-selection",
    targetSeat: "A",
    cardIds: [aVisibleCards[0].id]
  });

  assert.equal(blockedClueSelection.response.status, 400, JSON.stringify(blockedClueSelection.body));

  const afterBlockedClueSelection = await readState(room.code, "A");
  assert.equal(afterBlockedClueSelection.turnSeat, "A");
  assert.equal(afterBlockedClueSelection.clueSelection, null);

  const liveClueSelection = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "clue-selection",
    targetSeat: "B",
    cardIds: [bCard.id]
  });

  assert.equal(liveClueSelection.response.status, 200, JSON.stringify(liveClueSelection.body));
  assert.equal(liveClueSelection.body.turnSeat, "A");
  assert.equal(liveClueSelection.body.hints, 8);
  assert.equal(liveClueSelection.body.clueSelection, null);
  assert.deepEqual(liveClueSelection.body.cluePreview, {
    seat: "B",
    cardIds: [bCard.id],
    committed: false
  });

  const liveRecipientState = await readState(room.code, "B");
  assert.equal(liveRecipientState.clueSelection, null);
  assert.deepEqual(liveRecipientState.cluePreview, {
    seat: "B",
    cardIds: [bCard.id],
    committed: false
  });
  assert.equal(liveRecipientState.turnSeat, "A");
  assert.equal(liveRecipientState.hints, 8);

  const clearedLiveClueSelection = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "clue-selection",
    targetSeat: "B",
    cardIds: []
  });

  assert.equal(clearedLiveClueSelection.response.status, 200, JSON.stringify(clearedLiveClueSelection.body));
  assert.equal(clearedLiveClueSelection.body.clueSelection, null);
  assert.equal(clearedLiveClueSelection.body.cluePreview, null);
  assert.equal(clearedLiveClueSelection.body.turnSeat, "A");
  assert.equal(clearedLiveClueSelection.body.hints, 8);

  const liveClueBeforeDiscard = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "clue-selection",
    targetSeat: "B",
    cardIds: [bCard.id]
  });

  assert.equal(liveClueBeforeDiscard.response.status, 200, JSON.stringify(liveClueBeforeDiscard.body));
  assert.equal(liveClueBeforeDiscard.body.clueSelection, null);
  assert.deepEqual(liveClueBeforeDiscard.body.cluePreview, {
    seat: "B",
    cardIds: [bCard.id],
    committed: false
  });

  const discarded = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "discard",
    cardId: aCard.id
  });

  assert.equal(discarded.response.status, 200, JSON.stringify(discarded.body));
  assert.equal(discarded.body.turnSeat, "B");
  assert.equal(discarded.body.deckCount, 49);
  assert.equal(discarded.body.hints, 8);
  assert.equal(discarded.body.clueSelection, null);
  assert.equal(discarded.body.cluePreview, null);
  assert.deepEqual(discarded.body.lastResult, {
    type: "discard",
    action: "discard",
    actorSeat: "A",
    cardId: aCard.id,
    color: aVisibleCard.color,
    rank: aVisibleCard.rank,
    card: {
      id: aCard.id,
      color: aVisibleCard.color,
      rank: aVisibleCard.rank
    }
  });
  const afterDiscardAHand = discarded.body.players.find((player) => player.seat === "A").hand;
  const replacement = afterDiscardAHand.find((card) => !initialAHandIds.has(card.id));
  assert.ok(replacement, "expected a replacement card to be drawn");

  const emptyClue = await postAction({
    code: room.code,
    viewerSeat: "B",
    type: "give-clue",
    targetSeat: "A",
    cardIds: []
  });

  assert.equal(emptyClue.response.status, 400, JSON.stringify(emptyClue.body));

  const afterEmptyClue = await readState(room.code, "B");
  assert.equal(afterEmptyClue.turnSeat, "B");
  assert.equal(afterEmptyClue.hints, 8);

  const clue = firstLegalClueForTarget(afterEmptyClue, "A");
  const clueCardIds = clue.cardIds;
  const clueTurn = await postAction({
    code: room.code,
    viewerSeat: "B",
    type: "give-clue",
    targetSeat: "A",
    cardIds: clueCardIds,
    clue: clue.clue
  });

  assert.equal(clueTurn.response.status, 200, JSON.stringify(clueTurn.body));
  assert.equal(clueTurn.body.turnSeat, "A");
  assert.equal(clueTurn.body.hints, 7);
  assert.equal(clueTurn.body.lastResult, null);
  assert.deepEqual(clueTurn.body.clueSelection, {
    seat: "A",
    cardIds: clueCardIds,
    committed: true,
    clue: clue.expectedClue
  });

  const recipientState = await readState(room.code, "A");
  assert.deepEqual(recipientState.clueSelection, {
    seat: "A",
    cardIds: clueCardIds,
    committed: true,
    clue: clue.expectedClue
  });

  const recipientCard = recipientState.players.find((player) => player.seat === "A").hand[0];
  const afterRecipientTurn = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "discard",
    cardId: recipientCard.id
  });

  assert.equal(afterRecipientTurn.response.status, 200, JSON.stringify(afterRecipientTurn.body));
  assert.equal(afterRecipientTurn.body.turnSeat, "B");
  assert.equal(afterRecipientTurn.body.clueSelection, null);
  assert.equal(afterRecipientTurn.body.hints, 8);
  assert.equal(afterRecipientTurn.body.lastResult.type, "discard");
  assert.equal(afterRecipientTurn.body.lastResult.action, "discard");
  assert.equal(afterRecipientTurn.body.lastResult.actorSeat, "A");
  assert.equal(afterRecipientTurn.body.lastResult.cardId, recipientCard.id);
  assert.equal(afterRecipientTurn.body.lastResult.card.id, recipientCard.id);
  assert.equal(typeof afterRecipientTurn.body.lastResult.card.color, "string");
  assert.equal(typeof afterRecipientTurn.body.lastResult.card.rank, "number");
});

test("successful plays restore a hint and failed plays do not", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const playable = await createRoomWithPlayableACard();
  await spendTwoHintsAndReturnToA(playable.room.code, playable.card.id);
  const played = await postAction({
    code: playable.room.code,
    viewerSeat: "A",
    type: "play",
    cardId: playable.card.id
  });

  assert.equal(played.response.status, 200, JSON.stringify(played.body));
  assert.equal(played.body.lastResult.type, "firework");
  assert.equal(played.body.hints, 7);

  const unplayable = await createRoomWithUnplayableACard();
  await spendTwoHintsAndReturnToA(unplayable.room.code, unplayable.card.id);
  const missed = await postAction({
    code: unplayable.room.code,
    viewerSeat: "A",
    type: "play",
    cardId: unplayable.card.id
  });

  assert.equal(missed.response.status, 200, JSON.stringify(missed.body));
  assert.equal(missed.body.lastResult.type, "discard");
  assert.equal(missed.body.lastResult.action, "play");
  assert.equal(missed.body.hints, 6);
});

test("hints stay within limits and zero hints block clue actions", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const oneHintRoom = await createRoom({ hints: 1 });
  const initial = await readState(oneHintRoom.code, "A");
  const clue = firstLegalClueForTarget(initial, "B");
  const firstClue = await postAction({
    code: oneHintRoom.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: clue.cardIds,
    clue: clue.clue
  });

  assert.equal(firstClue.response.status, 200, JSON.stringify(firstClue.body));
  assert.equal(firstClue.body.hints, 0);
  assert.equal(firstClue.body.turnSeat, "B");

  const aCard = playerForSeat(firstClue.body, "A").hand[0];
  const blockedSelection = await postAction({
    code: oneHintRoom.code,
    viewerSeat: "B",
    type: "clue-selection",
    targetSeat: "A",
    cardIds: [aCard.id]
  });

  assert.equal(blockedSelection.response.status, 400, JSON.stringify(blockedSelection.body));
  assert.equal(blockedSelection.body.error, "No hints left.");

  const blockedClue = await postAction({
    code: oneHintRoom.code,
    viewerSeat: "B",
    type: "give-clue",
    targetSeat: "A",
    cardIds: [aCard.id]
  });

  assert.equal(blockedClue.response.status, 400, JSON.stringify(blockedClue.body));
  assert.equal(blockedClue.body.error, "No hints left.");

  const maxHintRoom = await createRoom({ hints: 2 });
  const maxHintState = await readState(maxHintRoom.code, "A");
  const discarded = await discardFirstCard(maxHintRoom.code, maxHintState);

  assert.equal(discarded.response.status, 200, JSON.stringify(discarded.body));
  assert.equal(discarded.body.hints, 2);
  assert.equal(discarded.body.maxHints, 2);
});

test("drawing the last deck card starts one final turn per player", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const room = await createRoom();
  let state = await readState(room.code, "A");

  while (state.deckCount > 0) {
    const discarded = await discardFirstCard(room.code, state);
    assert.equal(discarded.response.status, 200, JSON.stringify(discarded.body));
    state = discarded.body;
  }

  assert.equal(state.status, "playing");
  assert.equal(state.deckCount, 0);
  assert.equal(state.finalTurnsRemaining, 2);
  assert.equal(state.endReason, null);
  assert.equal(state.finalRoundStartedBy, "B");

  const firstFinalSeat = state.turnSeat;
  const firstFinalTargetSeat = firstFinalSeat === "A" ? "B" : "A";
  const firstFinalState = await readState(room.code, firstFinalSeat);
  const firstFinalClue = firstLegalClueForTarget(firstFinalState, firstFinalTargetSeat);
  const firstFinalTurn = await postAction({
    code: room.code,
    viewerSeat: firstFinalSeat,
    type: "give-clue",
    targetSeat: firstFinalTargetSeat,
    cardIds: firstFinalClue.cardIds,
    clue: firstFinalClue.clue
  });

  assert.equal(firstFinalTurn.response.status, 200, JSON.stringify(firstFinalTurn.body));
  assert.equal(firstFinalTurn.body.status, "playing");
  assert.equal(firstFinalTurn.body.finalTurnsRemaining, 1);
  assert.equal(firstFinalTurn.body.turnSeat, "B");

  const secondFinalTurn = await discardFirstCard(room.code, firstFinalTurn.body);
  assert.equal(secondFinalTurn.response.status, 200, JSON.stringify(secondFinalTurn.body));
  assert.equal(secondFinalTurn.body.status, "ended");
  assert.equal(secondFinalTurn.body.endReason, "deck");
  assert.equal(secondFinalTurn.body.finalTurnsRemaining, 0);
  assert.equal(secondFinalTurn.body.score, Object.values(secondFinalTurn.body.fireworks).reduce((sum, rank) => sum + rank, 0));

  const blockedAfterEnd = await discardFirstCard(room.code, secondFinalTurn.body);
  assert.equal(blockedAfterEnd.response.status, 400, JSON.stringify(blockedAfterEnd.body));
});

test("three bombs allow three failed plays before game over", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const room = await createRoom();
  let state = await readState(room.code, "A");

  for (let attempts = 0; state.bombs < 3 && attempts < 30; attempts += 1) {
    state = await takeTurnPreferringFailedPlay(room.code, state);
  }

  assert.equal(state.bombs, 3, "expected setup to reach three failed plays before the attempt cap");
  assert.equal(state.status, "playing");
  assert.equal(state.endReason, null);

  for (let attempts = 0; state.status !== "ended" && attempts < 30; attempts += 1) {
    state = await takeTurnPreferringFailedPlay(room.code, state);
  }

  assert.equal(state.bombs, 3);
  assert.equal(state.status, "ended");
  assert.equal(state.endReason, "strikes");

  const blockedAfterEnd = await discardFirstCard(room.code, state);
  assert.equal(blockedAfterEnd.response.status, 400, JSON.stringify(blockedAfterEnd.body));
});

test("active games keep remaining deck contents redacted", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const room = await createRoom();
  const state = await readState(room.code, "A");

  assert.equal(state.status, "playing");
  assert.equal(state.deckCount, 50);
  assert.equal(Object.hasOwn(state, "remainingDeck"), false);
});

test("ended games expose remaining deck contents", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const { room, card } = await createRoomWithUnplayableACard({ bombs: 0 });
  const activeState = await readState(room.code, "A");
  assert.equal(Object.hasOwn(activeState, "remainingDeck"), false);

  const failedPlay = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "play",
    cardId: card.id
  });

  assert.equal(failedPlay.response.status, 200, JSON.stringify(failedPlay.body));
  assert.equal(failedPlay.body.status, "ended");
  assert.equal(failedPlay.body.endReason, "strikes");
  assert.ok(Array.isArray(failedPlay.body.remainingDeck));
  assert.equal(failedPlay.body.remainingDeck.length, failedPlay.body.deckCount);
  assert.deepEqual(
    Object.keys(failedPlay.body.remainingDeck[0]).sort(),
    ["color", "id", "rank"]
  );

  const observedAfterEnd = await readState(room.code, "B");
  assert.deepEqual(observedAfterEnd.remainingDeck, failedPlay.body.remainingDeck);
});

test("one bomb allows one failed play before game over", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const { room, aCard, bCard } = await createRoomWithUnplayableCardsForBoth({ bombs: 1 });
  const firstFailedPlay = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "play",
    cardId: aCard.id
  });

  assert.equal(firstFailedPlay.response.status, 200, JSON.stringify(firstFailedPlay.body));
  assert.equal(firstFailedPlay.body.maxBombs, 1);
  assert.equal(firstFailedPlay.body.bombs, 1);
  assert.equal(firstFailedPlay.body.status, "playing");
  assert.equal(firstFailedPlay.body.endReason, null);

  const secondFailedPlay = await postAction({
    code: room.code,
    viewerSeat: "B",
    type: "play",
    cardId: bCard.id
  });

  assert.equal(secondFailedPlay.response.status, 200, JSON.stringify(secondFailedPlay.body));
  assert.equal(secondFailedPlay.body.maxBombs, 1);
  assert.equal(secondFailedPlay.body.bombs, 1);
  assert.equal(secondFailedPlay.body.status, "ended");
  assert.equal(secondFailedPlay.body.endReason, "strikes");
});

test("zero bombs ends the game on the first failed play", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const { room, card } = await createRoomWithUnplayableACard({ bombs: 0 });
  const failedPlay = await postAction({
    code: room.code,
    viewerSeat: "A",
    type: "play",
    cardId: card.id
  });

  assert.equal(failedPlay.response.status, 200, JSON.stringify(failedPlay.body));
  assert.equal(failedPlay.body.maxBombs, 0);
  assert.equal(failedPlay.body.bombs, 0);
  assert.equal(failedPlay.body.status, "ended");
  assert.equal(failedPlay.body.endReason, "strikes");
  assert.equal(failedPlay.body.lastResult.type, "discard");
  assert.equal(failedPlay.body.lastResult.action, "play");
});
