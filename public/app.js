const HAND_SIZE = 5;
const TURN_STATUS_DOUBLE_TAP_MS = 450;
const SEAT_SWITCH_PROMPT_GUARD_MS = 600;
const CARD_ASSET_FADE_MS = 160;
const ACTION_MOVE_MS = 900;
const ACTION_SETTLE_MS = 90;
const DISCARD_CARD_WIDTH = 34;
const DISCARD_CARD_HEIGHT = DISCARD_CARD_WIDTH * 510 / 322;
const MISPLAY_FIRST_LEG_MS = 760;
const MISPLAY_DEFLECT_AT_MS = 600;
const MISPLAY_SECOND_LEG_MS = 680;
const MISPLAY_ARC_LIFT_PX = 88;
const COLORS = [
  { id: "red", label: "Red" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "white", label: "White" },
  { id: "rainbow", label: "Rainbow" }
];

const state = {
  room: null,
  currentCode: null,
  mySeat: "A",
  selectedCards: { A: [], B: [] },
  peerSelectedCards: { A: [], B: [] },
  localLayouts: {},
  appliedClueSelectionKey: "",
  activeDrag: null,
  pendingAction: false,
  pendingRoom: null,
  events: null,
  seenCardIds: new Set(),
  hasRenderedRoom: false,
  lastAnimatedResultKey: "",
  discardRenderKey: "",
  tableStateHold: null,
  pendingDrawAnimation: null,
  toastTimer: null,
  clueChooserResolve: null
};

const setupView = document.querySelector("#setupView");
const gameView = document.querySelector("#gameView");
const createRoomButton = document.querySelector("#createRoomButton");
const joinForm = document.querySelector("#joinForm");
const hintSetting = document.querySelector("#hintSetting");
const bombSetting = document.querySelector("#bombSetting");
const rainbowSetting = document.querySelector("#rainbowSetting");
const roomCodeInput = document.querySelector("#roomCodeInput");
const roomCodeLabel = document.querySelector("#roomCodeLabel");
const turnStatus = document.querySelector("#turnStatus");
const deckCount = document.querySelector("#deckCount");
const bombCount = document.querySelector("#bombCount");
const hintCount = document.querySelector("#hintCount");
const fireworks = document.querySelector("#fireworks");
const selfHand = document.querySelector("#selfHand");
const selfClueLabel = document.querySelector("#selfClueLabel");
const opponentClueLabel = document.querySelector("#opponentClueLabel");
const opponentHand = document.querySelector("#opponentHand");
const selfPlayButton = document.querySelector("#selfPlayButton");
const selfDiscardButton = document.querySelector("#selfDiscardButton");
const verbalClueButton = document.querySelector("#verbalClueButton");
const autoClueToggle = document.querySelector("#autoCluePreviewToggle");
const resetButton = document.querySelector("#resetButton");
const neededDiscardPile = document.querySelector("#neededDiscardPile");
const spentDiscardPile = document.querySelector("#spentDiscardPile");
const toast = document.querySelector("#toast");
const clueChooser = document.querySelector("#clueChooser");
const clueChooserOptions = document.querySelector("#clueChooserOptions");
const clueChooserCancel = document.querySelector("#clueChooserCancel");

let lastTurnStatusTapAt = 0;
let lastSeatSwitchPromptAt = 0;

createRoomButton.addEventListener("click", async () => {
  try {
    const room = await request("/api/rooms", {
      method: "POST",
      body: readSetupSettings()
    });
    await enterRoom(room.code, { defaultSeat: "A", forceSeat: true });
  } catch (error) {
    showToast(error.message);
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) return;

  try {
    await enterRoom(code, { defaultSeat: "B" });
  } catch (error) {
    showToast(error.message);
  }
});

turnStatus.addEventListener("click", handleTurnStatusTap);
turnStatus.addEventListener("keydown", handleTurnStatusKeyDown);
selfPlayButton.addEventListener("click", () => actionSelected(state.mySeat, "play"));
selfDiscardButton.addEventListener("click", () => actionSelected(state.mySeat, "discard"));
verbalClueButton.addEventListener("click", () => giveVerbalClue());
clueChooserCancel.addEventListener("click", () => closeClueChooser(null));
clueChooser.addEventListener("click", (event) => {
  if (event.target === clueChooser) {
    closeClueChooser(null);
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !clueChooser.classList.contains("hidden")) {
    closeClueChooser(null);
  }
});

resetButton.addEventListener("click", async () => {
  if (!window.confirm("Start a fresh game in this room?")) return;
  const updated = await action({ type: "reset" });
  if (updated) {
    resetLocalSelections({ update: false });
    applyRoomState(updated);
  }
});

window.addEventListener("hashchange", () => {
  const code = readHashRoom();
  if (code && code !== state.currentCode) {
    enterRoom(code, { defaultSeat: "B" });
  }
});

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    reconnectCurrentRoom();
  }
});

window.addEventListener("pageshow", () => {
  reconnectCurrentRoom();
});

const initialRoom = readHashRoom();
if (initialRoom) {
  enterRoom(initialRoom, { defaultSeat: "B" });
}

function readHashRoom() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return (params.get("room") || "").trim().toUpperCase();
}

function readSetupSettings() {
  return {
    hints: Number(hintSetting.value),
    bombs: Number(bombSetting.value),
    rainbow: rainbowSetting.checked
  };
}

async function enterRoom(code, options = {}) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  try {
    await request(`/api/rooms?code=${encodeURIComponent(normalizedCode)}`);
  } catch (error) {
    leaveRoom("Room expired. Create a new room.");
    return;
  }

  resetLocalSelections();
  state.mySeat = options.forceSeat
    ? normalizeSeatOption(options.defaultSeat, "A")
    : seatForRoom(normalizedCode, options.defaultSeat || "B");
  rememberSeatForRoom(normalizedCode, state.mySeat);
  state.currentCode = normalizedCode;
  window.location.hash = `room=${encodeURIComponent(normalizedCode)}`;
  setupView.classList.add("hidden");
  gameView.classList.remove("hidden");
  roomCodeLabel.textContent = normalizedCode;
  connectEvents(normalizedCode);
}

function roomSeatKey(code) {
  return `barHanabiSeat:${code}`;
}

function seatForRoom(code, fallbackSeat) {
  return normalizeSeatOption(localStorage.getItem(roomSeatKey(code)), fallbackSeat);
}

function rememberSeatForRoom(code, seat) {
  localStorage.setItem(roomSeatKey(code), normalizeSeatOption(seat, "A"));
}

function normalizeSeatOption(seat, fallbackSeat) {
  const normalized = String(seat || "").toUpperCase();
  return normalized === "A" || normalized === "B" ? normalized : fallbackSeat;
}

function handleTurnStatusTap(event) {
  if (!state.room) return;
  const now = Date.now();
  if (event.detail >= 2 || now - lastTurnStatusTapAt <= TURN_STATUS_DOUBLE_TAP_MS) {
    event.preventDefault();
    lastTurnStatusTapAt = 0;
    confirmSeatSwitch();
    return;
  }
  lastTurnStatusTapAt = now;
}

