const HAND_SIZE = 5;
const TURN_STATUS_DOUBLE_TAP_MS = 450;
const SEAT_SWITCH_PROMPT_GUARD_MS = 600;
const CARD_ASSET_FADE_MS = 160;
const SELECTION_EXIT_MS = 220;
const CLUE_LABEL_EXIT_MS = 180;
const CLUE_CHOOSER_EXIT_MS = 180;
const ACTION_MOVE_MS = 900;
const ACTION_SETTLE_MS = 90;
const CARD_LAYOUT_SYNC_MS = 140;
const CARD_LAYOUT_ANIMATION_MS = 220;
const DISCARD_CARD_WIDTH = 34;
const DISCARD_CARD_HEIGHT = DISCARD_CARD_WIDTH * 510 / 322;
const MISPLAY_FIRST_LEG_MS = 760;
const MISPLAY_DEFLECT_AT_MS = 600;
const MISPLAY_SECOND_LEG_MS = 680;
const MISPLAY_ARC_LIFT_PX = 88;
const PLAYER_PREFERENCES_STORAGE_KEY = "barHanabiPreferences:v1";
const VALID_HINT_PREFERENCES = [1, 2, 3, 4, 5, 6, 7, 8];
const VALID_BOMB_PREFERENCES = [0, 1, 2, 3];
const DEFAULT_PLAYER_PREFERENCES = Object.freeze({
  hints: 8,
  bombs: 3,
  rainbow: true,
  autoClue: false,
  manualRotation: false
});
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
  selectionExitKinds: {},
  selectionExitTimers: {},
  localLayouts: {},
  layoutAnimationCardIds: {},
  layoutAnimationTimers: {},
  appliedClueSelectionKey: "",
  activeDrag: null,
  pendingAction: false,
  pendingRoom: null,
  events: null,
  isOnline: false,
  clueChooserHideTimer: null,
  seenCardIds: new Set(),
  hasRenderedRoom: false,
  lastAnimatedResultKey: "",
  discardRenderKey: "",
  fireworkRenderKey: "",
  tableStateHold: null,
  pendingDrawAnimation: null,
  toastTimer: null,
  clueChooserResolve: null,
  settingsPopoverHideTimer: null,
  rotationWheelAnimationFrame: null,
  deckRevealHideTimer: null,
  rotationWheelAnimationTimer: null
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
const deckTile = document.querySelector("#deckTile");
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
const clueButton = document.querySelector("#clueButton");
const rotationWheel = document.querySelector("#rotationWheel");
const settingsButton = document.querySelector("#settingsButton");
const settingsPopover = document.querySelector("#settingsPopover");
const settingsCloseButton = document.querySelector("#settingsCloseButton");
const autoClueToggle = document.querySelector("#autoCluePreviewToggle");
const manualRotationToggle = document.querySelector("#manualRotationToggle");
const resetButton = document.querySelector("#resetButton");
const neededDiscardPile = document.querySelector("#neededDiscardPile");
const spentDiscardPile = document.querySelector("#spentDiscardPile");
const toast = document.querySelector("#toast");
const clueChooser = document.querySelector("#clueChooser");
const clueChooserOptions = document.querySelector("#clueChooserOptions");
const clueChooserCancel = document.querySelector("#clueChooserCancel");
const deckReveal = document.querySelector("#deckReveal");
const deckRevealGrid = document.querySelector("#deckRevealGrid");
const deckRevealCount = document.querySelector("#deckRevealCount");
const deckRevealCloseButton = document.querySelector("#deckRevealCloseButton");

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
roomCodeLabel.addEventListener("click", () => copyRoomLink());
deckTile.addEventListener("click", () => openDeckReveal());
selfPlayButton.addEventListener("click", () => actionSelected(state.mySeat, "play"));
selfDiscardButton.addEventListener("click", () => actionSelected(state.mySeat, "discard"));
clueButton.addEventListener("click", () => giveClue());
rotationWheel.addEventListener("pointerdown", handleRotationWheelPointerDown);
hintSetting.addEventListener("change", savePlayerPreferences);
bombSetting.addEventListener("change", savePlayerPreferences);
rainbowSetting.addEventListener("change", savePlayerPreferences);
autoClueToggle.addEventListener("change", savePlayerPreferences);
manualRotationToggle.addEventListener("change", () => {
  savePlayerPreferences();
  handleManualRotationToggle();
});
settingsButton.addEventListener("click", () => toggleSettingsPopover());
settingsCloseButton.addEventListener("click", () => closeSettingsPopover());
settingsPopover.addEventListener("click", (event) => {
  if (event.target === settingsPopover) {
    closeSettingsPopover();
  }
});
clueChooserCancel.addEventListener("click", () => closeClueChooser(null));
clueChooser.addEventListener("click", (event) => {
  if (event.target === clueChooser) {
    closeClueChooser(null);
  }
});
deckRevealCloseButton.addEventListener("click", () => closeDeckReveal());
deckReveal.addEventListener("click", (event) => {
  if (event.target === deckReveal) {
    closeDeckReveal();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !deckReveal.classList.contains("hidden")) {
    closeDeckReveal();
  } else if (event.key === "Escape" && !clueChooser.classList.contains("hidden")) {
    closeClueChooser(null);
  } else if (event.key === "Escape" && !settingsPopover.classList.contains("hidden")) {
    closeSettingsPopover();
  }
});

