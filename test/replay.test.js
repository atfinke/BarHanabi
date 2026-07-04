const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const PORT = 3297;
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

async function createRoom(settings = {}) {
  const response = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
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

async function readReplay(code) {
  const response = await fetch(`${BASE}/api/replay?code=${encodeURIComponent(code)}`);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function readReplayCsv(code) {
  const response = await fetch(`${BASE}/api/replay.csv?code=${encodeURIComponent(code)}`);
  const text = await response.text();
  return { response, text };
}

async function readReplayRecap(code) {
  const response = await fetch(`${BASE}/api/recap.txt?code=${encodeURIComponent(code)}`);
  const text = await response.text();
  return { response, text };
}

function csvRows(text) {
  const [headerLine, ...rowLines] = text.trim().split("\n");
  const headers = headerLine.split(",");
  return rowLines.map((line) =>
    Object.fromEntries(line.split(",").map((value, index) => [headers[index], value]))
  );
}

function playerForSeat(state, seat) {
  return state.players.find((player) => player.seat === seat);
}

function rankClueCandidatesForTarget(state, targetSeat) {
  const hand = playerForSeat(state, targetSeat).hand;
  return [1, 2, 3, 4, 5]
    .map((rank) => ({
      rank,
      cardIds: hand.filter((card) => card.rank === rank).map((card) => card.id)
    }))
    .filter((candidate) => candidate.cardIds.length > 0 && candidate.cardIds.length < hand.length);
}

async function createReplayScenario() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const room = await createRoom({ bombs: 0 });
    const stateA = await readState(room.code, "A");
    const stateB = await readState(room.code, "B");
    const aVisibleHand = playerForSeat(stateB, "A").hand;
    const bVisibleHand = playerForSeat(stateA, "B").hand;
    const visibleUniqueA = aVisibleHand.find((card) => card.rank === 5);
    const rainbowMoveCard = aVisibleHand.find((card) => card.color === "rainbow");
    const bUnplayable = bVisibleHand.find((card) => card.rank !== 1);
    const clue = rankClueCandidatesForTarget(stateA, "B")[0];

    if (visibleUniqueA && rainbowMoveCard && bUnplayable && clue) {
      return { room, stateA, stateB, aVisibleHand, bVisibleHand, visibleUniqueA, rainbowMoveCard, bUnplayable, clue };
    }
  }

  throw new Error("Could not create a replay scenario with the requested cards.");
}