function handleTurnStatusKeyDown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  confirmSeatSwitch();
}

function confirmSeatSwitch() {
  if (!state.room) return;
  const now = Date.now();
  if (now - lastSeatSwitchPromptAt < SEAT_SWITCH_PROMPT_GUARD_MS) return;
  lastSeatSwitchPromptAt = now;

  const nextSeat = opponentSeat();
  if (!window.confirm("Switch to the other player?")) return;
  switchSeat(nextSeat);
}

function switchSeat(nextSeat) {
  const normalizedSeat = normalizeSeatOption(nextSeat, state.mySeat);
  if (normalizedSeat === state.mySeat) return;
  state.mySeat = normalizedSeat;
  resetLocalSelections();
  localStorage.setItem("barHanabiSeat", state.mySeat);
  if (state.room) {
    rememberSeatForRoom(state.room.code, state.mySeat);
    connectEvents(state.room.code);
  }
  render();
}

function leaveRoom(message) {
  if (state.events) {
    state.events.close();
    state.events = null;
  }
  state.currentCode = null;
  state.room = null;
  state.seenCardIds.clear();
  resetLocalSelections();
  state.hasRenderedRoom = false;
  setupView.classList.remove("hidden");
  gameView.classList.add("hidden");
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  showToast(message);
}

function connectEvents(code) {
  if (state.events) {
    state.events.close();
  }

  setConnection(false);
  state.events = new EventSource(`/events?code=${encodeURIComponent(code)}&seat=${encodeURIComponent(state.mySeat)}`);

  state.events.addEventListener("open", () => {
    setConnection(true);
  });

  state.events.addEventListener("state", (event) => {
    applyRoomState(JSON.parse(event.data));
  });

  state.events.addEventListener("error", () => {
    setConnection(false);
  });
}

function reconnectCurrentRoom() {
  if (!state.currentCode || !state.room) return;
  connectEvents(state.currentCode);
}