resetButton.addEventListener("click", async () => {
  closeSettingsPopover();
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

applyPlayerPreferences(loadPlayerPreferences());
installDebugActions();

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

function loadPlayerPreferences() {
  const rawPreferences = storageGetItem(PLAYER_PREFERENCES_STORAGE_KEY);
  if (!rawPreferences) {
    return DEFAULT_PLAYER_PREFERENCES;
  }

  try {
    return normalizePlayerPreferences(JSON.parse(rawPreferences));
  } catch {
    return DEFAULT_PLAYER_PREFERENCES;
  }
}

function applyPlayerPreferences(preferences) {
  const normalized = normalizePlayerPreferences(preferences);
  hintSetting.value = String(normalized.hints);
  bombSetting.value = String(normalized.bombs);
  rainbowSetting.checked = normalized.rainbow;
  autoClueToggle.checked = normalized.autoClue;
  manualRotationToggle.checked = normalized.manualRotation;
}

function savePlayerPreferences() {
  storageSetItem(PLAYER_PREFERENCES_STORAGE_KEY, JSON.stringify(readPlayerPreferences()));
}

function readPlayerPreferences() {
  return normalizePlayerPreferences({
    ...readSetupSettings(),
    autoClue: autoClueToggle.checked,
    manualRotation: manualRotationToggle.checked
  });
}

function normalizePlayerPreferences(preferences = {}) {
  const source = preferences && typeof preferences === "object" ? preferences : {};
  return {
    hints: normalizePreferenceOption(source.hints, VALID_HINT_PREFERENCES, DEFAULT_PLAYER_PREFERENCES.hints),
    bombs: normalizePreferenceOption(source.bombs, VALID_BOMB_PREFERENCES, DEFAULT_PLAYER_PREFERENCES.bombs),
    rainbow: normalizeBooleanPreference(source.rainbow, DEFAULT_PLAYER_PREFERENCES.rainbow),
    autoClue: normalizeBooleanPreference(source.autoClue, DEFAULT_PLAYER_PREFERENCES.autoClue),
    manualRotation: normalizeBooleanPreference(source.manualRotation, DEFAULT_PLAYER_PREFERENCES.manualRotation)
  };
}

function normalizePreferenceOption(value, validValues, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  const normalized = Math.trunc(number);
  return validValues.includes(normalized) ? normalized : fallback;
}

function normalizeBooleanPreference(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
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
  updateRoomCodeLabel(normalizedCode);
  connectEvents(normalizedCode);
}

function updateRoomCodeLabel(code) {
  const normalizedCode = String(code || state.currentCode || state.room?.code || "").trim().toUpperCase();
  const status = roomCodeStatus(normalizedCode);
  roomCodeLabel.textContent = status.label;
  roomCodeLabel.dataset.presence = status.presence;
  roomCodeLabel.setAttribute("aria-label", `Copy room link for ${normalizedCode}`);
}

function roomCodeStatus(code) {
  if (state.room && !state.isOnline) {
    return { label: "Reconnecting", presence: "reconnecting" };
  }
  if (otherPlayerConnected()) {
    return { label: "Connected", presence: "connected" };
  }
  return { label: code, presence: "code" };
}

function roomSeatKey(code) {
  return `barHanabiSeat:${code}`;
}

function seatForRoom(code, fallbackSeat) {
  return normalizeSeatOption(storageGetItem(roomSeatKey(code)), fallbackSeat);
}

function rememberSeatForRoom(code, seat) {
  storageSetItem(roomSeatKey(code), normalizeSeatOption(seat, "A"));
}

function storageGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
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

function toggleSettingsPopover() {
  if (settingsPopover.classList.contains("hidden")) {
    openSettingsPopover();
  } else {
    closeSettingsPopover();
  }
}

function openSettingsPopover() {
  window.clearTimeout(state.settingsPopoverHideTimer);
  state.settingsPopoverHideTimer = null;
  settingsPopover.classList.remove("hidden", "is-closing");
  settingsPopover.setAttribute("aria-hidden", "false");
  settingsButton.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    settingsPopover.classList.add("is-open");
    settingsPopover.querySelector("button, input")?.focus();
  });
}

function closeSettingsPopover() {
  if (!settingsPopover || settingsPopover.classList.contains("hidden")) return;
  window.clearTimeout(state.settingsPopoverHideTimer);
  settingsPopover.classList.remove("is-open");
  settingsPopover.classList.add("is-closing");
  settingsPopover.setAttribute("aria-hidden", "true");
  settingsButton.setAttribute("aria-expanded", "false");

  const finish = () => {
    settingsPopover.classList.add("hidden");
    settingsPopover.classList.remove("is-closing");
    state.settingsPopoverHideTimer = null;
  };

  state.settingsPopoverHideTimer = window.setTimeout(finish, CLUE_CHOOSER_EXIT_MS);
}

function updateDeckRevealState(room) {
  if (!room) return;
  const canRevealDeck = room.status === "ended" && Array.isArray(room.remainingDeck);
  deckTile.disabled = !canRevealDeck;
  deckTile.classList.toggle("is-revealable", canRevealDeck);
  const deckRevealCollapsed = deckReveal.classList.contains("hidden") || deckReveal.classList.contains("is-closing");
  deckTile.setAttribute("aria-expanded", deckRevealCollapsed ? "false" : "true");
  deckTile.setAttribute("aria-label", canRevealDeck
    ? `Show remaining deck (${room.remainingDeck.length} ${room.remainingDeck.length === 1 ? "card" : "cards"})`
    : `Deck (${room.deckCount} ${room.deckCount === 1 ? "card" : "cards"})`);
  if (canRevealDeck) {
    renderRemainingDeck(room.remainingDeck);
  } else {
    closeDeckReveal({ immediate: true });
  }
}

function openDeckReveal() {
  if (deckTile.disabled || !Array.isArray(state.room?.remainingDeck)) return;
  renderRemainingDeck(state.room.remainingDeck);
  window.clearTimeout(state.deckRevealHideTimer);
  state.deckRevealHideTimer = null;
  deckReveal.classList.remove("hidden", "is-closing");
  deckReveal.setAttribute("aria-hidden", "false");
  deckTile.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    deckReveal.classList.add("is-open");
    deckRevealCloseButton.focus();
  });
}

