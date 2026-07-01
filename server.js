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
    log: []
  };

  for (let i = 0; i < HAND_SIZE; i += 1) {
    for (const player of room.players) {
      drawToHand(room, player);
    }
  }

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

  if (type === "verbal-clue") {
    assertGameInProgress(room);
    assertPlayerTurn(room, player);
    if (room.hints <= 0) {
      throw new Error("No hints left.");
    }
    clearCommittedClueForActingPlayer(room, player);
    setClueSelection(room, player, action, { committed: true });
    clearLiveCluePreview(room);
    room.lastResult = null;
    room.hints -= 1;
    addLog(room, `${player.name} gave a verbal clue.`);
    finishTurn(room, player);
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
    finishTurn(room, player, { drewLastCard });
    touch(room);
    return room;
  }

  if (type === "play") {
    assertGameInProgress(room);
    assertPlayerTurn(room, player);
    const card = takeCard(player, action);
    const nextRank = room.fireworks[card.color] + 1;
    let message = "";

    if (card.rank === nextRank) {
      room.fireworks[card.color] = card.rank;
      room.lastResult = actionResult("firework", "play", player, card);
      room.hints = clamp(room.hints + 1, 0, room.settings.maxHints);
      message = `${player.name} played ${cardName(card)}.`;
    } else {
      room.discard.push(card);
      room.lastResult = actionResult("discard", "play", player, card);
      room.bombs = clamp(room.bombs + 1, 0, room.settings.maxBombs);
      message = `${player.name} missed with ${cardName(card)}.`;
    }

    clearLiveCluePreview(room);
    pruneClueSelection(room);
    clearCommittedClueForActingPlayer(room, player);

    if (allFireworksComplete(room)) {
      addLog(room, message);
      endGame(room, "perfect");
      touch(room);
      return room;
    }

    if (room.bombs >= room.settings.maxBombs) {
      addLog(room, message);
      endGame(room, "strikes");
      touch(room);
      return room;
    }

    const replacement = drawToHand(room, player, incomingCardLayout(player));
    const drewLastCard = Boolean(replacement) && room.deck.length === 0;
    addLog(room, `${message}${replacement ? " Drew a replacement." : ""}`);
    finishTurn(room, player, { drewLastCard });
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