function applyRoomState(nextRoom) {
  const previousTableRoom = tableDisplayRoom();
  const animation = actionAnimationSnapshot(nextRoom);
  fadeRetiredResultHighlight(previousTableRoom, nextRoom);
  if (animation && previousTableRoom) {
    if (animation.replacement) {
      state.pendingDrawAnimation = {
        key: animation.key,
        seat: animation.replacement.seat,
        cardId: animation.replacement.card.id
      };
    } else {
      clearPendingDrawAnimation(animation.key, { update: false });
    }
    holdTableStateForAnimation(animation.key, previousTableRoom);
  }
  state.room = nextRoom;
  clearMissingSelections();
  applySharedSelection();
  setConnection(true);
  if (state.activeDrag) {
    state.pendingRoom = state.room;
    return;
  }
  render();
  if (animation && !animateActionResult(animation)) {
    releaseTableStateHold(animation.key);
    clearPendingDrawAnimation(animation.key);
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json"
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function action(payload, options = {}) {
  if (!state.room) return;
  try {
    return await request("/api/actions", {
      method: "POST",
      body: {
        code: state.room.code,
        viewerSeat: state.mySeat,
        ...payload
      }
    });
  } catch (error) {
    if (!options.silent) {
      showToast(error.message);
    }
    return null;
  }
}

function scheduleAction(payload, options = {}) {
  setTimeout(() => {
    action(payload, options);
  }, 0);
}

function render() {
  if (!state.room) return;

  const me = playerForSeat(state.mySeat);
  const other = playerForSeat(opponentSeat());
  const tableRoom = tableDisplayRoom();
  roomCodeLabel.textContent = state.room.code;
  const isMyTurn = state.room.turnSeat === state.mySeat;

  turnStatus.textContent = turnStatusText(isMyTurn);
  deckCount.textContent = tableRoom.deckCount;
  hintCount.textContent = `${tableRoom.hints}/${tableRoom.maxHints}`;
  bombCount.textContent = `${tableRoom.bombs}/${tableRoom.maxBombs}`;
  updateActionButtons();

  renderFireworks(tableRoom);
  renderHand(selfHand, me, { concealed: true, movable: true });
  renderHand(opponentHand, other, { concealed: false, movable: false, animateLayout: true });
  renderClueLabels();
  renderDiscard(tableRoom);
  markSeenCards();
}

function tableDisplayRoom() {
  return state.tableStateHold?.room || state.room;
}

function holdTableStateForAnimation(key, room) {
  state.tableStateHold = {
    key,
    room: { ...room, lastResult: null }
  };
}

function releaseTableStateHold(key) {
  if (!state.tableStateHold || state.tableStateHold.key !== key) return;
  state.tableStateHold = null;
  if (state.room) {
    render();
  }
}

function fadeRetiredResultHighlight(previousRoom, nextRoom) {
  if (!previousRoom?.lastResult) return;
  if (resultIdentity(previousRoom.lastResult) === resultIdentity(nextRoom?.lastResult)) return;

  document.querySelectorAll(".last-result-highlight").forEach((element) => {
    createResultHighlightFade(element);
  });
}

function createResultHighlightFade(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const styles = window.getComputedStyle(element);
  const offset = cssPixels(styles.getPropertyValue("--result-highlight-offset"), 2);
  const width = cssPixels(styles.getPropertyValue("--result-highlight-width"), 2);
  const radius = cssPixels(styles.getPropertyValue("--result-highlight-radius"), 6);
  const fade = document.createElement("div");
  fade.className = "result-highlight-fade";
  fade.style.left = `${rect.left - offset}px`;
  fade.style.top = `${rect.top - offset}px`;
  fade.style.width = `${rect.width + offset * 2}px`;
  fade.style.height = `${rect.height + offset * 2}px`;
  fade.style.border = `${width}px solid var(--own-selection-ring)`;
  fade.style.borderRadius = `${radius + offset}px`;
  fade.addEventListener("animationend", () => {
    fade.remove();
  }, { once: true });
  document.body.append(fade);
  return fade;
}

function resultIdentity(result) {
  if (!result) return "";
  return [
    result.action,
    result.type,
    result.cardId,
    result.color,
    result.rank
  ].join(":");
}

function renderFireworks(room) {
  const colors = Array.isArray(room.colors) && room.colors.length > 0 ? room.colors : COLORS;
  fireworks.replaceChildren(
    ...colors.map((color) => {
      const tile = document.createElement("div");
      tile.className = `firework color-${color.id}`;
      const value = room.fireworks[color.id] || 0;
      const isLastFirework = room.lastResult?.type === "firework" && room.lastResult.color === color.id;
      tile.classList.toggle("empty-firework", value === 0);
      tile.classList.toggle("last-result-highlight", isLastFirework);
      tile.setAttribute("aria-label", `${color.label} firework ${value}`);
      tile.title = color.label;

      const rank = document.createElement("strong");
      rank.textContent = value;

      tile.replaceChildren(rank);
      return tile;
    })
  );
}

function renderHand(surface, player, options) {
  if (!player) {
    surface.replaceChildren();
    return;
  }

  const previousLayouts = previousLayoutsByCardId(surface);
  const existingElements = elementsByCardId(surface);
  const surfaceSize = surfaceSizeFor(surface);
  const cards = player.hand.map((card, index) => {
    const existingElement = existingElements.get(card.id);
    const element = existingElement || document.createElement("article");
    const visualMode = cardHasDetails(card) && !options.concealed ? "face" : "back";
    const isLocallySelected = selectedCardIds(player.seat).includes(card.id);
    const isPeerSelected = peerSelectedCardIds(player.seat).includes(card.id);
    const isOwnSelected = player.seat === state.mySeat && isLocallySelected && canSelectOwnCards();
    const isOtherSelected = (player.seat !== state.mySeat && isLocallySelected && canSelectOpponentCards()) || isPeerSelected;
    const isSelected = isOwnSelected || isOtherSelected;
    const isPendingDraw = isPendingDrawCard(player.seat, card.id);
    const localLayout = player.seat === state.mySeat ? state.localLayouts[card.id] : null;
    const targetLayout = normalizeLayout(localLayout || card.layout || fallbackLayout(index));
    const previousLayout = previousLayouts.get(card.id);
    const canAnimateLayout = options.animateLayout === true && player.seat !== state.mySeat;
    const shouldAnimateLayout = canAnimateLayout && previousLayout && !layoutsEqual(previousLayout, targetLayout);
    if (!existingElement) {
      element.className = "table-card";
    } else {
      element.classList.remove("concealed-card", "visible-card", "color-undefined");
      COLORS.forEach((color) => element.classList.remove(`color-${color.id}`));
    }
    element.classList.add(visualMode === "back" ? "concealed-card" : "visible-card");
    if (visualMode === "face") {
      element.classList.add(`color-${card.color}`);
    }
    element.classList.toggle("selected", isSelected);
    element.classList.toggle("own-card-selected", isOwnSelected);
    element.classList.toggle("other-card-selected", isOtherSelected);
    element.classList.toggle("layout-animating", canAnimateLayout);
    element.classList.toggle("draw-pending", isPendingDraw);
    element.dataset.seat = player.seat;
    element.dataset.cardId = card.id;
    syncCardVisual(element, card, visualMode);
    element.style.zIndex = String(10 + index + (isSelected ? 100 : 0));
    element.classList.toggle("new-card", !isPendingDraw && !existingElement && state.hasRenderedRoom && !state.seenCardIds.has(card.id));
    if (shouldAnimateLayout && existingElement) {
      applyLayout(element, targetLayout, surfaceSize);
    } else if (shouldAnimateLayout) {
      applyLayout(element, previousLayout, surfaceSize);
      if (previousLayout.transform && previousLayout.transform !== "none") {
        element.style.transform = previousLayout.transform;
      }
      requestAnimationFrame(() => {
        applyLayout(element, targetLayout, surfaceSize);
      });
    } else {
      applyLayout(element, targetLayout, surfaceSize);
    }

    if (!existingElement) {
      bindCardPointer(element, surface, player, card, options);
    }
    return element;
  });

  syncHandChildren(surface, cards);
}

function syncCardVisual(element, card, visualMode) {
  const nextColor = visualMode === "face" ? card.color : "";
  const nextRank = visualMode === "face" ? String(card.rank) : "";
  const needsVisual =
    element.dataset.visualMode !== visualMode ||
    element.dataset.cardColor !== nextColor ||
    element.dataset.cardRank !== nextRank ||
    element.children.length === 0;

  if (needsVisual) {
    element.replaceChildren(visualMode === "face" ? createCardFace(card) : createCardBack());
  }

  element.dataset.visualMode = visualMode;
  element.dataset.cardColor = nextColor;
  element.dataset.cardRank = nextRank;
}

function cardHasDetails(card) {
  return COLORS.some((color) => color.id === card.color) && Number.isFinite(Number(card.rank));
}

function createCardBack() {
  const wrapper = document.createElement("div");
  wrapper.className = "card-back";
  const image = document.createElement("img");
  image.className = "card-back-art";
  image.alt = "";
  image.decoding = "async";
  image.loading = "eager";
  revealCardImageWhenReady(wrapper, image);
  image.src = cardBackAssetPath();
  wrapper.append(image);
  return wrapper;
}

function createCardFace(card) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-face";

  const image = document.createElement("img");
  image.className = "card-art";
  image.alt = "";
  image.decoding = "async";
  image.loading = "eager";
  revealCardImageWhenReady(wrapper, image);
  image.src = cardAssetPath(card);

  wrapper.append(image);
  return wrapper;
}

function revealCardImageWhenReady(wrapper, image) {
  const reveal = () => wrapper.classList.add("asset-loaded");
  image.addEventListener("load", reveal, { once: true });
  image.addEventListener("error", () => image.remove(), { once: true });
  requestAnimationFrame(() => {
    if (image.complete && image.naturalWidth > 0) {
      reveal();
    }
  });
}

function cardAssetPath(card) {
  return `assets/cards/${card.color}-${card.rank}.webp`;
}

function cardBackAssetPath() {
  return "assets/cards/back.webp";
}

function bindCardPointer(element, surface, player, card, options) {
  element.addEventListener("pointerdown", (event) => {
    if (options.concealed) {
      selectCard(player.seat, card.id);
    } else {
      if (!canSelectOpponentCards()) return;
      selectCard(player.seat, card.id, { multi: true });
      return;
    }

    if (!options.movable) {
      return;
    }

    event.preventDefault();
    element.setPointerCapture(event.pointerId);

    const rect = surface.getBoundingClientRect();
    const surfaceSize = { width: rect.width, height: rect.height };
    const startLayout = normalizeLayout(state.localLayouts[card.id] || card.layout);
    const start = {
      x: event.clientX,
      y: event.clientY,
      layout: startLayout,
      moved: false,
      lastSyncAt: 0
    };
    let latestLayout = startLayout;
    state.activeDrag = { seat: player.seat, cardId: card.id };
    element.classList.remove("layout-animating");

    function sendMove(force) {
      const now = Date.now();
      if (!force && now - start.lastSyncAt < 140) return;
      start.lastSyncAt = now;
      scheduleAction({
        type: "move-card",
        seat: player.seat,
        cardId: card.id,
        ...latestLayout
      });
    }

    function onPointerMove(moveEvent) {
      const dx = ((moveEvent.clientX - start.x) / rect.width) * 100;
      const dy = ((moveEvent.clientY - start.y) / rect.height) * 100;
      const x = clamp(start.layout.x + dx, 12, 88);
      const y = clamp(start.layout.y + dy, 24, 76);
      latestLayout = {
        x,
        y,
        rotation: autoRotationForX(x)
      };
      start.moved = true;
      card.layout = latestLayout;
      rememberLocalLayout(card.id, latestLayout);
      element.classList.remove("layout-animating");
      applyLayout(element, latestLayout, surfaceSize);
      sendMove(false);
    }

    function finishDrag(shouldCommit) {
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
      state.activeDrag = null;

      if (!shouldCommit) {
        card.layout = startLayout;
        rememberLocalLayout(card.id, startLayout);
        applyLayout(element, startLayout, surfaceSize);
      } else if (start.moved) {
        sendMove(true);
      }

      if (state.pendingRoom) {
        state.pendingRoom = null;
        render();
      }
    }

    function onPointerUp() {
      finishDrag(true);
    }

    function onPointerCancel() {
      finishDrag(false);
    }

    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);
  });
}