function closeDeckReveal(options = {}) {
  if (!deckReveal || deckReveal.classList.contains("hidden")) return;
  window.clearTimeout(state.deckRevealHideTimer);
  deckReveal.classList.remove("is-open");
  deckReveal.classList.add("is-closing");
  deckReveal.setAttribute("aria-hidden", "true");
  deckTile.setAttribute("aria-expanded", "false");
  if (deckReveal.contains(document.activeElement)) {
    deckTile.focus();
  }

  const finish = () => {
    deckReveal.classList.add("hidden");
    deckReveal.classList.remove("is-closing");
    state.deckRevealHideTimer = null;
  };

  if (options.immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish();
    return;
  }
  state.deckRevealHideTimer = window.setTimeout(finish, CLUE_CHOOSER_EXIT_MS);
}

function renderRemainingDeck(cards) {
  deckRevealCount.textContent = `${cards.length} ${cards.length === 1 ? "card" : "cards"}`;
  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "deck-reveal-empty";
    empty.textContent = "No cards left.";
    deckRevealGrid.replaceChildren(empty);
    return;
  }
  deckRevealGrid.replaceChildren(...cards.map((card) => createMiniCard(card)));
}

function switchSeat(nextSeat) {
  const normalizedSeat = normalizeSeatOption(nextSeat, state.mySeat);
  if (normalizedSeat === state.mySeat) return;
  state.mySeat = normalizedSeat;
  resetLocalSelections();
  storageSetItem("barHanabiSeat", state.mySeat);
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
  closeDeckReveal({ immediate: true });
  closeSettingsPopover();
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
  const deferRenderForDrag = Boolean(state.activeDrag);
  const animation = canAnimateActionResultWithActiveDrag(nextRoom) ? actionAnimationSnapshot(nextRoom) : null;
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
  if (deferRenderForDrag) {
    state.pendingRoom = state.room;
    if (animation && !animateActionResult(animation)) {
      releaseTableStateHold(animation.key);
      clearPendingDrawAnimation(animation.key);
    }
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

async function copyRoomLink() {
  const code = state.currentCode || state.room?.code || roomCodeLabel.textContent.trim();
  if (!code) return;

  const url = roomShareUrl(code);
  try {
    await copyTextToClipboard(url);
    showToast("Room link copied.");
  } catch (error) {
    showToast(`Copy failed. Room code: ${code}`);
  }
}

function roomShareUrl(code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const url = new URL(window.location.href);
  url.hash = `room=${encodeURIComponent(normalizedCode)}`;
  return url.toString();
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document.execCommand !== "function") {
    throw new Error("Clipboard unavailable.");
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-999px";
  field.style.top = "0";
  field.style.opacity = "0";
  document.body.append(field);
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);
  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command failed.");
    }
  } finally {
    field.remove();
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
  updateRoomCodeLabel(state.room.code);
  const isMyTurn = state.room.turnSeat === state.mySeat;

  turnStatus.textContent = turnStatusText(isMyTurn);
  deckCount.textContent = tableRoom.deckCount;
  updateDeckRevealState(state.room);
  hintCount.textContent = `${tableRoom.hints}/${tableRoom.maxHints}`;
  bombCount.textContent = `${tableRoom.bombs}/${tableRoom.maxBombs}`;
  updateActionButtons();

  renderFireworks(tableRoom);
  renderHand(selfHand, me, { concealed: true, movable: true });
  renderHand(opponentHand, other, { concealed: false, movable: false, animateLayout: true });
  renderRotationWheel();
  renderClueLabels();
  renderDiscard(tableRoom);
  markSeenCards();
}

function renderActiveDragSafeState() {
  if (!state.room) return;

  const tableRoom = tableDisplayRoom();
  updateRoomCodeLabel(state.room.code);
  turnStatus.textContent = turnStatusText(state.room.turnSeat === state.mySeat);
  deckCount.textContent = tableRoom.deckCount;
  updateDeckRevealState(state.room);
  hintCount.textContent = `${tableRoom.hints}/${tableRoom.maxHints}`;
  bombCount.textContent = `${tableRoom.bombs}/${tableRoom.maxBombs}`;
  updateActionButtons();

  renderFireworks(tableRoom);
  if (state.activeDrag?.seat !== state.mySeat) {
    renderHand(selfHand, playerForSeat(state.mySeat), { concealed: true, movable: true });
  }
  if (state.activeDrag?.seat !== opponentSeat()) {
    renderHand(opponentHand, playerForSeat(opponentSeat()), { concealed: false, movable: false, animateLayout: true });
  }
  renderRotationWheel();
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
    if (state.activeDrag) {
      state.pendingRoom = state.room;
      renderActiveDragSafeState();
    } else {
      render();
    }
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
  const renderKey = fireworkRenderKey(room);
  if (renderKey === state.fireworkRenderKey) return;
  state.fireworkRenderKey = renderKey;

  fireworks.replaceChildren(
    ...colors.map((color) => {
      const tile = document.createElement("div");
      tile.className = "firework";
      const value = room.fireworks[color.id] || 0;
      const isLastFirework = room.lastResult?.type === "firework" && room.lastResult.color === color.id;
      tile.classList.toggle("empty-firework", value === 0);
      tile.setAttribute("aria-label", `${color.label} firework ${value}`);
      tile.title = color.label;

      const cardSlot = document.createElement("div");
      cardSlot.className = "firework-card-slot";
      cardSlot.dataset.fireworkColor = color.id;
      cardSlot.classList.toggle("last-result-highlight", isLastFirework);
      if (value > 0) {
        const card = document.createElement("div");
        card.className = "firework-card";
        card.append(createCardFace({ color: color.id, rank: value }, { revealImmediately: true }));
        cardSlot.append(card);
      } else {
        const emptyCard = document.createElement("div");
        emptyCard.className = "firework-empty-card";
        cardSlot.append(emptyCard);
      }

      tile.replaceChildren(cardSlot);
      return tile;
    })
  );
}

