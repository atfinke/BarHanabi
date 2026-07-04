const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DEBUG_ACTIONS_ENABLED = process.env.BAR_HANABI_DEBUG_ACTIONS === "1";
const PUBLIC_DIR = path.join(__dirname, "public");
const HAND_SIZE = 5;
const MAX_HINTS = 8;
const MAX_BOMBS = 3;
const COLORS = [
  { id: "red", label: "Red" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "white", label: "White" },
  { id: "rainbow", label: "Rainbow" }
];

const rooms = new Map();
const subscribers = new Map();

function buildDeck(colors) {
  const cards = [];
  const counts = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };

  for (const color of colors) {
    for (const [rank, count] of Object.entries(counts)) {
      for (let i = 0; i < count; i += 1) {
        cards.push({
          id: `${color.id}-${rank}-${i}-${crypto.randomUUID()}`,
          color: color.id,
          rank: Number(rank)
        });
      }
    }
  }

  return shuffle(cards);
}

function sanitizeRoomSettings(settings = {}) {
  const maxHints = sanitizeInteger(settings.hints ?? settings.maxHints, 1, MAX_HINTS, MAX_HINTS);
  const maxBombs = sanitizeInteger(settings.bombs ?? settings.maxBombs, 0, MAX_BOMBS, MAX_BOMBS);
  const includeRainbow = settings.rainbow === false || settings.includeRainbow === false ? false : true;
  return { maxHints, maxBombs, includeRainbow };
}

function sanitizeInteger(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return clamp(Math.trunc(number), min, max);
}

function colorsForSettings(settings) {
  if (settings.includeRainbow) {
    return COLORS;
  }
  return COLORS.filter((color) => color.id !== "rainbow");
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function makeRoom(code = createRoomCode(), rawSettings = {}, options = {}) {
  const settings = sanitizeRoomSettings(rawSettings);
  const colors = colorsForSettings(settings);
  const startingSeat = normalizeStartingSeat(options.startingSeat);
  const room = {
    code,
    settings,
    colors,
    startingSeat,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    deck: buildDeck(colors),
    discard: [],
    fireworks: Object.fromEntries(colors.map((color) => [color.id, 0])),
    bombs: 0,
    hints: settings.maxHints,
    clueSelection: null,
    cluePreview: null,
    lastResult: null,
    status: "playing",
    endReason: null,
    finalTurnsRemaining: null,
    finalRoundStartedBy: null,
    endedAt: null,
    turnSeat: startingSeat,
    players: [
      { seat: "A", name: "Player A", hand: [] },
      { seat: "B", name: "Player B", hand: [] }
    ],
    log: [],
    replaySeq: 0,
    actionEvents: [],
    layoutEvents: [],
    knowledge: {
      A: {},
      B: {}
    }
  };

  for (let i = 0; i < HAND_SIZE; i += 1) {
    for (const player of room.players) {
      drawToHand(room, player);
    }
  }

  appendActionEvent(room, "start", {});
  addLog(room, "New game started.");
  return room;
}

function drawToHand(room, player, layout) {
  if (room.deck.length === 0 || player.hand.length >= HAND_SIZE) {
    return null;
  }

  const card = room.deck.pop();
  card.layout = layout || defaultCardLayout(player.hand.length);
  player.hand.push(card);
  return card;
}

function defaultCardLayout(index) {
  const spread = HAND_SIZE === 1 ? 0 : index / (HAND_SIZE - 1);
  return {
    x: Math.round(30 + spread * 40),
    y: 50 + Math.abs(index - 2) * 2,
    rotation: Math.round((index - 2) * 7)
  };
}

function incomingCardLayout(player) {
  return {
    x: 14,
    y: averageHandY(player.hand),
    rotation: 0
  };
}

function averageHandY(hand) {
  if (hand.length === 0) return 54;
  const total = hand.reduce((sum, card) => sum + normalizeLayoutValue(card.layout?.y, 54), 0);
  return Math.round(total / hand.length);
}

function normalizeLayoutValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cardName(card) {
  const color = COLORS.find((item) => item.id === card.color);
  return `${color ? color.label : card.color} ${card.rank}`;
}

function colorLabel(colorId) {
  const color = COLORS.find((item) => item.id === colorId);
  return color ? color.label : colorId;
}

function publicCard(card) {
  return {
    id: card.id,
    color: card.color,
    rank: card.rank
  };
}

function replayCard(card) {
  return {
    ...publicCard(card),
    layout: card.layout
  };
}

function actionResult(type, action, player, card) {
  return {
    type,
    action,
    actorSeat: player.seat,
    cardId: card.id,
    color: card.color,
    rank: card.rank,
    card: publicCard(card)
  };
}

function nextReplaySeq(room) {
  room.replaySeq += 1;
  return room.replaySeq;
}

function replayHandsSnapshot(room) {
  return Object.fromEntries(room.players.map((player) => [
    player.seat,
    player.hand.map(replayCard)
  ]));
}

function replayTableSnapshot(room) {
  return {
    deckCount: room.deck.length,
    discard: room.discard.map(replayCard),
    fireworks: { ...room.fireworks },
    bombs: room.bombs,
    hints: room.hints,
    turnSeat: room.turnSeat,
    status: room.status,
    endReason: room.endReason,
    finalTurnsRemaining: room.finalTurnsRemaining,
    score: scoreRoom(room),
    lastResult: room.lastResult
  };
}

function replaySnapshot(room) {
  return {
    hands: replayHandsSnapshot(room),
    table: replayTableSnapshot(room),
    knowledge: buildReplayKnowledge(room)
  };
}

// Callers that may end the game must capture seq before finishTurn/endGame so the sort keeps their event ahead of end-game.
function appendActionEvent(room, type, payload = {}, options = {}) {
  const snapshot = replaySnapshot(room);
  const event = {
    seq: options.seq ?? nextReplaySeq(room),
    at: Date.now(),
    type,
    ...payload,
    hands: snapshot.hands,
    table: snapshot.table,
    knowledge: snapshot.knowledge
  };
  if (options.preSnapshot) {
    event.preHands = options.preSnapshot.hands;
    event.preTable = options.preSnapshot.table;
    event.preKnowledge = options.preSnapshot.knowledge;
  }
  room.actionEvents.push(event);
  room.actionEvents.sort((a, b) => a.seq - b.seq);
}

function latestReplayEvent(room) {
  const lastAction = room.actionEvents[room.actionEvents.length - 1];
  const lastLayout = room.layoutEvents[room.layoutEvents.length - 1];
  if (!lastLayout) return lastAction || null;
  if (!lastAction) return lastLayout;
  return lastAction.seq > lastLayout.seq ? lastAction : lastLayout;
}

function appendLayoutEvent(room, player) {
  const snapshot = replaySnapshot(room);
  const latest = latestReplayEvent(room);
  const event = {
    seq: nextReplaySeq(room),
    at: Date.now(),
    type: "layout",
    seat: player.seat,
    hands: snapshot.hands,
    table: snapshot.table,
    knowledge: snapshot.knowledge
  };
  if (latest && latest.type === "layout" && latest.seat === player.seat) {
    room.layoutEvents[room.layoutEvents.length - 1] = event;
    return;
  }
  room.layoutEvents.push(event);
}

function buildReplayKnowledge(room) {
  return {
    A: { cards: buildPerspectiveKnowledge(room, "A") },
    B: { cards: buildPerspectiveKnowledge(room, "B") }
  };
}

function buildPerspectiveKnowledge(room, seat) {
  const player = getPlayer(room, seat);
  if (!player) return {};

  return Object.fromEntries(player.hand.map((card) => [
    card.id,
    cardKnowledge(room, seat, card)
  ]));
}

function cardKnowledge(room, seat, card) {
  const facts = room.knowledge[seat]?.[card.id] || {};
  const identities = availableIdentitiesForPerspective(room, seat)
    .filter((identity) => identityMatchesFacts(identity, facts));
  const colorOrder = new Map(room.colors.map((color, index) => [color.id, index]));
  const ranks = uniqueSorted(identities.map((identity) => identity.rank), (a, b) => a - b);
  const colors = uniqueSorted(
    identities.map((identity) => identity.color),
    (a, b) => (colorOrder.get(a) ?? 99) - (colorOrder.get(b) ?? 99)
  );

  return {
    ranks,
    colors,
    identities
  };
}

function uniqueSorted(values, sorter) {
  return [...new Set(values)].sort(sorter);
}

function identityMatchesFacts(identity, facts) {
  if (Array.isArray(facts.possibleRanks) && !facts.possibleRanks.includes(identity.rank)) {
    return false;
  }
  if (Array.isArray(facts.excludedRanks) && facts.excludedRanks.includes(identity.rank)) {
    return false;
  }
  if (Array.isArray(facts.possibleColors) && !facts.possibleColors.includes(identity.color)) {
    return false;
  }
  if (Array.isArray(facts.excludedColors) && facts.excludedColors.includes(identity.color)) {
    return false;
  }
  return true;
}

function availableIdentitiesForPerspective(room, seat) {
  const remaining = identityCountsForRoom(room);
  const visibleCards = visibleCardsForPerspective(room, seat);

  for (const card of visibleCards) {
    decrementIdentityCount(remaining, card);
  }

  for (const card of room.discard) {
    decrementIdentityCount(remaining, card);
  }

  for (const color of room.colors) {
    const highest = room.fireworks[color.id] || 0;
    for (let rank = 1; rank <= highest; rank += 1) {
      decrementIdentityCount(remaining, { color: color.id, rank });
    }
  }

  return room.colors.flatMap((color) =>
    [1, 2, 3, 4, 5]
      .filter((rank) => (remaining.get(identityKey({ color: color.id, rank })) || 0) > 0)
      .map((rank) => ({ color: color.id, rank }))
  );
}

function identityCountsForRoom(room) {
  const counts = new Map();
  const rankCounts = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };

  for (const color of room.colors) {
    for (const [rank, count] of Object.entries(rankCounts)) {
      counts.set(identityKey({ color: color.id, rank: Number(rank) }), count);
    }
  }

  return counts;
}