function cardElementById(surface, cardId) {
  return [...surface.querySelectorAll(".table-card")].find((element) => element.dataset.cardId === cardId);
}

function elementsByCardId(surface) {
  const elements = new Map();
  surface.querySelectorAll(".table-card").forEach((element) => {
    if (element.dataset.cardId) {
      elements.set(element.dataset.cardId, element);
    }
  });
  return elements;
}

function syncHandChildren(surface, elements) {
  elements.forEach((element, index) => {
    const current = surface.children[index];
    if (current !== element) {
      surface.insertBefore(element, current || null);
    }
  });

  while (surface.children.length > elements.length) {
    surface.lastElementChild.remove();
  }
}

function surfaceSizeFor(surface) {
  const rect = surface.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function applyLayout(element, layout, surfaceSize = surfaceSizeFor(element.parentElement)) {
  const next = normalizeLayout(layout);
  const x = (surfaceSize.width * next.x) / 100;
  const y = (surfaceSize.height * next.y) / 100;
  const transform = `translate3d(calc(${x}px - 50%), calc(${y}px - 50%), 0) rotate(${next.rotation}deg)`;
  element.style.setProperty("--card-layout-x", `${x}px`);
  element.style.setProperty("--card-layout-y", `${y}px`);
  element.style.setProperty("--card-layout-rotation", `${next.rotation}deg`);
  element.style.setProperty("--card-transform", transform);
  element.style.transform = transform;
  element.dataset.layoutX = String(next.x);
  element.dataset.layoutY = String(next.y);
  element.dataset.layoutRotation = String(next.rotation);
}

function previousLayoutsByCardId(surface) {
  const layouts = new Map();
  surface.querySelectorAll(".table-card").forEach((element) => {
    const layout = {
      x: Number(element.dataset.layoutX),
      y: Number(element.dataset.layoutY),
      rotation: Number(element.dataset.layoutRotation),
      transform: getComputedStyle(element).transform
    };
    if (element.dataset.cardId && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.rotation)) {
      layouts.set(element.dataset.cardId, normalizeLayout(layout));
    }
  });
  return layouts;
}

function layoutsEqual(first, second) {
  return first.x === second.x && first.y === second.y && first.rotation === second.rotation;
}

function rememberLocalLayout(cardId, layout) {
  state.localLayouts[cardId] = normalizeLayout(layout);
}

function pruneLocalLayouts() {
  if (!state.room) {
    state.localLayouts = {};
    return;
  }

  const ownPlayer = playerForSeat(state.mySeat);
  const validIds = new Set((ownPlayer?.hand || []).map((card) => card.id));
  for (const cardId of Object.keys(state.localLayouts)) {
    if (!validIds.has(cardId)) {
      delete state.localLayouts[cardId];
    }
  }
}

function normalizeLayout(layout) {
  const next = layout || fallbackLayout(0);
  const x = Number.isFinite(Number(next.x)) ? Number(next.x) : 50;
  const y = Number.isFinite(Number(next.y)) ? Number(next.y) : 54;
  const clampedX = clamp(x, 12, 88);
  const rotation = Number.isFinite(Number(next.rotation)) ? Number(next.rotation) : autoRotationForX(clampedX);
  return {
    x: clampedX,
    y: clamp(y, 24, 76),
    rotation: clamp(rotation, -145, 145)
  };
}

function autoRotationForX(x) {
  const distanceFromCenter = clamp((x - 50) / 36, -1, 1);
  return Math.round(Math.sign(distanceFromCenter) * 145 * Math.pow(Math.abs(distanceFromCenter), 2.4));
}

function fallbackLayout(index) {
  const spread = HAND_SIZE === 1 ? 0 : index / (HAND_SIZE - 1);
  const x = Math.round(30 + spread * 40);
  return {
    x,
    y: 50 + Math.abs(index - 2) * 2,
    rotation: Math.round((index - 2) * 7)
  };
}

function selectCard(seat, cardId, options = {}) {
  if (seat === state.mySeat) {
    if (!canSelectOwnCards()) {
      state.selectedCards[seat] = [];
      updateSelectionClasses();
      return;
    }
    clearOpponentClueDraftIfNeeded();
  } else if (seat === opponentSeat()) {
    state.selectedCards[state.mySeat] = [];
  }

  const current = selectedCardIds(seat);
  const nextSelectedCards = options.multi
    ? current.includes(cardId)
      ? current.filter((id) => id !== cardId)
      : [...current, cardId]
    : [cardId];

  state.selectedCards[seat] = nextSelectedCards;
  updateSelectionClasses();
  syncLiveClueSelection(seat);
}

function clearOpponentClueDraftIfNeeded() {
  const targetSeat = opponentSeat();
  if (selectedCardIds(targetSeat).length === 0) return;
  state.selectedCards[targetSeat] = [];
  if (!canSelectOpponentCards()) return;
  action({
    type: "clue-selection",
    targetSeat,
    cardIds: []
  }, { silent: true });
}

function syncLiveClueSelection(seat) {
  if (seat !== opponentSeat()) return;
  if (!canSelectOpponentCards()) return;
  action({
    type: "clue-selection",
    targetSeat: seat,
    cardIds: selectedCardIds(seat)
  }, { silent: true });
}

function selectedCardIds(seat) {
  const selected = state.selectedCards[seat];
  if (Array.isArray(selected)) return selected;
  return selected ? [selected] : [];
}

function peerSelectedCardIds(seat) {
  const selected = state.peerSelectedCards[seat];
  if (Array.isArray(selected)) return selected;
  return selected ? [selected] : [];
}

function isPendingDrawCard(seat, cardId) {
  return state.pendingDrawAnimation?.seat === seat && state.pendingDrawAnimation?.cardId === cardId;
}

function resetLocalSelections(options = {}) {
  state.selectedCards = { A: [], B: [] };
  state.peerSelectedCards = { A: [], B: [] };
  state.localLayouts = {};
  state.appliedClueSelectionKey = "";
  state.activeDrag = null;
  state.pendingAction = false;
  state.pendingRoom = null;
  if (!options.keepTableStateHold) {
    state.tableStateHold = null;
    state.pendingDrawAnimation = null;
  }
  if (options.update !== false) {
    updateSelectionClasses();
  }
}