function fireworkRenderKey(room) {
  const colors = Array.isArray(room.colors) && room.colors.length > 0 ? room.colors : COLORS;
  const highlight = room.lastResult?.type === "firework"
    ? [room.lastResult.color, room.lastResult.rank, room.lastResult.cardId].join(":")
    : "";
  return [
    room.code,
    ...colors.map((color) => `${color.id}:${room.fireworks[color.id] || 0}`),
    highlight
  ].join("|");
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
    const isOwnSelected = player.seat === state.mySeat && isLocallySelected && canArrangeOwnCards();
    const isOtherSelected = (player.seat !== state.mySeat && isLocallySelected && canSelectOpponentCards()) || isPeerSelected;
    const isSelected = isOwnSelected || isOtherSelected;
    const isPendingDraw = isPendingDrawCard(player.seat, card.id);
    const localLayout = player.seat === state.mySeat ? state.localLayouts[card.id] : null;
    const targetLayout = normalizeLayout(localLayout || card.layout || fallbackLayout(index));
    const previousLayout = previousLayouts.get(card.id);
    const isOwnLayoutAnimating = player.seat === state.mySeat && Boolean(state.layoutAnimationCardIds[card.id]);
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
    syncCardSelectionClasses(element, isOwnSelected, isOtherSelected);
    element.classList.toggle("layout-animating", canAnimateLayout || isOwnLayoutAnimating);
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

function createCardBack(options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-back";
  if (options.revealImmediately) {
    wrapper.classList.add("asset-loaded");
  }
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

function createCardFace(card, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-face";
  if (options.revealImmediately) {
    wrapper.classList.add("asset-loaded");
  }

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
  let gesture = null;

  element.addEventListener("pointerdown", (event) => {
    if (options.concealed) {
      const joiningGesture = gesture && state.activeDrag?.seat === player.seat && state.activeDrag?.cardId === card.id;
      if (!joiningGesture) {
        selectCard(player.seat, card.id);
      }
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
    if (!gesture) {
      gesture = startCardGesture(event);
      state.activeDrag = { seat: player.seat, cardId: card.id };
      element.classList.remove("layout-animating");
      element.addEventListener("pointermove", onPointerMove);
      element.addEventListener("pointerup", onPointerUp);
      element.addEventListener("pointercancel", onPointerCancel);
    }

    gesture.pointers.set(event.pointerId, pointerSnapshot(event));
    resetGestureBaseline();
    if (manualRotationEnabled() && event.altKey && gesture.pointers.size === 1) {
      gesture.optionRotating = true;
    }
  });

  function startCardGesture(event) {
    const rect = surface.getBoundingClientRect();
    const layout = normalizeLayout(state.localLayouts[card.id] || card.layout);
    return {
      rect,
      surfaceSize: { width: rect.width, height: rect.height },
      pointers: new Map([[event.pointerId, pointerSnapshot(event)]]),
      moveStart: pointerSnapshot(event),
      optionRotationStart: null,
      optionRotating: false,
      initialLayout: layout,
      layout,
      latestLayout: layout,
      moved: false,
      lastSyncAt: 0
    };
  }

  function resetGestureBaseline() {
    if (!gesture) return;
    const pointers = [...gesture.pointers.values()];
    gesture.layout = normalizeLayout(gesture.latestLayout);
    gesture.moveStart = pointers[0] || null;
    gesture.optionRotationStart = optionRotationStartFor(pointers[0], gesture.layout, gesture.rect);
    gesture.optionRotating = false;
  }

  function sendMove(force) {
    if (!gesture) return;
    const now = Date.now();
    if (!force && now - gesture.lastSyncAt < CARD_LAYOUT_SYNC_MS) return;
    gesture.lastSyncAt = now;
    scheduleAction({
      type: "move-card",
      seat: player.seat,
      cardId: card.id,
      ...gesture.latestLayout
    });
  }

  function onPointerMove(moveEvent) {
    if (!gesture || !gesture.pointers.has(moveEvent.pointerId)) return;
    moveEvent.preventDefault();
    gesture.pointers.set(moveEvent.pointerId, pointerSnapshot(moveEvent));

    const pointers = [...gesture.pointers.values()];
    if (pointers.length === 1 && gesture.moveStart) {
      if (manualRotationEnabled() && moveEvent.altKey) {
        if (!gesture.optionRotating || !gesture.optionRotationStart) {
          gesture.layout = normalizeLayout(gesture.latestLayout);
          gesture.optionRotationStart = optionRotationStartFor(pointers[0], gesture.layout, gesture.rect);
          gesture.optionRotating = true;
        }
        const delta = angleDelta(pointerAngle(gesture.optionRotationStart.center, pointers[0]), gesture.optionRotationStart.angle);
        updateGestureLayout({
          ...gesture.optionRotationStart.layout,
          rotation: gesture.optionRotationStart.layout.rotation + delta
        });
        return;
      }

      if (gesture.optionRotating) {
        gesture.layout = normalizeLayout(gesture.latestLayout);
        gesture.moveStart = pointers[0];
        gesture.optionRotating = false;
      }

      const dx = ((pointers[0].x - gesture.moveStart.x) / gesture.rect.width) * 100;
      const dy = ((pointers[0].y - gesture.moveStart.y) / gesture.rect.height) * 100;
      updateGestureLayout({
        x: gesture.layout.x + dx,
        y: gesture.layout.y + dy,
        rotation: gesture.layout.rotation
      });
    }
  }

  function updateGestureLayout(layout) {
    if (!gesture) return;
    gesture.latestLayout = normalizeDragLayout(layout);
    gesture.moved = true;
    applyCardLayoutUpdate(surface, card, gesture.latestLayout, gesture.surfaceSize);
    sendMove(false);
  }

  function finishGesture(shouldCommit) {
    if (!gesture) return;
    const startLayout = gesture.initialLayout;
    const moved = gesture.moved;
    const surfaceSize = gesture.surfaceSize;
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerCancel);
    state.activeDrag = null;

    if (!shouldCommit) {
      card.layout = startLayout;
      rememberLocalLayout(card.id, startLayout);
      applyLayout(element, startLayout, surfaceSize);
    } else if (moved) {
      sendMove(true);
    }

    gesture = null;
    if (state.pendingRoom) {
      state.pendingRoom = null;
      render();
    }
  }

  function onPointerUp(event) {
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    releaseCardPointer(element, event.pointerId);
    if (gesture.pointers.size === 0) {
      finishGesture(true);
    } else {
      resetGestureBaseline();
    }
  }

  function onPointerCancel(event) {
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    releaseCardPointer(element, event.pointerId);
    finishGesture(false);
  }
}

function renderRotationWheel() {
  const targets = selectedOwnLayoutTargets();
  const canShow = manualRotationEnabled() && canArrangeOwnCards();
  setRotationWheelVisible(canShow);
  if (!canShow) return;

  const layout = targets.length > 0
    ? normalizeLayout(state.localLayouts[targets[0].card.id] || targets[0].card.layout)
    : normalizeLayout({ x: 50, y: 54, rotation: 0 });
  setRotationWheelAngle(layout.rotation);
}

function setRotationWheelVisible(canShow) {
  rotationWheel.setAttribute("aria-hidden", canShow ? "false" : "true");
  const isVisible = !rotationWheel.classList.contains("hidden");
  if (canShow === isVisible) return;

  window.clearTimeout(state.rotationWheelAnimationTimer);
  window.cancelAnimationFrame(state.rotationWheelAnimationFrame);

  const currentRect = rotationWheel.getBoundingClientRect();
  rotationWheel.style.flexBasis = `${Math.round(currentRect.width)}px`;
  rotationWheel.style.width = `${Math.round(currentRect.width)}px`;
  rotationWheel.style.height = `${Math.round(currentRect.height)}px`;
  rotationWheel.style.opacity = window.getComputedStyle(rotationWheel).opacity;
  rotationWheel.classList.toggle("hidden", !canShow);

  void rotationWheel.getBoundingClientRect();
  state.rotationWheelAnimationFrame = window.requestAnimationFrame(() => {
    rotationWheel.style.flexBasis = canShow ? "58px" : "0px";
    rotationWheel.style.width = canShow ? "58px" : "0px";
    rotationWheel.style.height = canShow ? "58px" : "0px";
    rotationWheel.style.opacity = canShow ? "1" : "0";
    state.rotationWheelAnimationFrame = null;
  });

  state.rotationWheelAnimationTimer = window.setTimeout(() => {
    rotationWheel.style.flexBasis = "";
    rotationWheel.style.width = "";
    rotationWheel.style.height = "";
    rotationWheel.style.opacity = "";
    state.rotationWheelAnimationTimer = null;
  }, CARD_LAYOUT_ANIMATION_MS + 40);
}

function handleManualRotationToggle() {
  if (!manualRotationEnabled()) {
    animateOwnCardsToAutoRotation();
  }
  renderRotationWheel();
}

function animateOwnCardsToAutoRotation() {
  if (!canArrangeOwnCards()) return;

  const player = playerForSeat(state.mySeat);
  if (!player) return;

  const surfaceSize = surfaceSizeFor(selfHand);
  player.hand.forEach((card) => {
    const layout = normalizeLayout(state.localLayouts[card.id] || card.layout);
    const next = normalizeLayout({
      ...layout,
      rotation: autoRotationForX(layout.x)
    });
    if (layoutsEqual(layout, next)) return;

    card.layout = next;
    rememberLocalLayout(card.id, next);

    const element = cardElementById(selfHand, card.id);
    if (element) {
      startLayoutAnimation(card.id, element);
      applyLayout(element, next, surfaceSize);
    }

    scheduleAction({
      type: "move-card",
      seat: state.mySeat,
      cardId: card.id,
      ...next
    }, { silent: true });
  });
}

function startLayoutAnimation(cardId, element) {
  state.layoutAnimationCardIds[cardId] = true;
  window.clearTimeout(state.layoutAnimationTimers[cardId]);
  element.classList.add("layout-animating");
  void element.getBoundingClientRect();
  state.layoutAnimationTimers[cardId] = window.setTimeout(() => {
    clearLayoutAnimation(cardId);
  }, CARD_LAYOUT_ANIMATION_MS);
}

function clearLayoutAnimation(cardId) {
  window.clearTimeout(state.layoutAnimationTimers[cardId]);
  delete state.layoutAnimationCardIds[cardId];
  delete state.layoutAnimationTimers[cardId];
  const element = cardElementById(selfHand, cardId);
  if (element) {
    element.classList.remove("layout-animating");
  }
}

function handleRotationWheelPointerDown(event) {
  const targets = selectedOwnLayoutTargets();
  if (!manualRotationEnabled() || targets.length === 0 || !canArrangeOwnCards()) return;

  event.preventDefault();
  rotationWheel.setPointerCapture(event.pointerId);

  const wheelRect = rotationWheel.getBoundingClientRect();
  const center = rectCenter(wheelRect);
  const startAngle = pointerAngle(center, pointerSnapshot(event));
  const surfaceSize = surfaceSizeFor(selfHand);
  const gesture = {
    pointerId: event.pointerId,
    center,
    startAngle,
    lastSyncAt: 0,
    moved: false,
    targets: targets.map(({ card }) => ({
      card,
      layout: normalizeLayout(state.localLayouts[card.id] || card.layout)
    })),
    latestTargets: []
  };
  gesture.latestTargets = gesture.targets.map(({ card, layout }) => ({ card, layout }));
  state.activeDrag = { seat: state.mySeat, cardId: "rotation-wheel" };
  rotationWheel.classList.add("is-rotating");

  function sendRotation(force) {
    const now = Date.now();
    if (!force && now - gesture.lastSyncAt < CARD_LAYOUT_SYNC_MS) return;
    gesture.lastSyncAt = now;
    gesture.latestTargets.forEach(({ card, layout }) => {
      scheduleAction({
        type: "move-card",
        seat: state.mySeat,
        cardId: card.id,
        ...layout
      });
    });
  }

  function applyRotation(pointer) {
    const delta = angleDelta(pointerAngle(gesture.center, pointer), gesture.startAngle);
    gesture.moved = true;
    gesture.latestTargets = gesture.targets.map(({ card, layout }) => ({
      card,
      layout: normalizeLayout({
        ...layout,
        rotation: layout.rotation + delta
      })
    }));

    gesture.latestTargets.forEach(({ card, layout }) => {
      applyCardLayoutUpdate(selfHand, card, layout, surfaceSize);
    });
    setRotationWheelAngle(gesture.latestTargets[0].layout.rotation);
    sendRotation(false);
  }

  function finishRotation(shouldCommit) {
    rotationWheel.removeEventListener("pointermove", onPointerMove);
    rotationWheel.removeEventListener("pointerup", onPointerUp);
    rotationWheel.removeEventListener("pointercancel", onPointerCancel);
    releaseCardPointer(rotationWheel, gesture.pointerId);
    rotationWheel.classList.remove("is-rotating");
    state.activeDrag = null;

    if (!shouldCommit) {
      gesture.targets.forEach(({ card, layout }) => {
        applyCardLayoutUpdate(selfHand, card, layout, surfaceSize);
      });
      setRotationWheelAngle(gesture.targets[0].layout.rotation);
    } else {
      if (gesture.moved) {
        sendRotation(true);
      }
    }

    if (state.pendingRoom) {
      state.pendingRoom = null;
      render();
    }
  }

  function onPointerMove(moveEvent) {
    if (moveEvent.pointerId !== gesture.pointerId) return;
    moveEvent.preventDefault();
    applyRotation(pointerSnapshot(moveEvent));
  }

  function onPointerUp(upEvent) {
    if (upEvent.pointerId !== gesture.pointerId) return;
    finishRotation(true);
  }

  function onPointerCancel(cancelEvent) {
    if (cancelEvent.pointerId !== gesture.pointerId) return;
    finishRotation(false);
  }

  rotationWheel.addEventListener("pointermove", onPointerMove);
  rotationWheel.addEventListener("pointerup", onPointerUp);
  rotationWheel.addEventListener("pointercancel", onPointerCancel);
}

function manualRotationEnabled() {
  return manualRotationToggle.checked;
}

function normalizeDragLayout(layout) {
  const next = normalizeLayout(layout);
  return manualRotationEnabled()
    ? next
    : normalizeLayout({ ...next, rotation: autoRotationForX(next.x) });
}

function selectedOwnLayoutTargets() {
  const player = playerForSeat(state.mySeat);
  if (!player) return [];
  const selectedIds = new Set(selectedCardIds(state.mySeat));
  return player.hand
    .filter((card) => selectedIds.has(card.id))
    .map((card) => ({ card }));
}

function applyCardLayoutUpdate(surface, card, layout, surfaceSize = surfaceSizeFor(surface)) {
  const next = normalizeLayout(layout);
  card.layout = next;
  rememberLocalLayout(card.id, next);
  const element = cardElementById(surface, card.id);
  if (element) {
    element.classList.remove("layout-animating");
    applyLayout(element, next, surfaceSize);
  }
  return next;
}

function setRotationWheelAngle(rotation) {
  rotationWheel.style.setProperty("--rotation-wheel-angle", `${normalizeLayout({ rotation, x: 50, y: 54 }).rotation}deg`);
}

function pointerSnapshot(event) {
  return {
    x: event.clientX,
    y: event.clientY
  };
}

function rectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function optionRotationStartFor(pointer, layout, surfaceRect) {
  if (!pointer) return null;
  const center = cardCenterForLayout(layout, surfaceRect);
  return {
    center,
    angle: pointerAngle(center, pointer),
    layout
  };
}

function cardCenterForLayout(layout, surfaceRect) {
  return {
    x: surfaceRect.left + (surfaceRect.width * layout.x) / 100,
    y: surfaceRect.top + (surfaceRect.height * layout.y) / 100
  };
}

function releaseCardPointer(element, pointerId) {
  if (element.hasPointerCapture?.(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
}

function pointerAngle(first, second) {
  return (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
}

function angleDelta(current, start) {
  let delta = current - start;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
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
    if (!canArrangeOwnCards()) {
      queueSelectionExit(selectedCardIds(seat), "own");
      state.selectedCards[seat] = [];
      updateSelectionClasses();
      return;
    }
    clearOpponentClueDraftIfNeeded();
  } else if (seat === opponentSeat()) {
    queueSelectionExit(selectedCardIds(state.mySeat), "own");
    state.selectedCards[state.mySeat] = [];
  }

  const current = selectedCardIds(seat);
  const selectionKind = seat === state.mySeat ? "own" : "other";
  if (options.multi && current.includes(cardId)) {
    queueSelectionExit([cardId], selectionKind);
  } else if (!options.multi) {
    queueSelectionExit(current.filter((id) => id !== cardId), selectionKind);
  }
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
  const targetIds = uniqueIds([
    ...selectedCardIds(targetSeat),
    ...peerSelectedCardIds(targetSeat)
  ]);
  if (targetIds.length === 0) return;
  queueSelectionExit(targetIds, "other");
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
  clearSelectionExits();
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
    const isOwnSelected = element.dataset.seat === state.mySeat && isLocallySelected && canArrangeOwnCards();
    const isOtherSelected = (element.dataset.seat !== state.mySeat && isLocallySelected && canSelectOpponentCards()) || isPeerSelected;
    const isSelected = isOwnSelected || isOtherSelected;
    syncCardSelectionClasses(element, isOwnSelected, isOtherSelected);
    const index = [...element.parentElement.children].indexOf(element);
    element.style.zIndex = String(10 + index + (isSelected ? 100 : 0));
  });
  updateActionButtons();
  renderRotationWheel();
}

function syncCardSelectionClasses(element, isOwnSelected, isOtherSelected) {
  const isSelected = isOwnSelected || isOtherSelected;
  const exitKind = state.selectionExitKinds[element.dataset.cardId];

  element.classList.toggle("selected", isSelected);
  element.classList.toggle("own-card-selected", isOwnSelected);
  element.classList.toggle("other-card-selected", isOtherSelected);
  element.classList.toggle("selection-exiting-own", exitKind === "own" && !isOwnSelected);
  element.classList.toggle("selection-exiting-other", exitKind === "other" && !isOtherSelected);

  if (isOwnSelected) {
    clearSelectionExit(element.dataset.cardId, "own");
  }

  if (isOtherSelected) {
    clearSelectionExit(element.dataset.cardId, "other");
  }
}

function queueSelectionExit(cardIds, kind) {
  for (const cardId of cardIds) {
    if (!cardId) continue;
    state.selectionExitKinds[cardId] = kind;
    if (state.selectionExitTimers[cardId]) {
      window.clearTimeout(state.selectionExitTimers[cardId]);
    }
    state.selectionExitTimers[cardId] = window.setTimeout(() => {
      if (state.selectionExitKinds[cardId] === kind) {
        delete state.selectionExitKinds[cardId];
      }
      delete state.selectionExitTimers[cardId];
      updateSelectionClasses();
    }, SELECTION_EXIT_MS);
  }
}

function clearSelectionExit(cardId, kind) {
  if (!cardId || (kind && state.selectionExitKinds[cardId] !== kind)) return;
  if (state.selectionExitTimers[cardId]) {
    window.clearTimeout(state.selectionExitTimers[cardId]);
    delete state.selectionExitTimers[cardId];
  }
  delete state.selectionExitKinds[cardId];
}

function clearSelectionExits() {
  Object.values(state.selectionExitTimers).forEach((timer) => window.clearTimeout(timer));
  state.selectionExitKinds = {};
  state.selectionExitTimers = {};
}

function updateActionButtons() {
  if (!state.room) return;
  const isMyTurn = state.room.turnSeat === state.mySeat;
  const canAct = state.room.status !== "ended" && isMyTurn;
  const selectedActionCard = selectedCard(state.mySeat);
  selfPlayButton.disabled = state.pendingAction || !canAct || !selectedActionCard;
  selfDiscardButton.disabled = state.pendingAction || !canAct || !selectedActionCard;
  clueButton.disabled = state.pendingAction || !canAct || state.room.hints <= 0 || !hasValidOpponentClueSelection();
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

function installDebugActions() {
  if (!isLocalDebugHost()) return;
  window.barHanabiDebug = {
    playValid: debugPlayValid,
    playManyValid: debugPlayManyValid
  };
}

function isLocalDebugHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

async function debugPlayValid(options = {}) {
  if (!state.room) {
    throw new Error("No active room.");
  }

  const seat = normalizeSeatOption(options.seat || state.mySeat, state.mySeat);
  const cardId = options.cardId || debugCardIdForSeat(seat);
  if (!cardId) {
    throw new Error(`No card available for seat ${seat}.`);
  }

  const updated = await request("/api/debug/play-valid", {
    method: "POST",
    body: {
      code: state.room.code,
      viewerSeat: state.mySeat,
      seat,
      cardId
    }
  });
  resetLocalSelections({ update: false, keepTableStateHold: true });
  applyRoomState(updated);
  return updated;
}

async function debugPlayManyValid(options = {}) {
  const count = Math.max(1, Math.trunc(Number(options.count) || 6));
  const delayMs = Math.max(0, Math.trunc(Number(options.delayMs) || 2900));
  let latest = null;
  for (let index = 0; index < count; index += 1) {
    latest = await debugPlayValid(options);
    if (index < count - 1 && delayMs > 0) {
      await wait(delayMs);
    }
  }
  return latest;
}

function debugCardIdForSeat(seat) {
  const selectedId = selectedCardIds(seat)[0];
  if (selectedId) return selectedId;
  return playerForSeat(seat)?.hand[0]?.id || "";
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function giveClue() {
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
    type: "give-clue",
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
  closeClueChooserImmediately();
  return new Promise((resolve) => {
    state.clueChooserResolve = resolve;
    window.clearTimeout(state.clueChooserHideTimer);
    state.clueChooserHideTimer = null;
    clueChooserOptions.replaceChildren();

    for (const candidate of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clue-choice-button";
      button.textContent = candidate.label;
      button.addEventListener("click", () => closeClueChooser(candidate));
      clueChooserOptions.append(button);
    }

    clueChooser.classList.remove("hidden", "is-closing");
    clueChooser.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      clueChooser.classList.add("is-open");
      clueChooserOptions.querySelector("button")?.focus();
    });
  });
}

function closeClueChooser(result) {
  closeClueChooserWithOptions(result);
}

function closeClueChooserImmediately() {
  closeClueChooserWithOptions(null, { immediate: true });
}

function closeClueChooserWithOptions(result, options = {}) {
  if (!clueChooser) return;

  const resolve = state.clueChooserResolve;
  state.clueChooserResolve = null;
  if (resolve) resolve(result);

  window.clearTimeout(state.clueChooserHideTimer);
  clueChooser.classList.remove("is-open");
  clueChooser.classList.add("is-closing");
  clueChooser.setAttribute("aria-hidden", "true");

  const finish = () => {
    clueChooser.classList.add("hidden");
    clueChooser.classList.remove("is-closing");
    clueChooserOptions.replaceChildren();
    state.clueChooserHideTimer = null;
  };

  if (options.immediate) {
    finish();
    return;
  }

  state.clueChooserHideTimer = window.setTimeout(finish, CLUE_CHOOSER_EXIT_MS);
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
  selfClueLabel.hidden = false;
  if (!selection) {
    selfClueLabel.classList.remove("is-visible");
    selfClueLabel.setAttribute("aria-hidden", "true");
    queueClueLabelClear(selfClueLabel);
    return;
  }

  if (selfClueLabel._clearTimer) {
    window.clearTimeout(selfClueLabel._clearTimer);
    selfClueLabel._clearTimer = null;
  }
  selfClueLabel.textContent = selection.clue.label;
  selfClueLabel.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    selfClueLabel.classList.add("is-visible");
  });
}