function visibleCardsForPerspective(room, seat) {
  return room.players
    .filter((player) => player.seat !== seat)
    .flatMap((player) => player.hand);
}

function decrementIdentityCount(counts, card) {
  const key = identityKey(card);
  counts.set(key, Math.max(0, (counts.get(key) || 0) - 1));
}

function identityKey(card) {
  return `${card.color}:${card.rank}`;
}

function applyClueKnowledge(room, targetPlayer, selection) {
  if (!selection?.committed || !selection.clue) return;

  for (const card of targetPlayer.hand) {
    const facts = ensureKnowledgeFacts(room, targetPlayer.seat, card.id);
    const selected = selection.cardIds.includes(card.id);

    if (selection.clue.kind === "rank") {
      if (selected) {
        facts.possibleRanks = intersectValues(facts.possibleRanks, [selection.clue.value]);
      } else {
        facts.excludedRanks = addUnique(facts.excludedRanks, [selection.clue.value]);
      }
      continue;
    }

    const clueColors = colorsForClueKnowledge(room, selection.clue.value);
    if (selected) {
      facts.possibleColors = intersectValues(facts.possibleColors, clueColors);
    } else {
      facts.excludedColors = addUnique(facts.excludedColors, clueColors);
    }
  }
}

function ensureKnowledgeFacts(room, seat, cardId) {
  if (!room.knowledge[seat][cardId]) {
    room.knowledge[seat][cardId] = {};
  }
  return room.knowledge[seat][cardId];
}

function colorsForClueKnowledge(room, colorId) {
  const colors = [colorId];
  if (room.colors.some((color) => color.id === "rainbow")) {
    colors.push("rainbow");
  }
  return colors;
}