function updateSelectionClasses() {
  document.querySelectorAll(".table-card").forEach((element) => {
    const isLocallySelected = selectedCardIds(element.dataset.seat).includes(element.dataset.cardId);
    const isPeerSelected = peerSelectedCardIds(element.dataset.seat).includes(element.dataset.cardId);
    const isOwnSelected = element.dataset.seat === state.mySeat && isLocallySelected && canSelectOwnCards();
    const isOtherSelected = (element.dataset.seat !== state.mySeat && isLocallySelected && canSelectOpponentCards()) || isPeerSelected;
    const isSelected = isOwnSelected || isOtherSelected;
    element.classList.toggle("selected", isSelected);
    element.classList.toggle("own-card-selected", isOwnSelected);
    element.classList.toggle("other-card-selected", isOtherSelected);
    const index = [...element.parentElement.children].indexOf(element);
    element.style.zIndex = String(10 + index + (isSelected ? 100 : 0));
  });
  updateActionButtons();
}

function updateActionButtons() {
  if (!state.room) return;
  const isMyTurn = state.room.turnSeat === state.mySeat;
  const canAct = state.room.status !== "ended" && isMyTurn;
  const selectedActionCard = selectedCard(state.mySeat);
  selfPlayButton.disabled = state.pendingAction || !canAct || !selectedActionCard;
  selfDiscardButton.disabled = state.pendingAction || !canAct || !selectedActionCard;
  verbalClueButton.disabled = state.pendingAction || !canAct || state.room.hints <= 0 || !hasValidOpponentClueSelection();
}

async function actionSelected(seat, type) {
  if (state.pendingAction) return;
  const card = selectedCard(seat);
  if (!card) {
    showToast("Select a card first.");
    return;
  }

  state.pendingAction = true;
  updateActionButtons();
  const updated = await action({ type, seat, cardId: card.id });
  state.pendingAction = false;
  if (updated) {
    resetLocalSelections({ update: false, keepTableStateHold: true });
    applyRoomState(updated);
  } else {
    updateActionButtons();
  }
}

async function giveVerbalClue() {
  const targetSeat = opponentSeat();
  const targetCardIds = selectedCardIds(targetSeat);
  if (targetCardIds.length === 0) {
    showToast("Select their cards first.");
    return;
  }

  const candidates = clueCandidatesForSelection(targetSeat, targetCardIds);
  if (candidates.length === 0) {
    showToast(clueSelectionError(targetSeat, targetCardIds));
    return;
  }

  const autoSendClue = autoClueToggle.checked && candidates.length === 1;
  const clue = autoSendClue ? candidates[0] : await chooseClueCandidate(candidates);
  if (!clue) return;

  const updated = await action({
    type: "verbal-clue",
    targetSeat,
    cardIds: targetCardIds,
    clue: { kind: clue.kind, value: clue.value }
  });
  if (updated) {
    resetLocalSelections({ update: false });
    applyRoomState(updated);
  }
}

function clueCandidatesForSelection(targetSeat, selectedIds) {
  const hand = playerForSeat(targetSeat)?.hand || [];
  return [
    ...rankClueCandidates(hand, selectedIds),
    ...colorClueCandidates(hand, selectedIds)
  ];
}

function rankClueCandidates(hand, selectedIds) {
  return [1, 2, 3, 4, 5]
    .map((rank) => {
      const matchingCards = hand.filter((card) => card.rank === rank);
      return clueCandidateFromCards("rank", rank, matchingCards, selectedIds);
    })
    .filter(Boolean);
}

function colorClueCandidates(hand, selectedIds) {
  return clueColors()
    .filter((color) => color.id !== "rainbow")
    .map((color) => {
      const matchingCards = hand.filter((card) => card.color === color.id || card.color === "rainbow");
      return clueCandidateFromCards("color", color.id, matchingCards, selectedIds);
    })
    .filter(Boolean);
}

function clueCandidateFromCards(kind, value, matchingCards, selectedIds) {
  if (matchingCards.length === 0) return null;
  const matchingIds = matchingCards.map((card) => card.id);
  if (!sameIdSet(selectedIds, matchingIds)) return null;
  return {
    kind,
    value,
    label: clueLabel(kind, value, selectedIds.length),
    errorLabel: clueErrorLabel(kind, value),
    matchingIds
  };
}

async function chooseClueCandidate(candidates) {
  return showClueChooser(candidates);
}

function showClueChooser(candidates) {
  closeClueChooser(null);
  return new Promise((resolve) => {
    state.clueChooserResolve = resolve;
    clueChooserOptions.replaceChildren();

    for (const candidate of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clue-choice-button";
      button.textContent = candidate.label;
      button.addEventListener("click", () => closeClueChooser(candidate));
      clueChooserOptions.append(button);
    }

    clueChooser.classList.remove("hidden");
    clueChooserOptions.querySelector("button")?.focus();
  });
}

function closeClueChooser(result) {
  if (!clueChooser) return;
  clueChooser.classList.add("hidden");
  clueChooserOptions.replaceChildren();

  const resolve = state.clueChooserResolve;
  state.clueChooserResolve = null;
  if (resolve) resolve(result);
}

function clueSelectionError(targetSeat, selectedIds) {
  const hand = playerForSeat(targetSeat)?.hand || [];
  const partialCandidates = [
    ...partialRankClueCandidates(hand, selectedIds),
    ...partialColorClueCandidates(hand, selectedIds)
  ];
  const candidate = partialCandidates[0];
  if (candidate) {
    return `Select all ${candidate.errorLabel}.`;
  }
  return "No valid clue for those cards.";
}

function partialRankClueCandidates(hand, selectedIds) {
  return [1, 2, 3, 4, 5]
    .map((rank) => {
      const matchingIds = hand.filter((card) => card.rank === rank).map((card) => card.id);
      return partialClueCandidate("rank", rank, matchingIds, selectedIds);
    })
    .filter(Boolean);
}

function partialColorClueCandidates(hand, selectedIds) {
  return clueColors()
    .filter((color) => color.id !== "rainbow")
    .map((color) => {
      const matchingIds = hand
        .filter((card) => card.color === color.id || card.color === "rainbow")
        .map((card) => card.id);
      return partialClueCandidate("color", color.id, matchingIds, selectedIds);
    })
    .filter(Boolean);
}

function partialClueCandidate(kind, value, matchingIds, selectedIds) {
  if (matchingIds.length === 0 || selectedIds.length === 0) return null;
  if (!selectedIds.every((id) => matchingIds.includes(id))) return null;
  if (sameIdSet(selectedIds, matchingIds)) return null;
  return {
    kind,
    value,
    errorLabel: clueErrorLabel(kind, value)
  };
}

function sameIdSet(firstIds, secondIds) {
  if (firstIds.length !== secondIds.length) return false;
  const second = new Set(secondIds);
  return firstIds.every((id) => second.has(id));
}