function queueClueLabelClear(clueLabel) {
  if (clueLabel._clearTimer) {
    window.clearTimeout(clueLabel._clearTimer);
  }
  clueLabel._clearTimer = window.setTimeout(() => {
    if (!clueLabel.classList.contains("is-visible")) {
      clueLabel.replaceChildren();
    }
    clueLabel._clearTimer = null;
  }, CLUE_LABEL_EXIT_MS);
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

function canAnimateActionResultWithActiveDrag(nextRoom) {
  if (!state.activeDrag) return true;
  if (state.tableStateHold) return false;

  const result = nextRoom?.lastResult;
  if (!result?.actorSeat || !result.cardId) return false;
  return result.actorSeat !== state.activeDrag.seat;
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
  if (!snapshot) return false;

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
    deflectRect: fireworkTargetRect(result.card.color) || rectSnapshot(attemptedTarget.getBoundingClientRect())
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
  back.append(createCardBack({ revealImmediately: true }));

  const face = document.createElement("div");
  face.className = "action-card-side action-card-face-side";
  face.append(createCardFace(snapshot.result.card, { revealImmediately: true }));

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
  const rotation = Number(targetRect.rotation) || 0;
  const scale = actionOverlayTargetScale(startRect, targetRect);
  overlay.style.transitionDuration = `${durationMs}ms`;
  overlay.style.left = `${targetRect.left + targetRect.width / 2 - startRect.width / 2}px`;
  overlay.style.top = `${targetRect.top + targetRect.height / 2 - startRect.height / 2}px`;
  overlay.style.transform = `rotate(${rotation}deg) scale(${scale})`;
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
    const rotation = current.rotation + (target.rotation - current.rotation) * eased;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.transform = `rotate(${rotation}deg) scale(${scale})`;
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
    scale: transformScale(styles.transform),
    rotation: transformRotation(styles.transform)
  };
}