function intersectValues(existing, incoming) {
  if (!Array.isArray(existing)) return [...incoming];
  return existing.filter((value) => incoming.includes(value));
}

function addUnique(existing = [], values) {
  return [...new Set([...existing, ...values])];
}

function addLog(room, text) {
  room.log.unshift({
    id: crypto.randomUUID(),
    at: Date.now(),
    text
  });
  room.log = room.log.slice(0, 24);
}

function publicState(room, viewerSeat = "") {
  return {
    code: room.code,
    updatedAt: room.updatedAt,
    version: room.version,
    deckCount: room.deck.length,
    ...(room.status === "ended" ? { remainingDeck: room.deck.slice().reverse().map(publicCard) } : {}),
    discard: room.discard,
    fireworks: room.fireworks,
    bombs: room.bombs,
    maxBombs: room.settings.maxBombs,
    hints: room.hints,
    maxHints: room.settings.maxHints,
    colors: room.colors,
    includeRainbow: room.settings.includeRainbow,
    clueSelection: room.clueSelection,
    cluePreview: room.cluePreview,
    lastResult: room.lastResult,
    status: room.status,
    endReason: room.endReason,
    finalTurnsRemaining: room.finalTurnsRemaining,
    finalRoundStartedBy: room.finalRoundStartedBy,
    endedAt: room.endedAt,
    score: scoreRoom(room),
    maxScore: room.colors.length * 5,
    turnSeat: room.turnSeat,
    presence: connectedSeatPresence(room.code),
    players: room.players.map((player) => ({
      ...player,
      hand: player.hand.map((card) => {
        if (player.seat !== viewerSeat) {
          return card;
        }
        return {
          id: card.id,
          layout: card.layout
        };
      })
    })),
    log: room.log
  };
}

function connectedSeatPresence(roomCode) {
  const roomSubscribers = subscribers.get(roomCode);
  const presence = { A: false, B: false };
  if (!roomSubscribers) return presence;

  for (const subscriber of roomSubscribers) {
    if (subscriber.viewerSeat === "A" || subscriber.viewerSeat === "B") {
      presence[subscriber.viewerSeat] = true;
    }
  }
  return presence;
}

function touch(room) {
  room.version += 1;
  room.updatedAt = Date.now();
  broadcast(room.code);
}

function getPlayer(room, seat) {
  return room.players.find((player) => player.seat === seat);
}

function nextSeat(seat) {
  return seat === "A" ? "B" : "A";
}

function normalizeStartingSeat(seat) {
  return normalizeSeat(seat) === "B" ? "B" : "A";
}

function assertPlayerTurn(room, player) {
  if (room.turnSeat !== player.seat) {
    throw new Error("Not your turn.");
  }
}

function advanceTurn(room) {
  room.turnSeat = nextSeat(room.turnSeat);
}

function takeCard(player, action) {
  const index = action.cardId
    ? player.hand.findIndex((card) => card.id === action.cardId)
    : Number(action.index);

  if (!Number.isInteger(index) || index < 0 || index >= player.hand.length) {
    throw new Error("Invalid card index.");
  }
  return player.hand.splice(index, 1)[0];
}

function selectedTargetCardIds(targetPlayer, cardIds, options = {}) {
  if (!Array.isArray(cardIds)) {
    throw new Error("Select at least one card to clue.");
  }

  const handIds = new Set(targetPlayer.hand.map((card) => card.id));
  const selectedIds = [];
  for (const rawId of cardIds) {
    const id = String(rawId || "");
    if (!handIds.has(id)) {
      throw new Error("Selected clue cards must belong to the target player.");
    }
    if (!selectedIds.includes(id)) {
      selectedIds.push(id);
    }
  }
  if (selectedIds.length === 0 && !options.allowEmpty) {
    throw new Error("Select at least one card to clue.");
  }
  return selectedIds;
}

function normalizeClue(room, clue) {
  const kind = String(clue?.kind || "").toLowerCase();
  if (kind === "rank") {
    const value = Number(clue.value);
    if (Number.isInteger(value) && value >= 1 && value <= 5) {
      return { kind, value };
    }
  }

  if (kind === "color") {
    const value = String(clue.value || "").toLowerCase();
    const isKnownColor = room.colors.some((color) => color.id === value);
    if (value !== "rainbow" && isKnownColor) {
      return { kind, value };
    }
  }

  throw new Error("No valid clue for those cards.");
}

function clueMatchingCardIds(targetPlayer, clue) {
  if (clue.kind === "rank") {
    return targetPlayer.hand.filter((card) => card.rank === clue.value).map((card) => card.id);
  }

  return targetPlayer.hand
    .filter((card) => card.color === clue.value || card.color === "rainbow")
    .map((card) => card.id);
}

function assertExactClueSelection(selectedIds, matchingIds, clue) {
  const selected = new Set(selectedIds);
  const matching = new Set(matchingIds);
  const hasOnlyMatchingCards = selectedIds.every((id) => matching.has(id));
  const hasEveryMatchingCard = matchingIds.every((id) => selected.has(id));

  if (hasOnlyMatchingCards && !hasEveryMatchingCard) {
    throw new Error(`Select all ${clueErrorLabel(clue)}.`);
  }

  if (!hasOnlyMatchingCards || !hasEveryMatchingCard || selectedIds.length === 0) {
    throw new Error("No valid clue for those cards.");
  }
}

function clueErrorLabel(clue) {
  if (clue.kind === "rank") {
    return `${clue.value}s`;
  }
  return `${colorLabel(clue.value)}s`;
}

function clueSelectionLabel(clue, count) {
  if (clue.kind === "rank") {
    const labels = {
      1: "One",
      2: "Two",
      3: "Three",
      4: "Four",
      5: "Five"
    };
    return `${labels[clue.value] || clue.value}${count === 1 ? "" : "s"}`;
  }
  return `${colorLabel(clue.value)}${count === 1 ? "" : "s"}`;
}