test("ended games expose replay actions, layout checkpoints, and perspective knowledge", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const scenario = await createReplayScenario();
  const activeReplay = await readReplay(scenario.room.code);
  assert.equal(activeReplay.response.status, 400, JSON.stringify(activeReplay.body));
  assert.equal(activeReplay.body.error, "Replay is available after the game ends.");
  const activeReplayCsv = await readReplayCsv(scenario.room.code);
  assert.equal(activeReplayCsv.response.status, 400, activeReplayCsv.text);
  const activeRecap = await readReplayRecap(scenario.room.code);
  assert.equal(activeRecap.response.status, 400, activeRecap.text);
  assert.match(activeRecap.text, /Recap is available after the game ends/);

  const aHiddenCard = playerForSeat(scenario.stateA, "A").hand.find((card) => card.id === scenario.rainbowMoveCard.id);
  assert.ok(aHiddenCard, "expected the local hidden hand to contain the visible rainbow card id");
  const movedCardIdentity = scenario.aVisibleHand.find((card) => card.id === aHiddenCard.id);
  assert.ok(movedCardIdentity);
  const preview = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "clue-selection",
    targetSeat: "B",
    cardIds: [scenario.clue.cardIds[0]]
  });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));

  const ordinaryMove = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "move-card",
    cardId: aHiddenCard.id,
    x: 40,
    y: 45,
    rotation: 5
  });
  assert.equal(ordinaryMove.response.status, 200, JSON.stringify(ordinaryMove.body));

  const checkpointMove = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "move-card",
    cardId: aHiddenCard.id,
    x: 42,
    y: 46,
    rotation: 7
  });
  assert.equal(checkpointMove.response.status, 200, JSON.stringify(checkpointMove.body));

  const checkpointA = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "layout-checkpoint"
  });
  assert.equal(checkpointA.response.status, 200, JSON.stringify(checkpointA.body));
  const checkpointA2 = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "layout-checkpoint"
  });
  assert.equal(checkpointA2.response.status, 200, JSON.stringify(checkpointA2.body));

  const clueTurn = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: scenario.clue.cardIds,
    clue: { kind: "rank", value: scenario.clue.rank }
  });
  assert.equal(clueTurn.response.status, 200, JSON.stringify(clueTurn.body));

  const endingPlay = await postAction({
    code: scenario.room.code,
    viewerSeat: "B",
    type: "play",
    cardId: scenario.bUnplayable.id
  });
  assert.equal(endingPlay.response.status, 200, JSON.stringify(endingPlay.body));
  assert.equal(endingPlay.body.status, "ended");

  const postGameMove = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "move-card",
    cardId: aHiddenCard.id,
    x: 50,
    y: 50,
    rotation: 10
  });
  assert.equal(postGameMove.response.status, 200, JSON.stringify(postGameMove.body));

  const replay = await readReplay(scenario.room.code);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.code, scenario.room.code);
  assert.equal(replay.body.status, "ended");
  assert.equal(replay.body.endReason, "strikes");
  assert.deepEqual(replay.body.actionEvents.map((event) => event.type), [
    "start",
    "give-clue",
    "play",
    "end-game"
  ]);
  const [startEvent, clueSnapshotEvent, playSnapshotEvent, endSnapshotEvent] = replay.body.actionEvents;
  assert.ok(Array.isArray(replay.body.highlights));
  const highlightsByType = replay.body.highlights.reduce((groups, highlight) => {
    groups[highlight.type] = groups[highlight.type] || [];
    groups[highlight.type].push(highlight);
    return groups;
  }, {});
  assert.equal(highlightsByType.clue, undefined, "ordinary clue actions should not become highlights");
  assert.ok(highlightsByType["missed-play"]?.length >= 1, "expected a missed-play highlight");
  assert.ok(highlightsByType["game-end"]?.length >= 1, "expected a game-end highlight");
  assert.ok(highlightsByType["wild-card-move"]?.length >= 1, "expected a rainbow movement highlight");
  const missedPlayHighlight = highlightsByType["missed-play"][0];
  assert.equal(missedPlayHighlight.seq, playSnapshotEvent.seq);
  assert.equal(missedPlayHighlight.actorSeat, "B");
  assert.equal(missedPlayHighlight.card.id, scenario.bUnplayable.id);
  assert.equal(missedPlayHighlight.bombsBefore, 0);
  assert.equal(missedPlayHighlight.bombsAfter, 0);
  assert.equal(missedPlayHighlight.scoreBefore, 0);
  assert.equal(missedPlayHighlight.scoreAfter, 0);
  assert.equal(missedPlayHighlight.scoreDelta, 0);
  assert.equal(missedPlayHighlight.scorePercentAfter, 0);
  assert.equal(missedPlayHighlight.endReason, "strikes");
  assert.match(missedPlayHighlight.summary, /ended the game/);
  const wildMoveHighlight = highlightsByType["wild-card-move"].find((highlight) => highlight.card.id === aHiddenCard.id);
  assert.ok(wildMoveHighlight, "expected a wild-card movement highlight for the moved rainbow card");
  assert.equal(wildMoveHighlight.seq, replay.body.layoutEvents[0].seq);
  assert.equal(wildMoveHighlight.card.color, "rainbow");
  assert.deepEqual(wildMoveHighlight.layout, { x: 42, y: 46, rotation: 7 });
  const gameEndHighlight = highlightsByType["game-end"][0];
  assert.equal(gameEndHighlight.seq, endSnapshotEvent.seq);
  assert.equal(gameEndHighlight.moveNumber, 2);
  assert.equal(gameEndHighlight.scoreAfter, 0);
  assert.equal(gameEndHighlight.scorePercentAfter, 0);
  assert.equal(gameEndHighlight.endReason, "strikes");
  assert.equal(startEvent.table.deckCount, 50, "start snapshot is the post-deal board");
  assert.equal(startEvent.table.lastResult, null);
  assert.equal(clueSnapshotEvent.table.lastResult, null, "clue snapshot carries no play result");
  assert.equal(clueSnapshotEvent.table.hints, 7, "clue snapshot is post-clue");
  assert.equal(playSnapshotEvent.table.lastResult?.cardId, scenario.bUnplayable.id, "play snapshot carries its own result");
  assert.equal(playSnapshotEvent.table.status, "ended", "ending play snapshot is post-endGame");
  assert.equal(endSnapshotEvent.table.lastResult?.cardId, scenario.bUnplayable.id);
  assert.equal(replay.body.layoutEvents.length, 1, "consecutive same-seat checkpoints supersede");
  assert.equal(replay.body.layoutEvents[0].seat, "A");
  assert.equal(replay.body.layoutEvents[0].cardId, undefined);
  assert.deepEqual(
    replay.body.layoutEvents[0].hands.A.find((card) => card.id === aHiddenCard.id).layout,
    { x: 42, y: 46, rotation: 7 }
  );
  assert.ok(replay.body.layoutEvents[0].knowledge.A.cards[aHiddenCard.id]);

  const replayRecap = await readReplayRecap(scenario.room.code);
  assert.equal(replayRecap.response.status, 200, replayRecap.text);
  assert.match(replayRecap.response.headers.get("content-type"), /^text\/plain\b/);
  assert.match(
    replayRecap.response.headers.get("content-disposition"),
    new RegExp(`attachment; filename="bar-hanabi-${scenario.room.code}-recap.txt"`)
  );
  assert.match(replayRecap.text, new RegExp(`Bar Hanabi ${scenario.room.code}`));
  assert.match(replayRecap.text, /Score: 0\/30 \(0%\)/);
  assert.match(replayRecap.text, /Result: Bombs/);
  assert.match(replayRecap.text, /Highlights:/);
  assert.match(replayRecap.text, /Move 1: A gave B/);
  assert.match(replayRecap.text, /Move 2: B missed with/);
  assert.match(replayRecap.text, /ended the game/);

  const replayCsv = await readReplayCsv(scenario.room.code);
  assert.equal(replayCsv.response.status, 200, replayCsv.text);
  assert.match(replayCsv.response.headers.get("content-type"), /^text\/csv\b/);
  assert.match(
    replayCsv.response.headers.get("content-disposition"),
    new RegExp(`attachment; filename="bar-hanabi-${scenario.room.code}-replay.csv"`)
  );
  const header = replayCsv.text.split("\n")[0];
  for (const column of [
    "row_type",
    "event_seq",
    "event_type",
    "event_at",
    "code",
    "actor_seat",
    "target_seat",
    "action_card_id",
    "clue_kind",
    "clue_value",
    "clue_label",
    "clued_card_ids",
    "result_pile",
    "result_action",
    "play_succeeded",
    "drew_replacement",
    "replacement_card_id",
    "hand_seat",
    "hand_index",
    "card_id",
    "card_color",
    "card_rank",
    "possible_colors",
    "possible_ranks",
    "possible_identities",
    "deck_count",
    "turn_seat",
    "status",
    "fireworks",
    "discard_ids",
    "settings_max_hints",
    "settings_max_bombs",
    "include_rainbow",
    "colors",
    "max_score",
    "final_score",
    "move_number"
  ]) {
    assert.ok(header.split(",").includes(column), `missing CSV column ${column}`);
  }
  assert.ok(!header.split(",").includes("snapshot_phase"), "snapshot_phase removed");
  assert.doesNotMatch(replayCsv.text.split("\n")[0], /perspective/i);

  const csvKeyDoc = require("node:fs").readFileSync("docs/replay-csv.md", "utf8");
  for (const column of header.split(",")) {
    assert.ok(csvKeyDoc.includes(`\`${column}\``), `CSV column ${column} is undocumented in docs/replay-csv.md`);
  }

  const rows = csvRows(replayCsv.text);
  const sequencedRows = rows.filter((row) => row.event_seq !== "").map((row) => Number(row.event_seq));
  assert.deepEqual([...sequencedRows].sort((a, b) => a - b), sequencedRows, "CSV rows must be chronological");

  const eventRowsByType = Object.fromEntries(
    rows.filter((row) => row.row_type === "event").map((row) => [row.event_type, row])
  );
  assert.equal(eventRowsByType.start.move_number, "0");
  assert.equal(eventRowsByType["give-clue"].move_number, "1");
  assert.equal(eventRowsByType.play.move_number, "2");
  assert.equal(eventRowsByType["end-game"].move_number, "2");
  assert.equal(
    eventRowsByType.layout.move_number,
    "0",
    "layout checkpoint happens before the clue, so it carries the preceding move number"
  );

  const gameRow = rows.find((row) => row.row_type === "game");
  assert.equal(gameRow.code, scenario.room.code);
  assert.equal(gameRow.settings_max_bombs, "0");
  assert.equal(gameRow.status, "ended");
  assert.equal(gameRow.include_rainbow, "true");
  assert.equal(gameRow.final_score, "0");

  const eventRows = rows.filter((row) => row.row_type === "event");
  const clueCsvEvent = eventRows.find((row) => row.event_type === "give-clue");
  assert.equal(clueCsvEvent.actor_seat, "A");
  assert.equal(clueCsvEvent.target_seat, "B");
  assert.equal(clueCsvEvent.clue_kind, "rank");
  assert.equal(clueCsvEvent.clue_value, String(scenario.clue.rank));
  assert.equal(clueCsvEvent.clue_label, rankLabel(scenario.clue.rank, scenario.clue.cardIds.length));
  assert.equal(clueCsvEvent.clued_card_ids, scenario.clue.cardIds.join("|"));
  assert.equal(clueCsvEvent.move_number, "1");

  const playCsvEvent = eventRows.find((row) => row.event_type === "play");
  assert.equal(playCsvEvent.actor_seat, "B");
  assert.equal(playCsvEvent.action_card_id, scenario.bUnplayable.id);
  assert.equal(playCsvEvent.action_card_color, scenario.bUnplayable.color);
  assert.equal(playCsvEvent.action_card_rank, String(scenario.bUnplayable.rank));
  assert.equal(playCsvEvent.result_pile, "discard");
  assert.equal(playCsvEvent.result_action, "play");
  assert.equal(playCsvEvent.play_succeeded, "false");

  const endCsvEvent = eventRows.find((row) => row.event_type === "end-game");
  assert.equal(endCsvEvent.end_reason, "strikes");
  assert.equal(endCsvEvent.move_number, "2");

  const handRows = rows.filter((row) => row.row_type === "hand_card");
  assert.ok(handRows.some((row) => row.hand_seat === "A" && row.hand_index !== ""), "expected indexed A hand rows");
  assert.ok(handRows.some((row) => row.hand_seat === "B" && row.hand_index !== ""), "expected indexed B hand rows");
  assert.ok(rows.some((row) =>
    row.row_type === "layout_checkpoint" &&
    row.card_id === aHiddenCard.id &&
    row.card_color === movedCardIdentity.color &&
    row.card_rank === String(movedCardIdentity.rank) &&
    row.deck_count !== "" &&
    row.fireworks !== "" &&
    row.layout_x === "42" &&
    row.layout_rotation === "7"
  ));

  const clueEvent = clueSnapshotEvent;
  assert.equal(clueEvent.actorSeat, "A");
  assert.equal(clueEvent.targetSeat, "B");
  assert.deepEqual(clueEvent.cardIds, scenario.clue.cardIds);
  assert.deepEqual(clueEvent.clue, {
    kind: "rank",
    value: scenario.clue.rank,
    label: rankLabel(scenario.clue.rank, scenario.clue.cardIds.length)
  });

  const bKnowledge = clueEvent.knowledge.B.cards;
  for (const cardId of scenario.clue.cardIds) {
    assert.deepEqual(bKnowledge[cardId].ranks, [scenario.clue.rank]);
    assert.ok(handRows.some((row) =>
      row.event_type === "give-clue" &&
      row.hand_seat === "B" &&
      row.card_id === cardId &&
      row.possible_ranks === String(scenario.clue.rank)
    ));
  }

  const unselectedBCard = scenario.bVisibleHand.find((card) => !scenario.clue.cardIds.includes(card.id));
  assert.ok(unselectedBCard, "expected an unselected B card");
  assert.equal(bKnowledge[unselectedBCard.id].ranks.includes(scenario.clue.rank), false);

  const visibleIdentity = {
    color: scenario.visibleUniqueA.color,
    rank: scenario.visibleUniqueA.rank
  };
  for (const card of scenario.bVisibleHand) {
    assert.equal(
      bKnowledge[card.id].identities.some((identity) =>
        identity.color === visibleIdentity.color && identity.rank === visibleIdentity.rank
      ),
      false,
      "B knowledge should exclude the unique 5 visible in A's hand"
    );
  }

  const reset = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "reset"
  });
  assert.equal(reset.response.status, 200, JSON.stringify(reset.body));

  const resetReplay = await readReplay(scenario.room.code);
  assert.equal(resetReplay.response.status, 400, JSON.stringify(resetReplay.body));
  assert.equal(resetReplay.body.error, "Replay is available after the game ends.");
});