function clueLabel(kind, value, count) {
  if (kind === "rank") {
    const names = {
      1: "One",
      2: "Two",
      3: "Three",
      4: "Four",
      5: "Five"
    };
    return `${names[value] || value}${count === 1 ? "" : "s"}`;
  }
  return `${colorLabel(value)}${count === 1 ? "" : "s"}`;
}

function clueErrorLabel(kind, value) {
  return kind === "rank" ? `${value}s` : `${colorLabel(value)}s`;
}

function clueColors() {
  return Array.isArray(state.room?.colors) && state.room.colors.length > 0 ? state.room.colors : COLORS;
}

function renderClueLabels() {
  const selection = state.room?.clueSelection;
  if (!selection?.committed || !selection.clue?.label) {
    renderSingleClueLabel(selfClueLabel, null);
    renderSingleClueLabel(opponentClueLabel, null);
    return;
  }

  renderSingleClueLabel(selfClueLabel, selection.seat === state.mySeat ? selection : null);
  renderSingleClueLabel(opponentClueLabel, selection.seat === opponentSeat() ? selection : null);
}

function renderSingleClueLabel(selfClueLabel, selection) {
  if (!selection) {
    selfClueLabel.hidden = true;
    selfClueLabel.replaceChildren();
    return;
  }

  selfClueLabel.textContent = selection.clue.label;
  selfClueLabel.hidden = false;
}

function selectedCard(seat) {
  if (seat === state.mySeat && !canSelectOwnCards()) return null;
  const player = playerForSeat(seat);
  if (!player) return null;
  const [cardId] = selectedCardIds(seat);
  return player.hand.find((card) => card.id === cardId) || null;
}

function actionAnimationSnapshot(nextRoom) {
  const result = nextRoom?.lastResult;
  if (!result?.card || !result.actorSeat || !result.cardId) return null;
  if (result.type !== "firework" && result.type !== "discard") return null;

  const key = actionResultAnimationKey(nextRoom, result);
  if (!key || key === state.lastAnimatedResultKey) return null;

  const surface = result.actorSeat === state.mySeat ? selfHand : opponentHand;
  const element = cardElementById(surface, result.cardId);
  if (!element) return null;

  const startRect = actionCardStartRect(element);
  if (startRect.width <= 0 || startRect.height <= 0) return null;

  return {
    key,
    result,
    replacement: replacementCardSnapshot(nextRoom, result),
    concealed: result.actorSeat === state.mySeat,
    startRect
  };
}

function replacementCardSnapshot(nextRoom, result) {
  const previousPlayer = state.room?.players.find((player) => player.seat === result.actorSeat);
  const nextPlayer = nextRoom?.players.find((player) => player.seat === result.actorSeat);
  if (!previousPlayer || !nextPlayer) return null;

  const previousIds = new Set(previousPlayer.hand.map((card) => card.id));
  const replacement = nextPlayer.hand.find((card) => !previousIds.has(card.id));
  if (!replacement) return null;

  return {
    seat: result.actorSeat,
    card: replacement,
    concealed: result.actorSeat === state.mySeat
  };
}

function actionCardStartRect(element) {
  const bounds = element.getBoundingClientRect();
  const width = element.offsetWidth || bounds.width;
  const height = element.offsetHeight || bounds.height;
  return {
    left: bounds.left + bounds.width / 2 - width / 2,
    top: bounds.top + bounds.height / 2 - height / 2,
    width,
    height,
    rotation: Number(element.dataset.layoutRotation) || 0
  };
}

function actionResultAnimationKey(room, result) {
  if (!room || !result) return "";
  return [
    room.code,
    room.version,
    result.actorSeat,
    result.action,
    result.type,
    result.cardId,
    result.rank
  ].join(":");
}

function rectSnapshot(rect) {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    rotation: 0
  };
}