function validatedClue(room, targetPlayer, selectedIds, rawClue) {
  const clue = normalizeClue(room, rawClue);
  const matchingIds = clueMatchingCardIds(targetPlayer, clue);
  assertExactClueSelection(selectedIds, matchingIds, clue);
  return {
    ...clue,
    label: clueSelectionLabel(clue, selectedIds.length)
  };
}

function buildClueSelection(room, giver, action, options = {}) {
  const targetSeat = normalizeSeat(action.targetSeat || nextSeat(giver.seat));
  if (targetSeat === giver.seat) {
    throw new Error("Clues must target the other player.");
  }

  const targetPlayer = getPlayer(room, targetSeat);
  if (!targetPlayer) throw new Error("Unknown clue target.");

  const cardIds = selectedTargetCardIds(targetPlayer, action.cardIds, options);
  const clue = options.committed
    ? validatedClue(room, targetPlayer, cardIds, action.clue)
    : null;
  return cardIds.length
    ? {
        seat: targetSeat,
        cardIds,
        committed: options.committed === true,
        ...(clue ? { clue } : {})
      }
    : null;
}

function setClueSelection(room, giver, action, options = {}) {
  const selection = buildClueSelection(room, giver, action, options);
  if (options.preview) {
    room.cluePreview = selection;
  } else {
    room.clueSelection = selection;
  }
}

function pruneClueSelection(room) {
  pruneClueSelectionField(room, "clueSelection");
  pruneClueSelectionField(room, "cluePreview");
}

function pruneClueSelectionField(room, field) {
  if (!room[field]) return;

  const targetPlayer = getPlayer(room, room[field].seat);
  if (!targetPlayer) {
    room[field] = null;
    return;
  }

  const handIds = new Set(targetPlayer.hand.map((card) => card.id));
  room[field].cardIds = room[field].cardIds.filter((id) => handIds.has(id));
}

function clearCommittedClueForActingPlayer(room, player) {
  if (!room.clueSelection?.committed) return;
  if (room.clueSelection.seat === player.seat) {
    room.clueSelection = null;
  }
}

function clearLiveCluePreview(room) {
  room.cluePreview = null;
}

function handleDebugPlayValid(room, action) {
  const seat = normalizeSeat(action.seat || action.viewerSeat || room.turnSeat);
  const player = getPlayer(room, seat);
  if (!player) throw new Error("Unknown seat.");

  const card = takeCard(player, action.cardId ? action : { ...action, index: 0 });
  room.fireworks[card.color] = clamp(card.rank, 0, 5);
  room.lastResult = actionResult("firework", "play", player, card);
  room.hints = clamp(room.hints + 1, 0, room.settings.maxHints);
  const replacement = drawToHand(room, player, incomingCardLayout(player));
  clearLiveCluePreview(room);
  pruneClueSelection(room);
  clearCommittedClueForActingPlayer(room, player);
  addLog(
    room,
    `Debug valid play: ${player.name} played ${cardName(card)}.${replacement ? " Drew a replacement." : ""}`
  );
  if (room.status !== "ended") {
    advanceTurn(room);
  }
  touch(room);
  return room;
}

function scoreRoom(room) {
  return Object.values(room.fireworks).reduce((sum, rank) => sum + rank, 0);
}

function allFireworksComplete(room) {
  return room.colors.every((color) => room.fireworks[color.id] === 5);
}

function assertGameInProgress(room) {
  if (room.status === "ended") {
    throw new Error("Game is over.");
  }
}

function endGame(room, reason) {
  if (room.status === "ended") return;
  room.status = "ended";
  room.endReason = reason;
  room.endedAt = Date.now();
  if (reason === "deck") {
    room.finalTurnsRemaining = 0;
  }
  addLog(room, endGameMessage(room, reason));
  appendActionEvent(room, "end-game", {
    reason,
    score: scoreRoom(room),
    maxScore: room.colors.length * 5
  });
}

function endGameMessage(room, reason) {
  const score = `Score ${scoreRoom(room)}/${room.colors.length * 5}.`;
  if (reason === "perfect") {
    return `Perfect fireworks. ${score}`;
  }
  if (reason === "strikes") {
    return `Third bomb hit. Game over. ${score}`;
  }
  return `Final round complete. ${score}`;
}

function finishTurn(room, player, options = {}) {
  if (room.status === "ended") return;

  let finalRoundStarted = false;
  if (options.drewLastCard && room.finalTurnsRemaining === null) {
    room.finalTurnsRemaining = room.players.length;
    room.finalRoundStartedBy = player.seat;
    finalRoundStarted = true;
    addLog(room, "Last card drawn. Each player gets one final turn.");
  }

  if (!finalRoundStarted && room.finalTurnsRemaining !== null) {
    room.finalTurnsRemaining = Math.max(0, room.finalTurnsRemaining - 1);
    if (room.finalTurnsRemaining === 0) {
      endGame(room, "deck");
      return;
    }
  }

  advanceTurn(room);
}