function actionOverlayTargetPlacement(startRect, targetRect) {
  return {
    left: targetRect.left + targetRect.width / 2 - startRect.width / 2,
    top: targetRect.top + targetRect.height / 2 - startRect.height / 2,
    scale: actionOverlayTargetScale(startRect, targetRect),
    rotation: Number(targetRect.rotation) || 0
  };
}

function actionOverlayTargetScale(startRect, targetRect) {
  const rotation = Math.abs((Number(targetRect.rotation) || 0) % 180);
  if (Math.abs(rotation - 90) < 0.01) {
    return clamp(targetRect.height / startRect.width, 0.28, 0.72);
  }
  return clamp(targetRect.height / startRect.height, 0.28, 0.54);
}

function transformScale(transform) {
  if (!transform || transform === "none") return 1;
  const values = transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(",").map(Number);
  if (!values || values.length < 2) return 1;
  return Math.hypot(values[0], values[1]);
}

function transformRotation(transform) {
  if (!transform || transform === "none") return 0;
  const values = transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(",").map(Number);
  if (!values || values.length < 2) return 0;
  return Math.atan2(values[1], values[0]) * 180 / Math.PI;
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
    ? createCardBack({ revealImmediately: true })
    : createCardFace(replacement.card, { revealImmediately: true }));
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
  const source = deckCount.closest(".deck-tile");
  if (!source) return null;
  return rectSnapshot(source.getBoundingClientRect());
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
    if (state.activeDrag) {
      state.pendingRoom = state.room;
      renderActiveDragSafeState();
    } else {
      render();
    }
  }
}