test("replay CSV exposes pre-action hand state and newest pickup context", async (t) => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill("SIGTERM"));
  await waitForServer(server);

  const scenario = await createReplayScenario();
  const bDiscardCard = scenario.bVisibleHand[0];
  const bPreDiscardNewest = scenario.bVisibleHand[scenario.bVisibleHand.length - 1];

  const clueTurn = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "give-clue",
    targetSeat: "B",
    cardIds: scenario.clue.cardIds,
    clue: { kind: "rank", value: scenario.clue.rank }
  });
  assert.equal(clueTurn.response.status, 200, JSON.stringify(clueTurn.body));

  const discardTurn = await postAction({
    code: scenario.room.code,
    viewerSeat: "B",
    type: "discard",
    cardId: bDiscardCard.id
  });
  assert.equal(discardTurn.response.status, 200, JSON.stringify(discardTurn.body));

  const endingPlay = await postAction({
    code: scenario.room.code,
    viewerSeat: "A",
    type: "play",
    cardId: scenario.visibleUniqueA.id
  });
  assert.equal(endingPlay.response.status, 200, JSON.stringify(endingPlay.body));
  assert.equal(endingPlay.body.status, "ended");

  const replay = await readReplay(scenario.room.code);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  const discardEvent = replay.body.actionEvents.find((event) => event.type === "discard");
  assert.ok(discardEvent, "expected a discard event");
  assert.equal(discardEvent.preHands, undefined, "pre-action CSV snapshots should stay out of replay JSON");
  assert.equal(discardEvent.preTable, undefined, "pre-action CSV snapshots should stay out of replay JSON");
  assert.equal(discardEvent.preKnowledge, undefined, "pre-action CSV snapshots should stay out of replay JSON");

  const replayCsv = await readReplayCsv(scenario.room.code);
  assert.equal(replayCsv.response.status, 200, replayCsv.text);
  const header = replayCsv.text.split("\n")[0].split(",");
  assert.equal(header.includes("replacement_card_color"), false);
  assert.equal(header.includes("replacement_card_rank"), false);
  const rows = csvRows(replayCsv.text);
  const discardEventRow = rows.find((row) => row.row_type === "event" && row.event_type === "discard");
  assert.ok(discardEventRow, "expected a discard event row");
  assert.equal(discardEventRow.pre_turn_seat, "B");
  assert.equal(discardEventRow.pre_deck_count, "50");
  assert.equal(discardEventRow.deck_count, "49");
  assert.notEqual(discardEventRow.replacement_card_id, "");

  const preDiscardHandRows = rows.filter((row) =>
    row.row_type === "pre_hand_card" &&
    row.event_type === "discard" &&
    row.hand_seat === "B"
  );
  assert.deepEqual(
    preDiscardHandRows.map((row) => row.card_id),
    scenario.bVisibleHand.map((card) => card.id),
    "pre_hand_card rows should preserve the actor's decision-time hand order"
  );
  assert.equal(
    preDiscardHandRows.find((row) => row.card_id === bPreDiscardNewest.id)?.is_newest_card,
    "true"
  );

  const postDiscardHandRows = rows.filter((row) =>
    row.row_type === "hand_card" &&
    row.event_type === "discard" &&
    row.hand_seat === "B"
  );
  assert.equal(
    postDiscardHandRows.find((row) => row.card_id === discardEventRow.replacement_card_id)?.is_newest_card,
    "true",
    "the replacement card should be marked as the newest card in the post-action hand"
  );
});

function rankLabel(rank, count) {
  const labels = {
    1: "One",
    2: "Two",
    3: "Three",
    4: "Four",
    5: "Five"
  };
  return `${labels[rank]}${count === 1 ? "" : "s"}`;
}