function handleAction(room, action) {
  const type = String(action.type || "");
  const viewerSeat = normalizeSeat(action.viewerSeat || action.seat);

  if (type === "rename") {
    throw new Error("Name changes are disabled.");
  }

  if (type === "reset") {
    const fresh = makeRoom(room.code, room.settings, {
      startingSeat: nextSeat(normalizeStartingSeat(room.startingSeat))
    });
    rooms.set(room.code, fresh);
    broadcast(room.code);
    return fresh;
  }

  const player = getPlayer(room, viewerSeat);
  if (!player) throw new Error("Unknown seat.");

  if (type === "draw") {
    const card = drawToHand(room, player);
    addLog(room, card ? `${player.name} drew a card.` : "Deck or hand is full.");
    touch(room);
    return room;
  }

  if (type === "give-clue") {
    assertGameInProgress(room);
    assertPlayerTurn(room, player);
    if (room.hints <= 0) {
      throw new Error("No hints left.");
    }
    const preSnapshot = replaySnapshot(room);
    clearCommittedClueForActingPlayer(room, player);
    setClueSelection(room, player, action, { committed: true });
    clearLiveCluePreview(room);
    applyClueKnowledge(room, getPlayer(room, room.clueSelection.seat), room.clueSelection);
    room.lastResult = null;
    room.hints -= 1;
    addLog(room, `${player.name} gave a clue.`);
    const seq = nextReplaySeq(room);
    finishTurn(room, player);
    appendActionEvent(room, "give-clue", {
      actorSeat: player.seat,
      targetSeat: room.clueSelection.seat,
      cardIds: [...room.clueSelection.cardIds],
      clue: { ...room.clueSelection.clue }
    }, { seq, preSnapshot });
    touch(room);
    return room;
  }

  if (type === "clue-selection") {
    assertGameInProgress(room);
    assertPlayerTurn(room, player);
    if (room.hints <= 0) {
      throw new Error("No hints left.");
    }
    setClueSelection(room, player, action, { allowEmpty: true, preview: true });
    touch(room);
    return room;
  }

  if (type === "move-card") {
    const card = player.hand.find((item) => item.id === action.cardId);
    if (!card) throw new Error("Unknown card.");
    const layout = parseLayout(action);
    card.layout = {
      x: clamp(layout.x, 12, 88),
      y: clamp(layout.y, 24, 76),
      rotation: clamp(layout.rotation, -145, 145)
    };
    touch(room);
    return room;
  }

  if (type === "layout-checkpoint") {
    appendLayoutEvent(room, player);
    touch(room);
    return room;
  }

  if (type === "fan") {
    player.hand.forEach((card, index) => {
      card.layout = defaultCardLayout(index);
    });
    touch(room);
    return room;
  }

  if (type === "discard") {
    assertGameInProgress(room);
    assertPlayerTurn(room, player);
    const preSnapshot = replaySnapshot(room);
    const card = takeCard(player, action);
    room.discard.push(card);
    room.lastResult = actionResult("discard", "discard", player, card);
    room.hints = clamp(room.hints + 1, 0, room.settings.maxHints);
    const replacement = drawToHand(room, player, incomingCardLayout(player));
    const drewLastCard = Boolean(replacement) && room.deck.length === 0;
    clearLiveCluePreview(room);
    pruneClueSelection(room);
    clearCommittedClueForActingPlayer(room, player);
    addLog(
      room,
      `${player.name} discarded ${cardName(card)}.${replacement ? " Drew a replacement." : ""}`
    );
    const seq = nextReplaySeq(room);
    finishTurn(room, player, { drewLastCard });
    appendActionEvent(room, "discard", {
      actorSeat: player.seat,
      cardId: card.id,
      card: replayCard(card),
      result: room.lastResult,
      drewReplacement: Boolean(replacement),
      replacementCard: replacement ? replayCard(replacement) : null
    }, { seq, preSnapshot });
    touch(room);
    return room;
  }

  if (type === "play") {
    assertGameInProgress(room);
    assertPlayerTurn(room, player);
    const preSnapshot = replaySnapshot(room);
    const card = takeCard(player, action);
    const nextRank = room.fireworks[card.color] + 1;
    let message = "";
    let exceededBombAllowance = false;

    if (card.rank === nextRank) {
      room.fireworks[card.color] = card.rank;
      room.lastResult = actionResult("firework", "play", player, card);
      room.hints = clamp(room.hints + 1, 0, room.settings.maxHints);
      message = `${player.name} played ${cardName(card)}.`;
    } else {
      room.discard.push(card);
      room.lastResult = actionResult("discard", "play", player, card);
      const nextBombs = room.bombs + 1;
      exceededBombAllowance = nextBombs > room.settings.maxBombs;
      room.bombs = clamp(nextBombs, 0, room.settings.maxBombs);
      message = `${player.name} missed with ${cardName(card)}.`;
    }

    clearLiveCluePreview(room);
    pruneClueSelection(room);
    clearCommittedClueForActingPlayer(room, player);

    if (allFireworksComplete(room)) {
      const seq = nextReplaySeq(room);
      addLog(room, message);
      endGame(room, "perfect");
      appendActionEvent(room, "play", {
        actorSeat: player.seat,
        cardId: card.id,
        card: replayCard(card),
        result: room.lastResult,
        playable: true,
        drewReplacement: false,
        replacementCard: null
      }, { seq, preSnapshot });
      touch(room);
      return room;
    }

    if (exceededBombAllowance) {
      const seq = nextReplaySeq(room);
      addLog(room, message);
      endGame(room, "strikes");
      appendActionEvent(room, "play", {
        actorSeat: player.seat,
        cardId: card.id,
        card: replayCard(card),
        result: room.lastResult,
        playable: false,
        drewReplacement: false,
        replacementCard: null
      }, { seq, preSnapshot });
      touch(room);
      return room;
    }

    const replacement = drawToHand(room, player, incomingCardLayout(player));
    const drewLastCard = Boolean(replacement) && room.deck.length === 0;
    const seq = nextReplaySeq(room);
    addLog(room, `${message}${replacement ? " Drew a replacement." : ""}`);
    finishTurn(room, player, { drewLastCard });
    appendActionEvent(room, "play", {
      actorSeat: player.seat,
      cardId: card.id,
      card: replayCard(card),
      result: room.lastResult,
      playable: card.rank === nextRank,
      drewReplacement: Boolean(replacement),
      replacementCard: replacement ? replayCard(replacement) : null
    }, { seq, preSnapshot });
    touch(room);
    return room;
  }

  throw new Error("Unknown action.");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSeat(seat) {
  return String(seat || "").toUpperCase();
}

function parseLayout(action) {
  const layout = {
    x: Number(action.x),
    y: Number(action.y),
    rotation: Number(action.rotation)
  };
  if (!Number.isFinite(layout.x) || !Number.isFinite(layout.y) || !Number.isFinite(layout.rotation)) {
    throw new Error("Invalid card layout.");
  }
  return layout;
}

function subscribe(roomCode, viewerSeat, response) {
  if (!subscribers.has(roomCode)) {
    subscribers.set(roomCode, new Set());
  }

  const subscriber = { viewerSeat, response };
  subscribers.get(roomCode).add(subscriber);
  broadcast(roomCode);
  const heartbeat = setInterval(() => {
    response.write(": heartbeat\n\n");
  }, 25000);
  response.on("close", () => {
    clearInterval(heartbeat);
    const roomSubscribers = subscribers.get(roomCode);
    if (!roomSubscribers) return;
    roomSubscribers.delete(subscriber);
    if (roomSubscribers.size === 0) {
      subscribers.delete(roomCode);
      return;
    }
    broadcast(roomCode);
  });
}

function broadcast(roomCode) {
  const room = rooms.get(roomCode);
  const roomSubscribers = subscribers.get(roomCode);
  if (!room || !roomSubscribers) return;

  for (const subscriber of roomSubscribers) {
    const payload = `event: state\ndata: ${JSON.stringify(publicState(room, subscriber.viewerSeat))}\n\n`;
    subscriber.response.write(payload);
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendCsv(response, filename, text) {
  response.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${filename}"`
  });
  response.end(text);
}

function sendText(response, filename, text) {
  response.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${filename}"`
  });
  response.end(text);
}