function actionResultTargetRect(result) {
  if (result.type === "firework") {
    return fireworkTargetRect(result.card.color);
  }

  const target = discardElementForCard(result.card.id) || discardEndTargetRect(result.card);
  if (!target) return null;
  return target instanceof Element ? rectSnapshot(target.getBoundingClientRect()) : target;
}

function fireworkTargetRect(color) {
  const target = fireworkElementForColor(color);
  if (!target) return null;
  return {
    ...rectSnapshot(target.getBoundingClientRect()),
    rotation: 90
  };
}

function fireworkElementForColor(color) {
  return fireworks.querySelector(`.firework-card-slot[data-firework-color="${color}"]`);
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
  const allValidIds = new Set();
  for (const player of state.room.players) {
    const validIds = new Set(player.hand.map((card) => card.id));
    validIds.forEach((id) => allValidIds.add(id));
    state.selectedCards[player.seat] = selectedCardIds(player.seat).filter((id) => validIds.has(id));
    state.peerSelectedCards[player.seat] = peerSelectedCardIds(player.seat).filter((id) => validIds.has(id));
  }
  Object.keys(state.selectionExitKinds).forEach((cardId) => {
    if (!allValidIds.has(cardId)) {
      clearSelectionExit(cardId);
    }
  });
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
  Object.values(state.peerSelectedCards).forEach((cardIds) => {
    queueSelectionExit(cardIds, "other");
  });
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

function canArrangeOwnCards() {
  return state.room && state.room.status !== "ended";
}

function canSelectOwnCards() {
  return canArrangeOwnCards() && state.room.turnSeat === state.mySeat;
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
  item.replaceChildren(createCardFace(card, { revealImmediately: true }));
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

function otherPlayerConnected() {
  return Boolean(state.room?.presence?.[opponentSeat()]);
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
  state.isOnline = isOnline;
  gameView.dataset.connection = isOnline ? "online" : "offline";
  updateRoomCodeLabel();
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