function animateActionResult(snapshot) {
  if (!snapshot || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

  const path = actionResultPath(snapshot.result);
  if (!path) return false;

  state.lastAnimatedResultKey = snapshot.key;
  const overlay = createActionCardOverlay(snapshot);
  document.body.append(overlay);

  window.requestAnimationFrame(() => {
    overlay.classList.add("is-revealed");
  });

  const revealDelay = snapshot.concealed ? 1100 : 700;
  window.setTimeout(() => {
    const moveDuration = moveActionResultOverlay(overlay, snapshot.startRect, path);
    window.setTimeout(() => {
      finishActionOverlay(snapshot, overlay);
    }, moveDuration + ACTION_SETTLE_MS);
  }, revealDelay);

  return true;
}

function actionResultPath(result) {
  const targetRect = actionResultTargetRect(result);
  if (!targetRect) return null;
  if (!isMissedPlayResult(result)) {
    return { targetRect };
  }

  const attemptedTarget = fireworkElementForColor(result.card.color);
  if (!attemptedTarget) {
    return { targetRect };
  }

  return {
    targetRect,
    deflectRect: rectSnapshot(attemptedTarget.getBoundingClientRect())
  };
}

function isMissedPlayResult(result) {
  return result.type === "discard" && result.action === "play";
}

function createActionCardOverlay(snapshot) {
  const overlay = document.createElement("article");
  overlay.className = "action-card-overlay";
  overlay.dataset.resultType = snapshot.result.type;
  placeActionCardOverlay(overlay, snapshot.startRect);
  if (!snapshot.concealed) {
    overlay.classList.add("is-revealed");
  }

  const flipper = document.createElement("div");
  flipper.className = "action-card-flipper";

  const back = document.createElement("div");
  back.className = "action-card-side action-card-back-side";
  back.append(createCardBack());

  const face = document.createElement("div");
  face.className = "action-card-side action-card-face-side";
  face.append(createCardFace(snapshot.result.card));

  flipper.append(back, face);
  overlay.append(flipper);
  return overlay;
}

function placeActionCardOverlay(overlay, rect) {
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.transform = `rotate(${rect.rotation}deg)`;
}

function moveActionResultOverlay(overlay, startRect, path) {
  if (!path.deflectRect) {
    moveActionCardOverlay(overlay, startRect, path.targetRect, ACTION_MOVE_MS);
    return ACTION_MOVE_MS;
  }

  moveActionCardOverlay(overlay, startRect, path.deflectRect, MISPLAY_FIRST_LEG_MS);
  window.setTimeout(() => {
    arcActionCardOverlay(overlay, startRect, path.targetRect, MISPLAY_SECOND_LEG_MS);
  }, MISPLAY_DEFLECT_AT_MS);
  return MISPLAY_DEFLECT_AT_MS + MISPLAY_SECOND_LEG_MS;
}

function moveActionCardOverlay(overlay, startRect, targetRect, durationMs) {
  const scale = clamp(targetRect.height / startRect.height, 0.28, 0.54);
  overlay.style.transitionDuration = `${durationMs}ms`;
  overlay.style.left = `${targetRect.left + targetRect.width / 2 - startRect.width / 2}px`;
  overlay.style.top = `${targetRect.top + targetRect.height / 2 - startRect.height / 2}px`;
  overlay.style.transform = `rotate(0deg) scale(${scale})`;
  overlay.classList.add("is-moving");
}

function arcActionCardOverlay(overlay, startRect, targetRect, durationMs) {
  const current = currentActionOverlayPlacement(overlay);
  const target = actionOverlayTargetPlacement(startRect, targetRect);
  const distance = Math.hypot(target.left - current.left, target.top - current.top);
  const lift = Math.min(150, Math.max(MISPLAY_ARC_LIFT_PX, distance * 0.28));
  const control = {
    left: current.left + (target.left - current.left) * 0.42,
    top: Math.min(current.top, target.top) - lift
  };
  const startedAt = performance.now();
  overlay.style.transition = "none";

  function step(now) {
    const progress = clamp((now - startedAt) / durationMs, 0, 1);
    const eased = easeOutCubic(progress);
    const left = quadraticBezier(current.left, control.left, target.left, eased);
    const top = quadraticBezier(current.top, control.top, target.top, eased);
    const scale = current.scale + (target.scale - current.scale) * eased;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.transform = `rotate(0deg) scale(${scale})`;
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function currentActionOverlayPlacement(overlay) {
  const styles = getComputedStyle(overlay);
  return {
    left: cssPixels(styles.left),
    top: cssPixels(styles.top),
    scale: transformScale(styles.transform)
  };
}

function actionOverlayTargetPlacement(startRect, targetRect) {
  return {
    left: targetRect.left + targetRect.width / 2 - startRect.width / 2,
    top: targetRect.top + targetRect.height / 2 - startRect.height / 2,
    scale: clamp(targetRect.height / startRect.height, 0.28, 0.54)
  };
}

function transformScale(transform) {
  if (!transform || transform === "none") return 1;
  const values = transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(",").map(Number);
  if (!values || values.length < 2) return 1;
  return Math.hypot(values[0], values[1]);
}

function quadraticBezier(start, control, end, t) {
  const inverse = 1 - t;
  return inverse * inverse * start + 2 * inverse * t * control + t * t * end;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function finishActionOverlay(snapshot, overlay) {
  overlay.remove();
  releaseTableStateHold(snapshot.key);
  window.requestAnimationFrame(() => {
    animateReplacementDraw(snapshot);
  });
}

function animateReplacementDraw(snapshot) {
  const replacement = snapshot.replacement;
  if (!replacement) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    clearPendingDrawAnimation(snapshot.key);
    return;
  }

  const surface = replacement.seat === state.mySeat ? selfHand : opponentHand;
  const targetElement = cardElementById(surface, replacement.card.id);
  const sourceRect = deckSourceRect();
  if (!targetElement || !sourceRect) {
    clearPendingDrawAnimation(snapshot.key);
    return;
  }

  const targetRect = actionCardStartRect(targetElement);
  if (targetRect.width <= 0 || targetRect.height <= 0) {
    clearPendingDrawAnimation(snapshot.key);
    return;
  }

  const startRect = centeredRect(sourceRect, targetRect.width, targetRect.height);
  const overlay = createDrawCardOverlay(replacement, startRect);
  document.body.append(overlay);
  overlay.getBoundingClientRect();

  window.requestAnimationFrame(() => {
    moveDrawCardOverlay(overlay, targetRect);
  });

  window.setTimeout(() => {
    clearPendingDrawAnimation(snapshot.key);
    overlay.classList.add("is-settled");
    window.setTimeout(() => {
      overlay.remove();
    }, 180);
  }, 620);
}

function createDrawCardOverlay(replacement, rect) {
  const overlay = document.createElement("article");
  overlay.className = "draw-card-overlay";
  placeDrawCardOverlay(overlay, rect, 0.42);
  overlay.append(replacement.concealed || !cardHasDetails(replacement.card)
    ? createCardBack()
    : createCardFace(replacement.card));
  return overlay;
}

function moveDrawCardOverlay(overlay, targetRect) {
  overlay.style.left = `${targetRect.left}px`;
  overlay.style.top = `${targetRect.top}px`;
  overlay.style.width = `${targetRect.width}px`;
  overlay.style.height = `${targetRect.height}px`;
  overlay.style.transform = `rotate(${targetRect.rotation}deg) scale(1)`;
  overlay.classList.add("is-moving");
}

function placeDrawCardOverlay(overlay, rect, scale) {
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.transform = `rotate(${rect.rotation}deg) scale(${scale})`;
}

function deckSourceRect() {
  const deckTile = deckCount.closest("div");
  if (!deckTile) return null;
  return rectSnapshot(deckTile.getBoundingClientRect());
}

function centeredRect(sourceRect, width, height) {
  return {
    left: sourceRect.left + sourceRect.width / 2 - width / 2,
    top: sourceRect.top + sourceRect.height / 2 - height / 2,
    width,
    height,
    rotation: 0
  };
}

function clearPendingDrawAnimation(key, options = {}) {
  if (!state.pendingDrawAnimation) return;
  if (key && state.pendingDrawAnimation.key !== key) return;
  state.pendingDrawAnimation = null;
  if (options.update !== false && state.room) {
    render();
  }
}

function actionResultTargetRect(result) {
  const target = result.type === "firework"
    ? fireworkElementForColor(result.card.color)
    : discardElementForCard(result.card.id) || discardEndTargetRect(result.card);
  if (!target) return null;
  return target instanceof Element ? rectSnapshot(target.getBoundingClientRect()) : target;
}

function fireworkElementForColor(color) {
  return [...fireworks.querySelectorAll(".firework")].find((element) => element.classList.contains(`color-${color}`));
}

function discardElementForCard(cardId) {
  return [...document.querySelectorAll(".mini-card")].find((element) => element.dataset.cardId === cardId);
}

function discardBucketForCard(card) {
  return isDiscardStillNeeded(card, state.room) ? neededDiscardPile : spentDiscardPile;
}

function discardEndTargetRect(card) {
  const bucket = discardBucketForCard(card);
  if (!bucket) return null;

  const cards = [...bucket.querySelectorAll(".mini-card")];
  const lastCard = cards[cards.length - 1];
  const bucketRect = bucket.getBoundingClientRect();
  const styles = window.getComputedStyle(bucket);
  const borderLeft = cssPixels(styles.borderLeftWidth);
  const borderTop = cssPixels(styles.borderTopWidth);
  const borderRight = cssPixels(styles.borderRightWidth);
  const paddingLeft = cssPixels(styles.paddingLeft);
  const paddingTop = cssPixels(styles.paddingTop);
  const paddingRight = cssPixels(styles.paddingRight);
  const columnGap = cssPixels(styles.columnGap || styles.gap, 5);
  const rowGap = cssPixels(styles.rowGap || styles.gap, 5);
  const cardRect = lastCard?.getBoundingClientRect();
  const cardWidth = cardRect?.width || DISCARD_CARD_WIDTH;
  const cardHeight = cardRect?.height || DISCARD_CARD_HEIGHT;
  const leftEdge = bucketRect.left + borderLeft + paddingLeft;

  if (!cardRect) {
    return {
      left: leftEdge,
      top: bucketRect.top + borderTop + paddingTop,
      width: cardWidth,
      height: cardHeight,
      rotation: 0
    };
  }

  const nextLeft = cardRect.right + columnGap;
  const rightEdge = bucketRect.right - borderRight - paddingRight;
  if (nextLeft + cardWidth <= rightEdge + 0.5) {
    return {
      left: nextLeft,
      top: cardRect.top,
      width: cardWidth,
      height: cardHeight,
      rotation: 0
    };
  }

  return {
    left: leftEdge,
    top: cardRect.bottom + rowGap,
    width: cardWidth,
    height: cardHeight,
    rotation: 0
  };
}

function markSeenCards() {
  const nextIds = new Set();
  for (const player of state.room.players) {
    for (const card of player.hand) {
      nextIds.add(card.id);
    }
  }
  state.seenCardIds = nextIds;
  state.hasRenderedRoom = true;
}

function clearMissingSelections() {
  if (!state.room) return;
  for (const player of state.room.players) {
    const validIds = new Set(player.hand.map((card) => card.id));
    state.selectedCards[player.seat] = selectedCardIds(player.seat).filter((id) => validIds.has(id));
    state.peerSelectedCards[player.seat] = peerSelectedCardIds(player.seat).filter((id) => validIds.has(id));
  }
  pruneLocalLayouts();
}

function applySharedSelection() {
  const selectionKey = [
    selectionKeyPart(state.room?.clueSelection),
    selectionKeyPart(state.room?.cluePreview)
  ].join("|");
  if (selectionKey === state.appliedClueSelectionKey) return;

  clearPeerSelection();
  state.appliedClueSelectionKey = selectionKey;
  for (const selection of sharedSelectionsForView()) {
    const player = playerForSeat(selection.seat);
    if (!player) continue;
    const validIds = new Set(player.hand.map((card) => card.id));
    const selectedIds = selection.cardIds.filter((id) => validIds.has(id));
    state.peerSelectedCards[selection.seat] = uniqueIds([
      ...peerSelectedCardIds(selection.seat),
      ...selectedIds
    ]);
  }
}

function sharedSelectionsForView() {
  return [state.room?.clueSelection, state.room?.cluePreview]
    .filter((selection) => selection && selection.cardIds.length > 0);
}

function selectionKeyPart(selection) {
  if (!selection) return "";
  return `${selection.seat}:${selection.cardIds.join(",")}:${selection.committed ? "committed" : "preview"}`;
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

function clearPeerSelection() {
  state.peerSelectedCards = { A: [], B: [] };
  if (state.appliedClueSelectionKey) {
    state.appliedClueSelectionKey = "";
  }
}

function hasSelectedOpponentCards() {
  return selectedCardIds(opponentSeat()).length > 0;
}

function hasValidOpponentClueSelection() {
  return selectedOpponentClueCandidates().length > 0;
}

function selectedOpponentClueCandidates() {
  const targetCardIds = selectedCardIds(opponentSeat());
  if (targetCardIds.length === 0) return [];
  return clueCandidatesForSelection(opponentSeat(), targetCardIds);
}

function canSelectOpponentCards() {
  return state.room && state.room.status !== "ended" && state.room.turnSeat === state.mySeat && state.room.hints > 0;
}

function canSelectOwnCards() {
  return state.room && state.room.status !== "ended" && state.room.turnSeat === state.mySeat;
}

function renderDiscard(room) {
  const cards = room.discard.slice(-30);
  const renderKey = discardRenderKey(room, cards);
  if (renderKey === state.discardRenderKey) return;
  state.discardRenderKey = renderKey;

  const existingElements = discardElementsByCardId();
  const needed = [];
  const spent = [];
  for (const card of cards) {
    let element = existingElements.get(card.id);
    if (!element) {
      element = createMiniCard(card);
    }
    updateMiniCard(element, card, isLastDiscard(card, room));
    (isDiscardStillNeeded(card, room) ? needed : spent).push(element);
  }
  syncDiscardChildren(neededDiscardPile, needed);
  syncDiscardChildren(spentDiscardPile, spent);
}

function discardRenderKey(room, cards) {
  return [
    room.code,
    ...cards.map((card) => [
      card.id,
      isDiscardStillNeeded(card, room) ? "needed" : "spent",
      isLastDiscard(card, room) ? "last" : ""
    ].join(":"))
  ].join("|");
}

function createMiniCard(card, highlighted = false) {
  const item = document.createElement("div");
  item.className = "mini-card";
  updateMiniCard(item, card, highlighted);
  item.replaceChildren(createCardFace(card));
  return item;
}

function updateMiniCard(item, card, highlighted = false) {
  item.classList.toggle("last-result-highlight", highlighted);
  item.dataset.cardId = card.id;
  const label = colorLabel(card.color);
  item.title = `${label} ${card.rank}`;
  item.setAttribute("aria-label", `${label} ${card.rank}`);
}

function discardElementsByCardId() {
  const elements = new Map();
  document.querySelectorAll(".mini-card").forEach((element) => {
    if (element.dataset.cardId) {
      elements.set(element.dataset.cardId, element);
    }
  });
  return elements;
}

function syncDiscardChildren(pile, elements) {
  elements.forEach((element, index) => {
    const current = pile.children[index];
    if (current !== element) {
      pile.insertBefore(element, current || null);
    }
  });

  while (pile.children.length > elements.length) {
    pile.lastElementChild.remove();
  }
}

function isLastDiscard(card, room = state.room) {
  return room.lastResult?.type === "discard" && room.lastResult.cardId === card.id;
}

function isDiscardStillNeeded(card, room = state.room) {
  return card.rank > (room.fireworks[card.color] || 0);
}

function playerForSeat(seat) {
  if (!state.room) return null;
  return state.room.players.find((player) => player.seat === seat);
}

function opponentSeat() {
  return state.mySeat === "A" ? "B" : "A";
}

function colorLabel(colorId) {
  const color = COLORS.find((item) => item.id === colorId);
  return color ? color.label : colorId;
}

function turnStatusText(isMyTurn) {
  if (state.room?.status === "ended") {
    return `Game Over ${state.room.score}/${state.room.maxScore}`;
  }
  if (state.room?.finalTurnsRemaining !== null && state.room?.finalTurnsRemaining !== undefined) {
    return isMyTurn ? "Final turn" : `Final turns: ${state.room.finalTurnsRemaining}`;
  }
  return isMyTurn ? "Your Turn" : "Their Turn";
}

function setConnection(isOnline) {
  gameView.dataset.connection = isOnline ? "online" : "offline";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cssPixels(value, fallback = 0) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : fallback;
}