function replayState(room) {
  return {
    code: room.code,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    endedAt: room.endedAt,
    status: room.status,
    endReason: room.endReason,
    score: scoreRoom(room),
    maxScore: room.colors.length * 5,
    settings: room.settings,
    colors: room.colors,
    fireworks: room.fireworks,
    discard: room.discard.map(replayCard),
    players: room.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      hand: player.hand.map(replayCard)
    })),
    highlights: replayHighlights(room),
    actionEvents: room.actionEvents.map(publicReplayEvent),
    layoutEvents: room.layoutEvents
  };
}

function replayRecap(room) {
  const maxScore = room.colors.length * 5;
  const score = scoreRoom(room);
  const highlights = replayHighlights(room);
  const lines = [
    `Bar Hanabi ${room.code}`,
    `Score: ${score}/${maxScore} (${scorePercent(score, room)}%)`,
    `Result: ${endReasonLabel(room.endReason)}`
  ];

  if (highlights.length) {
    lines.push("", "Highlights:");
    for (const highlight of highlights.slice(0, 12)) {
      lines.push(`- ${recapHighlightLine(highlight)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function recapHighlightLine(highlight) {
  const prefix = Number(highlight.moveNumber) > 0 ? `Move ${highlight.moveNumber}` : "Setup";
  return `${prefix}: ${highlight.summary || highlight.title}`;
}

function endReasonLabel(reason) {
  const labels = {
    perfect: "Perfect game",
    strikes: "Bombs",
    deck: "Final round"
  };
  return labels[reason] || "Ended";
}

function replayHighlights(room) {
  const events = [
    ...room.actionEvents,
    ...room.layoutEvents
  ].sort((first, second) => first.seq - second.seq);
  const moveNumberBySeq = buildMoveNumberBySeq(events);
  const highlights = [];
  let previousActionEvent = null;
  const layoutByCardId = new Map();

  for (const event of events) {
    if (event.type === "layout") {
      highlights.push(...layoutHighlights(room, event, moveNumberBySeq, layoutByCardId));
      rememberEventLayouts(layoutByCardId, event);
      continue;
    }

    highlights.push(...actionHighlights(room, event, previousActionEvent, moveNumberBySeq));
    rememberEventLayouts(layoutByCardId, event);
    previousActionEvent = event;
  }

  return highlights;
}

function actionHighlights(room, event, previousEvent, moveNumberBySeq) {
  if (event.type === "start") return [];
  if (event.type === "give-clue") return [];
  if (event.type === "discard") {
    if (event.card?.rank !== 5) return [];

    const before = previousEvent?.table || {};
    const restoredHint = Number(event.table?.hints) > Number(before.hints);
    return [highlightBase(room, event, "critical-discard", moveNumberBySeq, {
      title: `${event.actorSeat} discarded ${cardName(event.card)}`,
      summary: `${event.actorSeat} discarded ${cardName(event.card)}${restoredHint ? " and restored a hint" : ""}.`,
      actorSeat: event.actorSeat,
      card: event.card,
      result: event.result || null,
      hintsBefore: before.hints,
      hintsAfter: event.table?.hints
    })];
  }
  if (event.type === "play") {
    const before = previousEvent?.table || {};
    const scoreBefore = Number(before.score) || 0;
    const scoreAfter = Number(event.table?.score) || 0;
    const base = {
      actorSeat: event.actorSeat,
      card: event.card,
      result: event.result || null,
      scoreBefore,
      scoreAfter,
      scoreDelta: scoreAfter - scoreBefore,
      scorePercentAfter: scorePercent(scoreAfter, room),
      bombsBefore: before.bombs,
      bombsAfter: event.table?.bombs
    };

    if (event.playable) {
      if (event.card?.rank !== 5) return [];

      return [highlightBase(room, event, "firework-complete", moveNumberBySeq, {
        ...base,
        title: `${event.actorSeat} played ${cardName(event.card)}`,
        summary: `${event.actorSeat} played ${cardName(event.card)} for ${scoreAfter}/${room.colors.length * 5}.`
      })];
    }

    return [highlightBase(room, event, "missed-play", moveNumberBySeq, {
      ...base,
      title: `${event.actorSeat} missed with ${cardName(event.card)}`,
      summary: `${event.actorSeat} missed with ${cardName(event.card)}${event.table?.status === "ended" ? " and ended the game" : ""}.`,
      endReason: event.table?.endReason || null
    })];
  }
  if (event.type === "end-game") {
    const score = Number(event.table?.score) || scoreRoom(room);
    return [highlightBase(room, event, "game-end", moveNumberBySeq, {
      title: "Game ended",
      summary: `Game ended with ${score}/${room.colors.length * 5}.`,
      scoreAfter: score,
      scorePercentAfter: scorePercent(score, room),
      endReason: event.reason || event.table?.endReason || room.endReason
    })];
  }
  return [];
}

function layoutHighlights(room, event, moveNumberBySeq, layoutByCardId) {
  const hand = event.hands?.[event.seat] || [];
  return hand
    .filter((card) => card.color === "rainbow" && layoutChanged(layoutByCardId.get(card.id), card.layout))
    .map((card) => highlightBase(room, event, "wild-card-move", moveNumberBySeq, {
      title: `${event.seat} moved ${cardName(card)}`,
      summary: `${event.seat} moved ${cardName(card)} during hand arrangement.`,
      actorSeat: event.seat,
      card,
      layout: card.layout
    }));
}

function highlightBase(room, event, type, moveNumberBySeq, fields = {}) {
  return {
    id: `${room.code}:${event.seq}:${type}:${fields.card?.id || fields.targetSeat || event.type}`,
    seq: event.seq,
    at: event.at,
    moveNumber: moveNumberBySeq.get(event.seq),
    type,
    deckCount: event.table?.deckCount,
    ...fields
  };
}

function rememberEventLayouts(layoutByCardId, event) {
  for (const hand of Object.values(event.hands || {})) {
    for (const card of hand) {
      layoutByCardId.set(card.id, card.layout);
    }
  }
}

function layoutChanged(previousLayout, nextLayout) {
  if (!previousLayout || !nextLayout) return false;
  return previousLayout.x !== nextLayout.x ||
    previousLayout.y !== nextLayout.y ||
    previousLayout.rotation !== nextLayout.rotation;
}

function scorePercent(score, room) {
  const maxScore = room.colors.length * 5;
  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

function publicReplayEvent(event) {
  const { preHands, preTable, preKnowledge, ...publicEvent } = event;
  return publicEvent;
}

const REPLAY_CSV_COLUMNS = [
  "row_type",
  "event_seq",
  "event_type",
  "event_at",
  "code",
  "created_at",
  "ended_at",
  "actor_seat",
  "target_seat",
  "action_card_id",
  "action_card_color",
  "action_card_rank",
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
  "is_newest_card",
  "card_id",
  "card_color",
  "card_rank",
  "possible_colors",
  "possible_ranks",
  "possible_identities",
  "layout_x",
  "layout_y",
  "layout_rotation",
  "pre_deck_count",
  "pre_turn_seat",
  "pre_status",
  "pre_final_turns_remaining",
  "pre_score",
  "pre_hints",
  "pre_bombs",
  "pre_fireworks",
  "pre_discard_ids",
  "pre_end_reason",
  "deck_count",
  "turn_seat",
  "status",
  "final_turns_remaining",
  "score",
  "hints",
  "bombs",
  "fireworks",
  "discard_ids",
  "end_reason",
  "settings_max_hints",
  "settings_max_bombs",
  "include_rainbow",
  "colors",
  "max_score",
  "final_score",
  "move_number"
];

function replayCsv(room) {
  const rows = [REPLAY_CSV_COLUMNS.join(",")];
  rows.push(csvRow(gameCsvFields(room)));

  const events = [
    ...room.actionEvents,
    ...room.layoutEvents
  ].sort((first, second) => first.seq - second.seq);

  const moveNumberBySeq = buildMoveNumberBySeq(events);

  for (const event of events) {
    rows.push(...preHandCsvRows(room, event, moveNumberBySeq));
    rows.push(csvRow(eventCsvFields(room, event, moveNumberBySeq)));
    if (event.type === "layout") {
      rows.push(...layoutCheckpointCsvRows(room, event, moveNumberBySeq));
    }
    rows.push(...handCsvRows(room, event, moveNumberBySeq));
  }

  return `${rows.join("\n")}\n`;
}

function buildMoveNumberBySeq(events) {
  const moveNumberBySeq = new Map();
  let moveNumber = 0;
  for (const event of events) {
    if (event.type === "layout" || event.type === "end-game" || event.type === "start") {
      moveNumberBySeq.set(event.seq, moveNumber);
    } else {
      moveNumber += 1;
      moveNumberBySeq.set(event.seq, moveNumber);
    }
  }
  return moveNumberBySeq;
}

function gameCsvFields(room) {
  return {
    ...roomCsvFields(room),
    ...tableCsvFields(replayTableSnapshot(room), room),
    row_type: "game",
    status: room.status,
    end_reason: room.endReason
  };
}

function eventCsvFields(room, event, moveNumberBySeq) {
  const card = event.card || null;
  const replacement = event.replacementCard || null;
  const result = event.result || {};
  const actorSeat = event.actorSeat || event.seat;
  return {
    ...roomCsvFields(room),
    ...tableCsvFields(event.table, room),
    ...prefixedTableCsvFields("pre_", event.preTable, room),
    row_type: "event",
    event_seq: event.seq,
    event_type: event.type,
    event_at: event.at,
    actor_seat: actorSeat,
    target_seat: event.targetSeat,
    action_card_id: card?.id || event.cardId,
    action_card_color: card?.color,
    action_card_rank: card?.rank,
    clue_kind: event.clue?.kind,
    clue_value: event.clue?.value,
    clue_label: event.clue?.label,
    clued_card_ids: (event.cardIds || []).join("|"),
    result_pile: result.type,
    result_action: result.action,
    play_succeeded: event.playable,
    drew_replacement: event.drewReplacement,
    replacement_card_id: replacement?.id,
    end_reason: event.table?.endReason || event.reason,
    move_number: moveNumberBySeq.get(event.seq)
  };
}

function layoutCheckpointCsvRows(room, event, moveNumberBySeq) {
  const rows = [];
  const hand = event.hands?.[event.seat] || [];
  const newestCard = newestHandCard(hand);
  hand.forEach((card, index) => {
    rows.push(csvRow({
      ...eventCsvFields(room, event, moveNumberBySeq),
      row_type: "layout_checkpoint",
      hand_seat: event.seat,
      hand_index: index,
      is_newest_card: card.id === newestCard?.id,
      card_id: card.id,
      card_color: card.color,
      card_rank: card.rank,
      layout_x: card.layout?.x,
      layout_y: card.layout?.y,
      layout_rotation: card.layout?.rotation
    }));
  });
  return rows;
}

function preHandCsvRows(room, event, moveNumberBySeq) {
  if (!event.preHands || !event.preTable) return [];
  return snapshotHandCsvRows(room, event, moveNumberBySeq, {
    rowType: "pre_hand_card",
    hands: event.preHands,
    table: event.preTable,
    knowledge: event.preKnowledge
  });
}

function handCsvRows(room, event, moveNumberBySeq) {
  return snapshotHandCsvRows(room, event, moveNumberBySeq, {
    rowType: "hand_card",
    hands: event.hands,
    table: event.table,
    knowledge: event.knowledge
  });
}

function snapshotHandCsvRows(room, event, moveNumberBySeq, snapshot) {
  const rows = [];
  for (const seat of ["A", "B"]) {
    const hand = snapshot.hands?.[seat] || [];
    const knowledge = snapshot.knowledge?.[seat]?.cards || {};
    const newestCard = newestHandCard(hand);
    hand.forEach((card, index) => {
      const cardKnowledge = knowledge[card.id] || {};
      rows.push(csvRow({
        ...eventCsvFields(room, event, moveNumberBySeq),
        ...tableCsvFields(snapshot.table, room),
        row_type: snapshot.rowType,
        hand_seat: seat,
        hand_index: index,
        is_newest_card: card.id === newestCard?.id,
        card_id: card.id,
        card_color: card.color,
        card_rank: card.rank,
        possible_colors: (cardKnowledge.colors || []).join("|"),
        possible_ranks: (cardKnowledge.ranks || []).join("|"),
        possible_identities: (cardKnowledge.identities || [])
          .map((identity) => `${identity.color}-${identity.rank}`)
          .join("|"),
        layout_x: card.layout?.x,
        layout_y: card.layout?.y,
        layout_rotation: card.layout?.rotation
      }));
    });
  }
  return rows;
}

function newestHandCard(hand) {
  if (!Array.isArray(hand) || hand.length === 0) return null;
  return hand[hand.length - 1];
}

function roomCsvFields(room) {
  return {
    code: room.code,
    created_at: room.createdAt,
    ended_at: room.endedAt,
    settings_max_hints: room.settings.maxHints,
    settings_max_bombs: room.settings.maxBombs,
    include_rainbow: room.settings.includeRainbow,
    colors: room.colors.map((color) => color.id).join("|"),
    max_score: room.colors.length * 5,
    final_score: scoreRoom(room)
  };
}

function tableCsvFields(table = {}, room) {
  return {
    deck_count: table.deckCount,
    turn_seat: table.turnSeat,
    status: table.status,
    final_turns_remaining: table.finalTurnsRemaining,
    score: table.score,
    hints: table.hints,
    bombs: table.bombs,
    fireworks: serializeFireworks(table.fireworks, room.colors),
    discard_ids: (table.discard || []).map((card) => card.id).join("|"),
    end_reason: table.endReason
  };
}

function prefixedTableCsvFields(prefix, table, room) {
  if (!table) return {};
  return Object.fromEntries(
    Object.entries(tableCsvFields(table, room)).map(([key, value]) => [`${prefix}${key}`, value])
  );
}

function serializeFireworks(fireworks = {}, colors) {
  return colors.map((color) => `${color.id}:${fireworks[color.id] || 0}`).join("|");
}

function csvRow(values) {
  return REPLAY_CSV_COLUMNS.map((column) => csvValue(values[column])).join(",");
}

function csvValue(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".webmanifest": "application/manifest+json; charset=utf-8"
    }[extension] || "application/octet-stream";

    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store"
    });
    response.end(content);
  });
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress || "";
  return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

async function router(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(request);
      const room = makeRoom(createRoomCode(), body);
      rooms.set(room.code, room);
      sendJson(response, 201, { code: room.code });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/rooms") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }
      sendJson(response, 200, { code: room.code });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/replay") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }
      if (room.status !== "ended") {
        sendJson(response, 400, { error: "Replay is available after the game ends." });
        return;
      }
      sendJson(response, 200, replayState(room));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/replay.csv") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }
      if (room.status !== "ended") {
        sendJson(response, 400, { error: "Replay is available after the game ends." });
        return;
      }
      sendCsv(response, `bar-hanabi-${room.code}-replay.csv`, replayCsv(room));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/recap.txt") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }
      if (room.status !== "ended") {
        sendJson(response, 400, { error: "Recap is available after the game ends." });
        return;
      }
      sendText(response, `bar-hanabi-${room.code}-recap.txt`, replayRecap(room));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/debug/play-valid") {
      if (!DEBUG_ACTIONS_ENABLED || !isLoopbackRequest(request)) {
        sendJson(response, 404, { error: "Not found." });
        return;
      }
      const body = await readJson(request);
      const code = String(body.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }
      const nextRoom = handleDebugPlayValid(room, body);
      sendJson(response, 200, publicState(nextRoom, normalizeSeat(body.viewerSeat || body.seat)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/actions") {
      const body = await readJson(request);
      const code = String(body.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }
      const nextRoom = handleAction(room, body);
      sendJson(response, 200, publicState(nextRoom, normalizeSeat(body.viewerSeat || body.seat)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      const viewerSeat = normalizeSeat(url.searchParams.get("seat"));
      response.write("retry: 2000\n\n");
      subscribe(code, viewerSeat, response);
      return;
    }

    if (request.method === "GET") {
      serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Bad request." });
  }
}

const server = http.createServer(router);

server.listen(PORT, () => {
  console.log(`Bar Hanabi running at http://localhost:${PORT}`);
});
