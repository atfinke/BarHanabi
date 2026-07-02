const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function fakeElement() {
  const listeners = new Map();
  const classes = new Set();
  function syncChildEdges(element) {
    element.firstElementChild = element.children[0] || null;
    element.lastElementChild = element.children[element.children.length - 1] || null;
  }
  const element = {
    checked: false,
    disabled: false,
    children: [],
    dataset: {},
    style: {
      setProperty() {}
    },
    offsetWidth: 40,
    offsetHeight: 64,
    textContent: "",
    value: "",
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return next;
      },
      toString() {
        return Array.from(classes).join(" ");
      }
    },
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    dispatchEvent(event) {
      const payload = typeof event === "string" ? { type: event } : event;
      for (const listener of listeners.get(payload.type) || []) {
        listener(payload);
      }
      return true;
    },
    append(...children) {
      for (const child of children) {
        child.remove?.();
        child.parentElement = element;
        element.children.push(child);
      }
      syncChildEdges(element);
    },
    replaceChildren(...children) {
      for (const child of element.children) {
        child.parentElement = null;
      }
      for (const child of children) {
        child.remove?.();
        child.parentElement = element;
      }
      element.children = children;
      syncChildEdges(element);
    },
    insertBefore(child, current) {
      child.remove?.();
      child.parentElement = element;
      const nextChildren = element.children.filter((item) => item !== child);
      const index = current ? nextChildren.indexOf(current) : -1;
      if (index === -1) {
        nextChildren.push(child);
      } else {
        nextChildren.splice(index, 0, child);
      }
      element.children = nextChildren;
      syncChildEdges(element);
    },
    remove() {
      if (!element.parentElement) return;
      element.parentElement.children = element.parentElement.children.filter((child) => child !== element);
      syncChildEdges(element.parentElement);
      element.parentElement = null;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    contains() {
      return false;
    },
    getBoundingClientRect() {
      element.layoutReadCount = (element.layoutReadCount || 0) + 1;
      return { left: 0, top: 0, width: 100, height: 100 };
    },
    setAttribute() {}
  };
  return element;
}

function loadClientForUiStateTest(options = {}) {
  const elements = new Map();
  const scheduledActions = [];
  const animationTimers = [];
  const storage = new Map(Object.entries(options.storage || {}));
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, fakeElement());
      }
      return elements.get(selector);
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return fakeElement();
    },
    body: fakeElement()
  };
  const sandbox = {
    Element: function Element() {},
    document,
    window: {
      addEventListener() {},
      location: { hash: "", pathname: "/" },
      history: { replaceState() {} },
      requestAnimationFrame(callback) {
        callback(0);
      },
      cancelAnimationFrame() {},
      matchMedia() {
        return { matches: false, addEventListener() {}, removeEventListener() {} };
      },
      setTimeout() {
        animationTimers.push(true);
        return 1;
      },
      clearTimeout() {},
      getComputedStyle() {
        return {
          borderLeftWidth: "0px",
          borderTopWidth: "0px",
          borderRightWidth: "0px",
          paddingLeft: "0px",
          paddingTop: "0px",
          paddingRight: "0px",
          columnGap: "5px",
          rowGap: "5px",
          gap: "5px"
        };
      }
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    URLSearchParams,
    requestAnimationFrame(callback) {
      callback(0);
    },
    getComputedStyle() {
      return { transform: "none" };
    },
    setTimeout(callback) {
      scheduledActions.push(callback);
      return scheduledActions.length;
    },
    clearTimeout,
    console,
    scheduledActions,
    animationTimers
  };

  vm.runInNewContext(
    `${read("public/app.js")}\nglobalThis.__client = { state, document, applyRoomState, tableDisplayRoom, updateActionButtons, updateRoomCodeLabel, roomCodeLabel, selfPlayButton, selfDiscardButton, selfHand, opponentHand, hintSetting, bombSetting, rainbowSetting, autoClueToggle, manualRotationToggle, replayLayoutStepsToggle, readSetupSettings, handleManualRotationToggle, renderHand, autoRotationForX, replayTimelineEvents, replayActionTransitionPlan, setReplayIndex, finishReplayActionFlight, placeReplayReverseActionOverlay, moveReplayReverseActionOverlay, setReplayLayoutCheckpointsVisible, discardBucketForCard, neededDiscardPile, spentDiscardPile, scheduledActions, animationTimers };`,
    sandbox
  );
  return { ...sandbox.__client, storage };
}

function visibleCardElement(cardId) {
  return {
    dataset: { cardId, layoutRotation: "0" },
    offsetWidth: 40,
    offsetHeight: 64,
    getBoundingClientRect() {
      return { left: 12, top: 24, width: 40, height: 64 };
    }
  };
}

function layoutCardElement(cardId) {
  const classes = new Set(["table-card"]);
  const styleProps = {};
  const events = [];
  return {
    dataset: { cardId },
    children: [],
    events,
    styleProps,
    style: {
      transform: "",
      setProperty(name, value) {
        events.push(`style:${name}`);
        styleProps[name] = value;
      }
    },
    classList: {
      add(name) {
        events.push(`class:add:${name}`);
        classes.add(name);
      },
      remove(name) {
        events.push(`class:remove:${name}`);
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      }
    },
    replaceChildren(...nextChildren) {
      this.children = nextChildren;
    },
    getBoundingClientRect() {
      events.push("layout:flush");
      return { left: 0, top: 0, width: 100, height: 100 };
    }
  };
}

test("setup screen exposes game creation and join controls", () => {
  const html = read("public/index.html");

  for (const pattern of [
    /<h1>Bar Hanabi<\/h1>/,
    /id="createRoomButton"[\s\S]*>Create Game<\/button>/,
    /id="roomCodeInput"[\s\S]*aria-label="Game Code"/,
    /id="roomCodeInput"[\s\S]*placeholder="Game Code"/
  ]) {
    assert.match(html, pattern);
  }
});

test("setup screen exposes compact game settings controls", () => {
  const html = read("public/index.html");

  for (const pattern of [
    /class="setup-settings"/,
    /for="hintSetting"[\s\S]*Hints[\s\S]*id="hintSetting"[\s\S]*value="8"/,
    /for="bombSetting"[\s\S]*Bombs[\s\S]*id="bombSetting"[\s\S]*value="3"/,
    /id="bombSetting"[\s\S]*<option value="0">0<\/option>/,
    /id="rainbowSetting"[\s\S]*type="checkbox"[\s\S]*checked/,
    /Rainbow/
  ]) {
    assert.match(html, pattern);
  }
});

test("client restores local player preferences on load", () => {
  const client = loadClientForUiStateTest({
    storage: {
      "barHanabiPreferences:v1": JSON.stringify({
        hints: 4,
        bombs: 1,
        rainbow: false,
        autoClue: true,
        manualRotation: true,
        replayLayoutSteps: true
      }),
      "barHanabiSeat:ABCD": "B"
    }
  });

  assert.equal(client.hintSetting.value, "4");
  assert.equal(client.bombSetting.value, "1");
  assert.equal(client.rainbowSetting.checked, false);
  assert.equal(client.autoClueToggle.checked, true);
  assert.equal(client.manualRotationToggle.checked, true);
  assert.equal(client.replayLayoutStepsToggle.checked, true);
  assert.equal(client.state.replay.settings.showLayoutCheckpoints, true);
  const setupSettings = client.readSetupSettings();
  assert.equal(setupSettings.hints, 4);
  assert.equal(setupSettings.bombs, 1);
  assert.equal(setupSettings.rainbow, false);
  assert.equal(client.storage.get("barHanabiSeat:ABCD"), "B");
});

test("client saves local player preferences when controls change", () => {
  const client = loadClientForUiStateTest();
  client.hintSetting.value = "6";
  client.bombSetting.value = "0";
  client.rainbowSetting.checked = false;
  client.autoClueToggle.checked = true;
  client.manualRotationToggle.checked = true;
  client.replayLayoutStepsToggle.checked = true;

  client.hintSetting.dispatchEvent("change");
  client.bombSetting.dispatchEvent("change");
  client.rainbowSetting.dispatchEvent("change");
  client.autoClueToggle.dispatchEvent("change");
  client.manualRotationToggle.dispatchEvent("change");
  client.replayLayoutStepsToggle.dispatchEvent("change");

  assert.deepEqual(JSON.parse(client.storage.get("barHanabiPreferences:v1")), {
    hints: 6,
    bombs: 0,
    rainbow: false,
    autoClue: true,
    manualRotation: true,
    replayLayoutSteps: true
  });
});

test("setup screen sets a softened browser chrome color", () => {
  const html = read("public/index.html");

  assert.match(html, /<meta name="theme-color" content="#151c20">/);
});

test("mobile UI exposes current controls and omits retired controls", () => {
  const html = read("public/index.html");

  for (const pattern of [
    /id="selfPlayButton"/,
    /id="selfDiscardButton"/,
    /id="clueButton"/,
    /id="rotationWheel"[\s\S]*aria-label="Rotate selected card"/,
    /id="settingsButton"[\s\S]*aria-label="Settings"/,
    /id="settingsPopover"[\s\S]*role="dialog"/,
    /id="autoCluePreviewToggle"/,
    /id="manualRotationToggle"/,
    /id="selfClueLabel"/,
    /id="resetButton"/,
    /id="turnStatus"[\s\S]*Double tap to switch player/,
    /id="hintCount"/,
    /id="bombCount"/,
    /id="neededDiscardPile" aria-label="Needed discards"/,
    /id="spentDiscardPile" aria-label="Safe discards"/
  ]) {
    assert.match(html, pattern);
  }

  assert.match(html, /id="resetButton"[\s\S]*>Restart<\/button>/);
  assert.doesNotMatch(html, /id="resetButton"[^>]*danger-outline/);

  for (const retired of [
    /id="drawButton"|>Draw<\/button>/,
    /id="fanButton"|>Fan<\/button>/,
    /id="clueForm"|id="clueTypeSelect"|id="clueValueSelect"|id="giveClueButton"/,
    /id="spendClueButton"|id="recoverClueButton"|id="clueCount"/,
    /id="log"|id="logButton"|>Log</,
    /id="nameForm"|id="playerNameInput"/,
    /id="rotateLeftButton"|id="rotateRightButton"|>Rotate/,
    /id="autoClueButton"/,
    /class="seat-picker"|class="seat-button"|data-seat=/,
    />Strikes</,
    />Visible<\/span>|>Hidden<\/span>/,
    /id="opponentName"|id="selfName"/
  ]) {
    assert.doesNotMatch(html, retired);
  }
});

test("game settings live in a clue-style popover", () => {
  const html = read("public/index.html");
  const script = read("public/app.js");

  assert.match(html, /id="settingsButton"[\s\S]*aria-controls="settingsPopover"[\s\S]*aria-expanded="false"/);
  assert.match(html, /id="settingsPopover"[\s\S]*aria-hidden="true"/);
  assert.match(html, /class="settings-popover-header"[\s\S]*id="settingsPopoverTitle">Settings<\/h2>/);
  assert.match(html, /class="settings-controls"[\s\S]*id="resetButton"[\s\S]*Restart/);
  assert.match(html, /for="autoCluePreviewToggle"[\s\S]*Auto Clue[\s\S]*id="autoCluePreviewToggle"/);
  assert.match(html, /for="manualRotationToggle"[\s\S]*Manual Rotation[\s\S]*id="manualRotationToggle"/);
  assert.match(html, /for="replayLayoutStepsToggle"[\s\S]*Replay Layout Steps[\s\S]*id="replayLayoutStepsToggle"/);
  assert.doesNotMatch(html, /settingsPopover[\s\S]*(hintSetting|bombSetting|rainbowSetting)/);

  for (const pattern of [
    /const settingsButton = document\.querySelector\("#settingsButton"\);/,
    /const settingsPopover = document\.querySelector\("#settingsPopover"\);/,
    /const replayLayoutStepsToggle = document\.querySelector\("#replayLayoutStepsToggle"\);/,
    /settingsButton\.addEventListener\("click", \(\) => toggleSettingsPopover\(\)\);/,
    /replayLayoutStepsToggle\.addEventListener\("change", \(\) => \{[\s\S]*setReplayLayoutCheckpointsVisible\(replayLayoutStepsToggle\.checked\);[\s\S]*savePlayerPreferences\(\);[\s\S]*\}\);/,
    /function openSettingsPopover\(\)/,
    /function closeSettingsPopover\(\)/,
    /trigger\?\.setAttribute\("aria-expanded", "true"\);/,
    /trigger\?\.setAttribute\("aria-expanded", "false"\);/,
    /trigger: settingsButton,/,
    /function setReplayLayoutCheckpointsVisible\(show, options = \{\}\)/,
    /function renderReplaySettingsControls\(\)/
  ]) {
    assert.match(script, pattern);
  }

  assert.match(html, /class="settings-icon"[\s\S]*viewBox="0 0 24 24"/);
});

test("ended deck reveal wires a popover from the deck tile", () => {
  const html = read("public/index.html");
  const script = read("public/app.js");

  assert.match(html, /class="deck-tile"[\s\S]*id="deckTile"[\s\S]*aria-controls="deckReveal"[\s\S]*id="deckCount"/);
  assert.match(html, /id="deckReveal"[\s\S]*role="dialog"[\s\S]*aria-labelledby="deckRevealTitle"/);
  assert.match(html, /class="settings-popover-header deck-reveal-header"/);
  assert.match(html, /id="deckRevealTitle">Remaining Deck<\/h2>/);
  assert.match(html, /class="deck-reveal-grid mini-cards" id="deckRevealGrid"/);

  for (const pattern of [
    /const deckTile = document\.querySelector\("#deckTile"\);/,
    /const deckReveal = document\.querySelector\("#deckReveal"\);/,
    /deckTile\.addEventListener\("click", \(\) => openDeckReveal\(\)\);/,
    /function updateDeckRevealState\(room\)/,
    /const canRevealDeck = room\.status === "ended" && Array\.isArray\(room\.remainingDeck\);/,
    /deckTile\.disabled = !canRevealDeck;/,
    /function renderRemainingDeck\(cards\)/,
    /deckRevealGrid\.replaceChildren\(\.\.\.cards\.map\(\(card\) => createMiniCard\(card\)\)\);/
  ]) {
    assert.match(script, pattern);
  }
});

test("room code control copies the full room share link", () => {
  const html = read("public/index.html");
  const script = read("public/app.js");

  assert.match(html, /<button class="room-code-button" id="roomCodeLabel" type="button"[\s\S]*Copy room link[\s\S]*<\/button>/);
  assert.match(script, /roomCodeLabel\.addEventListener\("click", \(\) => copyRoomLink\(\)\);/);
  assert.match(script, /function updateRoomCodeLabel\(code\)/);
  assert.match(script, /roomCodeLabel\.setAttribute\("aria-label", `Copy room link for \$\{normalizedCode\}`\);/);
  assert.match(script, /async function copyRoomLink\(\)/);
  assert.match(script, /const url = roomShareUrl\(code\);/);
  assert.match(script, /await copyTextToClipboard\(url\);/);
  assert.match(script, /showToast\("Room link copied\."\);/);
  assert.match(script, /showToast\(`Copy failed\. Room code: \$\{code\}`\);/);
  assert.match(script, /function roomShareUrl\(code\)/);
  assert.match(script, /const url = new URL\(window\.location\.href\);/);
  assert.match(script, /url\.hash = `room=\$\{encodeURIComponent\(normalizedCode\)\}`;/);
  assert.match(script, /function copyTextToClipboard\(text\)/);
  assert.match(script, /navigator\.clipboard\?\.writeText/);
  assert.match(script, /document\.execCommand\("copy"\)/);
});

test("room code chip hides the code only while the other player is connected", () => {
  const client = loadClientForUiStateTest();
  client.state.currentCode = "K7Q2";
  client.state.mySeat = "A";
  client.state.isOnline = true;
  client.state.room = {
    code: "K7Q2",
    presence: { A: true, B: false }
  };

  client.updateRoomCodeLabel("K7Q2");

  assert.equal(client.roomCodeLabel.textContent, "K7Q2");
  assert.equal(client.roomCodeLabel.dataset.presence, "code");

  client.state.room.presence.B = true;
  client.updateRoomCodeLabel("K7Q2");

  assert.equal(client.roomCodeLabel.textContent, "Connected");
  assert.equal(client.roomCodeLabel.dataset.presence, "connected");

  client.state.room.presence.B = false;
  client.updateRoomCodeLabel("K7Q2");

  assert.equal(client.roomCodeLabel.textContent, "K7Q2");
  assert.equal(client.roomCodeLabel.dataset.presence, "code");

  client.state.isOnline = false;
  client.updateRoomCodeLabel("K7Q2");

  assert.equal(client.roomCodeLabel.textContent, "Reconnecting");
  assert.equal(client.roomCodeLabel.dataset.presence, "reconnecting");
});

test("game state shows hints before bombs", () => {
  const html = read("public/index.html");
  const script = read("public/app.js");

  assert.match(html, /<span>Deck<\/span>[\s\S]*id="deckCount"[\s\S]*<span>Hints<\/span>[\s\S]*id="hintCount"[\s\S]*<span>Bombs<\/span>[\s\S]*id="bombCount"/);
  assert.match(script, /setStatText\(hintCount, `\$\{tableRoom\.hints\}\/\$\{tableRoom\.maxHints\}`\);/);
  assert.match(script, /setStatText\(bombCount, `\$\{tableRoom\.bombs\}\/\$\{tableRoom\.maxBombs\}`\);/);
});

test("creator starts as A and joiners default to B", () => {
  const script = read("public/app.js");

  assert.ok(script.includes('await enterRoom(room.code, { defaultSeat: "A", forceSeat: true });'));
  assert.ok(script.includes('await enterRoom(code, { defaultSeat: "B" });'));
  assert.ok(script.includes('enterRoom(code, { defaultSeat: "B" });'));
  assert.ok(script.includes('enterRoom(initialRoom, { defaultSeat: "B" });'));
});

test("turn status is the deliberate seat switch control", () => {
  const script = read("public/app.js");

  assert.doesNotMatch(script, /turnStatus\.addEventListener\("dblclick"/);
  assert.doesNotMatch(script, /function handleTurnStatusDoubleTap/);
  assert.doesNotMatch(script, /querySelectorAll\("\.seat-button"\)/);
  assert.doesNotMatch(script, /function renderSeatButtons/);
});

test("client keeps committed clue and action-selection flows separate", () => {
  const script = read("public/app.js");

  for (const pattern of [
    /cluePreview/,
    /type: "clue-selection"/,
    /type: "give-clue"/,
    /peerSelectedCards: \{ A: \[\], B: \[\] \}/,
    /function canSelectOpponentCards/,
    /cardIds: targetCardIds/,
    /state\.peerSelectedCards\[selection\.seat\] = uniqueIds\(/,
    /if \(!canSelectOpponentCards\(\)\) return;/
  ]) {
    assert.match(script, pattern);
  }
});

test("client derives legal clue choices before sending a clue", () => {
  const script = read("public/app.js");

  for (const pattern of [
    /function clueCandidatesForSelection\(targetSeat, selectedIds\)/,
    /function rankClueCandidates\(hand, selectedIds\)/,
    /function colorClueCandidates\(hand, selectedIds\)/,
    /color\.id !== "rainbow"/,
    /card\.color === color\.id \|\| card\.color === "rainbow"/,
    /function chooseClueCandidate\(candidates\)/,
    /return showClueChooser\(candidates\);/,
    /const autoSendClue = autoClueToggle\.checked && candidates\.length === 1;/,
    /const clue = autoSendClue \? candidates\[0\] : await chooseClueCandidate\(candidates\);/,
    /No valid clue for those cards\./,
    /Select all \$\{candidate\.errorLabel\}\./,
    /clue: \{ kind: clue\.kind, value: clue\.value \}/
  ]) {
    assert.match(script, pattern);
  }
  assert.doesNotMatch(script, /window\.prompt/);
  assert.doesNotMatch(script, /Give clue "\$\{candidate\.label\}"/);
  assert.doesNotMatch(script, /if \(candidates\.length === 1\) return candidates\[0\];/);
});

test("client disables clue action when selected cards have no legal clue", () => {
  const script = read("public/app.js");

  assert.match(script, /const autoClueToggle = document\.querySelector\("#autoCluePreviewToggle"\);/);
  assert.match(script, /clueButton\.addEventListener\("click", \(\) => giveClue\(\)\);/);
  assert.match(script, /function selectedOpponentClueCandidates\(\)/);
  assert.match(script, /function hasValidOpponentClueSelection\(\)/);
  assert.match(script, /const targetCardIds = selectedCardIds\(opponentSeat\(\)\);/);
  assert.match(script, /return selectedOpponentClueCandidates\(\)\.length > 0;/);
  assert.match(script, /clueButton\.disabled = state\.pendingAction \|\| !canAct \|\| state\.room\.hints <= 0 \|\| !hasValidOpponentClueSelection\(\);/);
  assert.doesNotMatch(script, /autoClueButton/);
});

test("client disables local play and discard until a local card is selected", () => {
  const client = loadClientForUiStateTest();
  client.state.mySeat = "A";
  client.state.pendingAction = false;
  client.state.selectedCards = { A: [], B: [] };
  client.state.room = {
    status: "playing",
    turnSeat: "A",
    hints: 8,
    players: [
      { seat: "A", hand: [{ id: "a1" }] },
      { seat: "B", hand: [{ id: "b1", color: "red", rank: 1 }] }
    ]
  };

  client.updateActionButtons();

  assert.equal(client.selfPlayButton.disabled, true);
  assert.equal(client.selfDiscardButton.disabled, true);

  client.state.selectedCards.A = ["a1"];
  client.updateActionButtons();

  assert.equal(client.selfPlayButton.disabled, false);
  assert.equal(client.selfDiscardButton.disabled, false);
});

test("action result received during drag does not pin table display to previous room", () => {
  const client = loadClientForUiStateTest();
  const actedCard = { id: "played-card", color: "red", rank: 1, layout: { x: 40, y: 50, rotation: 0 } };
  const previousRoom = {
    code: "TEST",
    version: 1,
    deckCount: 40,
    discard: [],
    fireworks: { red: 0 },
    hints: 8,
    maxHints: 8,
    bombs: 0,
    maxBombs: 3,
    colors: [{ id: "red", label: "Red" }],
    lastResult: null,
    turnSeat: "B",
    status: "playing",
    players: [
      { seat: "A", hand: [{ id: "dragged-card", layout: { x: 50, y: 50, rotation: 0 } }] },
      { seat: "B", hand: [actedCard] }
    ]
  };
  const nextRoom = {
    ...previousRoom,
    version: 2,
    discard: [actedCard],
    lastResult: {
      type: "discard",
      action: "discard",
      actorSeat: "B",
      cardId: actedCard.id,
      color: actedCard.color,
      rank: actedCard.rank,
      card: actedCard
    },
    players: [
      previousRoom.players[0],
      { seat: "B", hand: [] }
    ]
  };

  client.state.mySeat = "B";
  client.state.room = previousRoom;
  client.state.activeDrag = { seat: "B", cardId: actedCard.id };
  client.selfHand.querySelectorAll = () => [visibleCardElement(actedCard.id)];

  client.applyRoomState(nextRoom);

  assert.equal(client.state.pendingRoom, nextRoom);
  assert.equal(client.state.tableStateHold, null);
  assert.equal(client.tableDisplayRoom(), nextRoom);
});

test("independent opponent action can animate during local drag", () => {
  const client = loadClientForUiStateTest();
  const actedCard = { id: "played-card", color: "red", rank: 1, layout: { x: 40, y: 50, rotation: 0 } };
  const previousRoom = {
    code: "TEST",
    version: 1,
    deckCount: 40,
    discard: [],
    fireworks: { red: 0 },
    hints: 8,
    maxHints: 8,
    bombs: 0,
    maxBombs: 3,
    colors: [{ id: "red", label: "Red" }],
    lastResult: null,
    turnSeat: "B",
    status: "playing",
    players: [
      { seat: "A", hand: [{ id: "dragged-card", layout: { x: 50, y: 50, rotation: 0 } }] },
      { seat: "B", hand: [actedCard] }
    ]
  };
  const nextRoom = {
    ...previousRoom,
    version: 2,
    discard: [actedCard],
    lastResult: {
      type: "discard",
      action: "discard",
      actorSeat: "B",
      cardId: actedCard.id,
      color: actedCard.color,
      rank: actedCard.rank,
      card: actedCard
    },
    players: [
      previousRoom.players[0],
      { seat: "B", hand: [] }
    ]
  };

  client.state.mySeat = "A";
  client.state.room = previousRoom;
  client.state.activeDrag = { seat: "A", cardId: "dragged-card" };
  client.opponentHand.querySelectorAll = () => [visibleCardElement(actedCard.id)];

  client.applyRoomState(nextRoom);

  assert.equal(client.state.pendingRoom, nextRoom);
  assert.equal(JSON.stringify(client.state.tableStateHold?.room), JSON.stringify(previousRoom));
  assert.match(client.state.lastAnimatedResultKey, /TEST:2:B:discard:discard:played-card:1/);
});

test("client shows ambiguous clue options in one chooser", () => {
  const script = read("public/app.js");
  const html = read("public/index.html");

  for (const pattern of [
    /id="clueChooser"/,
    /id="clueChooserOptions"/,
    /id="clueChooserCancel"/
  ]) {
    assert.match(html, pattern);
  }
  for (const pattern of [
    /const clueChooser = document\.querySelector\("#clueChooser"\);/,
    /const clueChooserOptions = document\.querySelector\("#clueChooserOptions"\);/,
    /function showClueChooser\(candidates\)/,
    /for \(const candidate of candidates\)/,
    /button\.textContent = candidate\.label;/,
    /button\.addEventListener\("click", \(\) => closeClueChooser\(candidate\)\);/,
    /function closeClueChooser\(result\)/,
    /clueChooserCancel\.addEventListener\("click", \(\) => closeClueChooser\(null\)\);/
  ]) {
    assert.match(script, pattern);
  }
});

test("client offers color clues when the selection equals that color plus rainbows", () => {
  const script = read("public/app.js");

  for (const pattern of [
    /const matchingCards = hand\.filter\(\(card\) => card\.color === color\.id \|\| card\.color === "rainbow"\);/,
    /return clueCandidateFromCards\("color", color\.id, matchingCards, selectedIds\);/,
    /if \(!sameIdSet\(selectedIds, matchingIds\)\) return null;/
  ]) {
    assert.match(script, pattern);
  }
  assert.doesNotMatch(script, /selectedIdsIncludeNaturalColor/);
  assert.doesNotMatch(script, /if \(isRainbowOnlySelection\(selectedCards\)\)/);
});

test("client shows committed clue labels in the local hand area", () => {
  const script = read("public/app.js");
  const html = read("public/index.html");

  assert.match(script, /const selfClueLabel = document\.querySelector\("#selfClueLabel"\);/);
  assert.match(script, /const opponentClueLabel = document\.querySelector\("#opponentClueLabel"\);/);
  assert.match(script, /function renderClueLabels\(\)/);
  assert.match(script, /renderSingleClueLabel\(selfClueLabel, selection\.seat === state\.mySeat \? selection : null\);/);
  assert.match(script, /renderSingleClueLabel\(opponentClueLabel, selection\.seat === opponentSeat\(\) \? selection : null\);/);
  assert.match(script, /selfClueLabel\.textContent = selection\.clue\.label;/);
  assert.match(html, /id="opponentClueLabel"/);
});

test("client applies committed clues and live previews independently", () => {
  const script = read("public/app.js");

  for (const pattern of [
    /function sharedSelectionsForView\(\)/,
    /state\.room\?\.clueSelection/,
    /state\.room\?\.cluePreview/,
    /selectionKeyPart\(state\.room\?\.clueSelection\)/,
    /selectionKeyPart\(state\.room\?\.cluePreview\)/,
    /for \(const selection of sharedSelectionsForView\(\)\)/,
    /state\.peerSelectedCards\[selection\.seat\] = uniqueIds\(/,
    /function uniqueIds\(ids\)/
  ]) {
    assert.match(script, pattern);
  }
});

test("client disables teammate selection when hints are unavailable", () => {
  const script = read("public/app.js");

  assert.match(script, /function canSelectOpponentCards\(\) \{[\s\S]*state\.room\.hints > 0;/);
  assert.match(script, /element\.dataset\.seat !== state\.mySeat && isLocallySelected && canSelectOpponentCards\(\)/);
  assert.match(script, /clueButton\.disabled =[\s\S]*state\.room\.hints <= 0/);
});

test("action card animation hides table handoff and deflects missed plays", () => {
  const script = read("public/app.js");

  assert.match(script, /function actionResultPath\(result\)/);
  assert.match(script, /function isMissedPlayResult\(result\)/);
  assert.match(script, /MISPLAY_DEFLECT_AT_MS/);
  assert.match(script, /function arcActionCardOverlay\(overlay, startRect, targetRect, durationMs\)/);
  assert.match(script, /function quadraticBezier\(start, control, end, t\)/);
  assert.match(script, /getComputedStyle\(overlay\)/);
  assert.match(script, /requestAnimationFrame\(step\)/);
  assert.match(script, /fireworkElementForColor\(result\.card\.color\)/);
  assert.match(script, /discardElementForCard\(result\.card\.id\) \|\| discardEndTargetRect\(result\.card\)/);
  assert.match(script, /function finishActionOverlay\(snapshot, overlay\)/);
  assert.match(script, /const DISCARD_CARD_WIDTH = 34;/);
  assert.match(script, /const DISCARD_CARD_HEIGHT = DISCARD_CARD_WIDTH \* 510 \/ 322;/);
  assert.match(script, /overlay\.remove\(\);[\s\S]*releaseTableStateHold\(snapshot\.key\);[\s\S]*window\.requestAnimationFrame\(\(\) => \{[\s\S]*animateReplacementDraw\(snapshot\);[\s\S]*\}\);/);
});

test("card interactions move with one pointer and rotate with wheel or option-drag", () => {
  const script = read("public/app.js");
  const html = read("public/index.html");

  for (const pattern of [
    /function bindCardPointer/,
    /const rotationWheel = document\.querySelector\("#rotationWheel"\);/,
    /rotationWheel\.addEventListener\("pointerdown", handleRotationWheelPointerDown\);/,
    /function manualRotationEnabled\(\) \{[\s\S]*return manualRotationToggle\.checked;/,
    /function renderRotationWheel\(\)/,
    /function handleRotationWheelPointerDown\(event\)/,
    /function selectedOwnLayoutTargets\(\)/,
    /function applyCardLayoutUpdate\(surface, card, layout/,
    /const canShow = manualRotationEnabled\(\) && canArrangeOwnCards\(\);/,
    /if \(!manualRotationEnabled\(\) \|\| targets\.length === 0 \|\| !canArrangeOwnCards\(\)\) return;/,
    /const joiningGesture = gesture && state\.activeDrag\?\.seat === player\.seat && state\.activeDrag\?\.cardId === card\.id;/,
    /pointers: new Map\(\[\[event\.pointerId, pointerSnapshot\(event\)\]\]\)/,
    /function normalizeDragLayout\(layout\) \{[\s\S]*manualRotationEnabled\(\)[\s\S]*autoRotationForX\(next\.x\)/,
    /gesture\.latestLayout = normalizeDragLayout\(layout\);/,
    /function pointerSnapshot\(event\)/,
    /function optionRotationStartFor\(pointer, layout, surfaceRect\)/,
    /function cardCenterForLayout\(layout, surfaceRect\)/,
    /function rectCenter\(rect\)/,
    /function pointerAngle\(first, second\)/,
    /function angleDelta\(current, start\)/,
    /rotation: gesture\.layout\.rotation/,
    /if \(manualRotationEnabled\(\) && event\.altKey && gesture\.pointers\.size === 1\)/,
    /if \(manualRotationEnabled\(\) && moveEvent\.altKey\)/,
    /pointerAngle\(gesture\.optionRotationStart\.center, pointers\[0\]\)/,
    /rotation: gesture\.optionRotationStart\.layout\.rotation \+ delta/,
    /const delta = angleDelta\(pointerAngle\(gesture\.center, pointer\), gesture\.startAngle\);/,
    /rotation: layout\.rotation \+ delta/,
    /rotationWheel\.classList\.add\("is-rotating"\);/,
    /rotationWheel\.classList\.remove\("is-rotating"\);/,
    /setRotationWheelAngle\(gesture\.latestTargets\[0\]\.layout\.rotation\);/,
    /x: surfaceRect\.left \+ \(surfaceRect\.width \* layout\.x\) \/ 100/,
    /y: surfaceRect\.top \+ \(surfaceRect\.height \* layout\.y\) \/ 100/,
    /rememberLocalLayout\(card\.id, next\);/,
    /sendMove\(false\);/,
    /sendMove\(true\);/,
    /type: "move-card"/,
    /const rotation = Number\.isFinite\(Number\(next\.rotation\)\) \? Number\(next\.rotation\) : autoRotationForX\(clampedX\)/,
    /rotation: clamp\(rotation, -145, 145\)/
  ]) {
    assert.match(script, pattern);
  }

  assert.match(html, /class="rotation-wheel hidden" id="rotationWheel"/);
  assert.match(script, /function setRotationWheelVisible\(canShow\)/);
  assert.match(script, /setRotationWheelVisible\(canShow\);/);
  assert.match(script, /const currentRect = rotationWheel\.getBoundingClientRect\(\);/);
  assert.match(script, /rotationWheel\.style\.flexBasis = `\$\{Math\.round\(currentRect\.width\)\}px`;/);
  assert.match(script, /rotationWheel\.style\.width = `\$\{Math\.round\(currentRect\.width\)\}px`;/);
  assert.match(script, /rotationWheel\.classList\.toggle\("hidden", !canShow\);/);
  assert.match(script, /state\.rotationWheelAnimationFrame = window\.requestAnimationFrame\(\(\) => \{[\s\S]*rotationWheel\.style\.flexBasis = canShow \? "58px" : "0px";[\s\S]*rotationWheel\.style\.width = canShow \? "58px" : "0px";[\s\S]*rotationWheel\.style\.height = canShow \? "58px" : "0px";/);
  assert.match(script, /state\.rotationWheelAnimationTimer = window\.setTimeout\(\(\) => \{[\s\S]*rotationWheel\.style\.flexBasis = "";[\s\S]*rotationWheel\.style\.width = "";[\s\S]*rotationWheel\.style\.height = "";[\s\S]*rotationWheel\.style\.opacity = "";/);
  assert.doesNotMatch(script, /rotateSelected|rotateLeftButton|rotateRightButton/);
  assert.doesNotMatch(script, /rotation: autoRotationForX\(x\)/);
  assert.doesNotMatch(script, /gesture\.rotationStart|pointers\.length >= 2/);
  assert.doesNotMatch(script, /gesturestart|gesturechange|gestureend|gesturecancel|GestureEvent|event\.rotation/);
});

test("manual rotation mode does not disable auto rotation or off-turn arrangement", () => {
  const script = read("public/app.js");

  assert.match(script, /manualRotationToggle\.addEventListener\("change", \(\) => \{[\s\S]*savePlayerPreferences\(\);[\s\S]*handleManualRotationToggle\(\);[\s\S]*\}\);/);
  assert.match(script, /function normalizeDragLayout\(layout\) \{[\s\S]*const next = normalizeLayout\(layout\);[\s\S]*return manualRotationEnabled\(\)[\s\S]*\? next[\s\S]*: normalizeLayout\(\{ \.\.\.next, rotation: autoRotationForX\(next\.x\) \}\);/);
  assert.match(script, /gesture\.latestLayout = normalizeDragLayout\(layout\);/);
  assert.match(script, /function handleManualRotationToggle\(\) \{[\s\S]*if \(!manualRotationEnabled\(\)\) \{[\s\S]*animateOwnCardsToAutoRotation\(\);[\s\S]*renderRotationWheel\(\);/);
  assert.doesNotMatch(script, /animateSelfControlsHeightChange|selfControlsHeightTimer|MANUAL_ROTATION_LAYOUT_MS/);
  assert.match(script, /function animateOwnCardsToAutoRotation\(\)/);
  assert.match(script, /rotation: autoRotationForX\(layout\.x\)/);
  assert.match(script, /startLayoutAnimation\(card\.id, element\);/);
  assert.match(script, /function startLayoutAnimation\(cardId, element\)/);
  assert.match(script, /state\.layoutAnimationCardIds\[cardId\] = true;/);
  assert.match(script, /void element\.getBoundingClientRect\(\);/);
  assert.match(script, /function clearLayoutAnimation\(cardId\)/);
  assert.match(script, /applyLayout\(element, next, surfaceSize\);/);
  assert.match(script, /element\.classList\.toggle\("layout-animating", canAnimateLayout \|\| isOwnLayoutAnimating\);/);
  assert.match(script, /function canArrangeOwnCards\(\) \{[\s\S]*return state\.room && state\.room\.status !== "ended";/);
  assert.match(script, /if \(!canArrangeOwnCards\(\)\) \{/);
  assert.match(script, /const isOwnSelected = options\.replay[\s\S]*\? player\.seat === state\.mySeat && isReplayClued[\s\S]*: player\.seat === state\.mySeat && isLocallySelected && canArrangeOwnCards\(\);/);
  assert.match(script, /const canShow = manualRotationEnabled\(\) && canArrangeOwnCards\(\);/);
  assert.match(script, /const layout = targets\.length > 0[\s\S]*\? normalizeLayout\(state\.localLayouts\[targets\[0\]\.card\.id\] \|\| targets\[0\]\.card\.layout\)[\s\S]*: normalizeLayout\(\{ x: 50, y: 54, rotation: 0 \}\);/);
  assert.match(script, /if \(!manualRotationEnabled\(\) \|\| targets\.length === 0 \|\| !canArrangeOwnCards\(\)\) return;/);
  assert.match(script, /function canSelectOwnCards\(\) \{[\s\S]*return canArrangeOwnCards\(\) && state\.room\.turnSeat === state\.mySeat;/);
});

test("manual rotation toggle off animates own cards back to auto rotation", () => {
  const client = loadClientForUiStateTest();
  const manualCard = { id: "manual-card", layout: { x: 20, y: 50, rotation: 90 } };
  const autoCard = { id: "auto-card", layout: { x: 70, y: 50, rotation: client.autoRotationForX(70) } };
  const manualElement = layoutCardElement(manualCard.id);
  const autoElement = layoutCardElement(autoCard.id);

  client.state.mySeat = "A";
  client.state.room = {
    status: "playing",
    turnSeat: "B",
    players: [
      { seat: "A", hand: [manualCard, autoCard] },
      { seat: "B", hand: [] }
    ]
  };
  client.state.localLayouts = {
    [manualCard.id]: { ...manualCard.layout },
    [autoCard.id]: { ...autoCard.layout }
  };
  client.selfHand.querySelectorAll = () => [manualElement, autoElement];
  client.manualRotationToggle.checked = false;

  client.handleManualRotationToggle();

  const expectedManualRotation = client.autoRotationForX(manualCard.layout.x);
  assert.equal(manualCard.layout.rotation, expectedManualRotation);
  assert.equal(client.state.localLayouts[manualCard.id].rotation, expectedManualRotation);
  assert.equal(manualElement.dataset.layoutRotation, String(expectedManualRotation));
  assert.equal(manualElement.styleProps["--card-layout-rotation"], `${expectedManualRotation}deg`);
  assert.equal(manualElement.classList.contains("layout-animating"), true);
  assert.deepEqual(manualElement.events.slice(0, 3), [
    "class:add:layout-animating",
    "layout:flush",
    "style:--card-layout-x"
  ]);
  client.selfHand.children = [manualElement, autoElement];
  client.selfHand.insertBefore = () => {};
  client.renderHand(client.selfHand, client.state.room.players[0], { concealed: true, movable: true });
  assert.equal(manualElement.classList.contains("layout-animating"), true);

  assert.equal(autoCard.layout.rotation, client.autoRotationForX(autoCard.layout.x));
  assert.equal(autoElement.classList.contains("layout-animating"), false);
  assert.equal(client.scheduledActions.length, 1);
  assert.equal(client.animationTimers.length, 2);
});

test("client displays official endgame state and blocks ended gameplay", () => {
  const script = read("public/app.js");

  for (const pattern of [
    /Game Over \$\{state\.room\.score\}\/\$\{state\.room\.maxScore\}/,
    /Final turns: \$\{state\.room\.finalTurnsRemaining\}/,
    /const canAct = state\.room\.status !== "ended" && isMyTurn;/,
    /state\.room && state\.room\.status !== "ended" && state\.room\.turnSeat === state\.mySeat/
  ]) {
    assert.match(script, pattern);
  }
});

test("ended game UI exposes compact replay controls", () => {
  const html = read("public/index.html");
  const script = read("public/app.js");

  for (const pattern of [
    /id="replayPanel"/,
    /id="replayPreviousButton"/,
    /id="replayNextButton"/,
    /id="replayTimeline"/,
    /id="replayCsvButton"/,
    /id="opponentFlipButton"[\s\S]*>Flip<\/button>/,
    /id="selfFlipButton"[\s\S]*>Flip<\/button>/
  ]) {
    assert.match(html, pattern);
  }

  assert.doesNotMatch(html, /id="replayToggleButton"/);
  assert.doesNotMatch(html, /id="replayPerspectiveSelect"/);
  assert.ok(html.indexOf('id="replayPreviousButton"') < html.indexOf('id="replayTimeline"'));
  assert.ok(html.indexOf('id="replayTimeline"') < html.indexOf('id="replayNextButton"'));
  assert.ok(html.indexOf('id="replayNextButton"') < html.indexOf('id="replayCsvButton"'));

  assert.doesNotMatch(script, /replayPerspectiveSelect/);
  assert.match(script, /selfFlipButton\.addEventListener\("click", \(\) => toggleReplayHandView\(state\.mySeat\)\);/);
  assert.match(script, /opponentFlipButton\.addEventListener\("click", \(\) => toggleReplayHandView\(opponentSeat\(\)\)\);/);
  assert.match(script, /function replayHandView\(seat\)/);
  assert.match(script, /function toggleReplayHandView\(seat\)/);
  assert.match(script, /replayCsvButton\.addEventListener\("click", \(\) => downloadReplayCsv\(\)\);/);
  assert.match(script, /fetch\(`\/api\/replay\?code=\$\{encodeURIComponent\(state\.room\.code\)\}`\)/);
  assert.match(script, /\/api\/replay\.csv\?code=\$\{encodeURIComponent\(state\.room\.code\)\}/);
  assert.match(script, /function replayTimelineEvents\(\)/);
  assert.match(script, /data\.layoutEvents/);
  assert.match(script, /\[\.\.\.actions, \.\.\.layouts\]\.sort\(\(a, b\) => a\.seq - b\.seq\)/);
  assert.match(script, /const events = replayTimelineEvents\(\);/);
  assert.match(script, /selfControls\.classList\.toggle\("replay-active", isEnded\);/);
  assert.match(script, /function ensureReplayOpenAtLatest\(\)/);
  assert.match(script, /fetchReplay\(\{ openAtLatest: true \}\);/);
  assert.match(script, /function openReplayAtLatest\(options = \{\}\)/);
  assert.match(script, /state\.replay\.index = Math\.max\(0, events\.length - 1\);/);
  assert.match(script, /state\.room\.status === "ended"/);
  assert.match(html, /class="area-actions self-controls"[\s\S]*id="replayPanel"/);
});

test("replay card backs render rank and color possibility grids", () => {
  const script = read("public/app.js");

  assert.match(script, /function renderKnowledgeGrid\(card, knowledge\)/);
  assert.match(script, /knowledge-color-strip/);
  assert.match(script, /knowledge-rank-strip/);
  assert.match(script, /renderKnowledgeGrid\(card, replayKnowledgeForCard\(card\.id, options\.knowledgeSeat\)\)/);
});

test("replay flip reuses the existing card flipper animation", () => {
  const script = read("public/app.js");

  assert.match(script, /syncReplayCardVisual\(element, card, visualMode, knowledgeGrid\);/);
  assert.match(script, /function syncReplayCardVisual\(element, card, visualMode, knowledgeGrid = null\)/);
  assert.match(script, /flipper\.className = "action-card-flipper replay-card-flipper";/);
  assert.match(script, /back\.className = "action-card-side action-card-back-side replay-card-side";/);
  assert.match(script, /face\.className = "action-card-side action-card-face-side replay-card-side";/);
  assert.match(script, /element\.classList\.toggle\("is-revealed", visualMode === "face"\);/);
});

test("replay animates layouts and restores clue highlights", () => {
  const script = read("public/app.js");

  assert.match(script, /animateLayout: replayOpen/);
  assert.match(script, /const canAnimateLayout = options\.animateLayout === true && \(options\.replay \|\| player\.seat !== state\.mySeat\);/);
  assert.match(script, /function replayClueSelection\(\)/);
  assert.match(script, /if \(event\?\.type !== "give-clue"\) return null;/);
  assert.match(script, /function replayClueSelectionForSeat\(seat\)/);
  assert.match(script, /const replaySelection = options\.replay \? replayClueSelectionForSeat\(player\.seat\) : null;/);
  assert.match(script, /const isReplayClued = Boolean\(replaySelection\?\.cardIds\.includes\(card\.id\)\);/);
  assert.match(script, /renderSingleClueLabel\(selfClueLabel, replaySelection\?\.seat === state\.mySeat \? replaySelection : null\);/);
  assert.match(script, /renderSingleClueLabel\(opponentClueLabel, replaySelection\?\.seat === opponentSeat\(\) \? replaySelection : null\);/);
});

test("replay action animation is planned only for adjacent steps", () => {
  const client = loadClientForUiStateTest();
  const currentActionResult = {
    action: "play",
    type: "firework",
    cardId: "a1",
    card: { id: "a1", color: "red", rank: 1 }
  };
  const nextActionResult = {
    action: "discard",
    type: "discard",
    cardId: "a2",
    card: { id: "a2", color: "blue", rank: 2 }
  };
  client.state.replay.data = {
    actionEvents: [
      { seq: 1, type: "play", result: currentActionResult, hands: {}, table: {}, knowledge: {} },
      { seq: 2, type: "discard", result: nextActionResult, hands: {}, table: {}, knowledge: {} },
      { seq: 4, type: "give-clue", hands: {}, table: {}, knowledge: {} }
    ],
    layoutEvents: [
      { seq: 3, type: "layout", hands: {}, table: {}, knowledge: {} }
    ]
  };

  const forwardPlan = client.replayActionTransitionPlan(0, 1);
  assert.equal(forwardPlan?.result, currentActionResult);
  assert.equal(forwardPlan?.direction, "forward");
  const reversePlan = client.replayActionTransitionPlan(1, 0);
  assert.equal(reversePlan?.result, currentActionResult);
  assert.equal(reversePlan?.direction, "reverse");
  assert.equal(client.replayActionTransitionPlan(0, 2), null);

  client.state.replay.settings.showLayoutCheckpoints = true;
  const forwardToLayoutPlan = client.replayActionTransitionPlan(1, 2);
  assert.equal(forwardToLayoutPlan?.result, nextActionResult);
  assert.equal(forwardToLayoutPlan?.direction, "forward");
  const reverseFromLayoutPlan = client.replayActionTransitionPlan(2, 1);
  assert.equal(reverseFromLayoutPlan?.result, nextActionResult);
  assert.equal(reverseFromLayoutPlan?.direction, "reverse");
  assert.equal(client.replayActionTransitionPlan(2, 3), null);
});

test("same-target replay index updates keep an active action animation", () => {
  const client = loadClientForUiStateTest();
  client.state.room = { status: "ended" };
  client.state.replay.data = {
    actionEvents: [
      { seq: 1, type: "play", hands: {}, table: {}, knowledge: {} },
      { seq: 2, type: "give-clue", hands: {}, table: {}, knowledge: {} }
    ],
    layoutEvents: []
  };
  let overlayRemoved = false;
  client.state.replay.index = 1;
  client.state.replay.actionAnimation = {
    key: "replay:test",
    overlay: {
      remove() {
        overlayRemoved = true;
      }
    },
    destElement: fakeElement(),
    timers: []
  };

  client.setReplayIndex(1);

  assert.equal(overlayRemoved, false);
  assert.equal(client.state.replay.actionAnimation?.key, "replay:test");
});

test("reverse replay action commits state immediately and hides the returning card until it lands", () => {
  const client = loadClientForUiStateTest();
  const discardedCard = { id: "a1", color: "white", rank: 2, layout: { x: 75, y: 48, rotation: 5 } };
  const targetElement = fakeElement();
  targetElement.dataset.cardId = discardedCard.id;
  targetElement.dataset.layoutRotation = String(discardedCard.layout.rotation);
  client.document.querySelectorAll = (selector) => (selector === ".table-card" ? [targetElement] : []);
  let appendedOverlay = null;
  client.document.body.append = (element) => {
    appendedOverlay = element;
  };
  client.state.room = {
    code: "ROOM",
    status: "ended",
    maxHints: 8,
    maxBombs: 3,
    turnSeat: "A",
    players: []
  };
  client.state.replay = {
    ...client.state.replay,
    isOpen: true,
    index: 1,
    data: {
      code: "ROOM",
      colors: [{ id: "white", label: "White" }],
      settings: { maxHints: 8, maxBombs: 3 },
      players: [{ seat: "A", name: "Player A" }, { seat: "B", name: "Player B" }],
      actionEvents: [
        {
          seq: 1,
          type: "discard",
          result: {
            action: "discard",
            type: "discard",
            actorSeat: "A",
            cardId: discardedCard.id,
            card: discardedCard
          },
          hands: { A: [discardedCard], B: [] },
          table: { deckCount: 47, discard: [], fireworks: { white: 0 }, bombs: 0, hints: 7 },
          knowledge: { A: { cards: {} }, B: { cards: {} } }
        },
        {
          seq: 2,
          type: "give-clue",
          hands: { A: [], B: [] },
          table: { deckCount: 46, discard: [discardedCard], fireworks: { white: 0 }, bombs: 0, hints: 7 },
          knowledge: { A: { cards: {} }, B: { cards: {} } }
        }
      ],
      layoutEvents: []
    }
  };
  client.state.hasRenderedRoom = true;
  client.state.seenCardIds = new Set();

  client.setReplayIndex(0, { animateAction: true });

  assert.equal(client.state.replay.index, 0);
  assert.ok(client.state.replay.actionAnimation);
  assert.ok(appendedOverlay?.layoutReadCount > 0);
  assert.equal(targetElement.classList.contains("replay-action-source-hidden"), true);

  client.finishReplayActionFlight(client.state.replay.actionAnimation.key);

  assert.equal(client.state.replay.actionAnimation, null);
  assert.equal(targetElement.classList.contains("replay-action-source-hidden"), false);
  assert.equal(client.selfHand.children.some((element) => element.classList.contains("new-card")), false);
});

test("reverse replay action overlay moves without changing layout properties", () => {
  const client = loadClientForUiStateTest();
  const overlay = fakeElement();
  const startRect = { left: 12, top: 24, width: 40, height: 64, rotation: -8, scale: 0.5 };
  const targetRect = { left: 80, top: 96, width: 40, height: 64, rotation: 12 };

  client.placeReplayReverseActionOverlay(overlay, startRect);
  const startLeft = overlay.style.left;
  const startTop = overlay.style.top;

  client.moveReplayReverseActionOverlay(overlay, startRect, targetRect, 220);

  assert.equal(overlay.style.left, startLeft);
  assert.equal(overlay.style.top, startTop);
  assert.match(overlay.style.transform, /translate3d\(68px, 72px, 0\)/);
  assert.match(overlay.style.transform, /rotate\(12deg\)/);
  assert.match(overlay.style.transform, /scale\(1\)/);
});

test("replay auto-open defers to the live end-of-game animation", () => {
  const script = read("public/app.js");

  assert.match(script, /function liveActionAnimationActive\(\) \{\s*return Boolean\(state\.tableStateHold \|\| state\.pendingDrawAnimation\);/);
  assert.match(script, /if \(liveActionAnimationActive\(\)\) return;\s*openReplayAtLatest\(\{ update: false \}\);/);
  assert.match(script, /state\.tableStateHold = null;\s*if \(state\.room\) \{\s*ensureReplayOpenAtLatest\(\);/);
  assert.match(script, /state\.pendingDrawAnimation = null;\s*if \(options\.update !== false && state\.room\) \{\s*ensureReplayOpenAtLatest\(\);/);
});

test("replay steps commit state first and fly overlays to measured destinations", () => {
  const script = read("public/app.js");

  const forward = script.match(/function animateReplayActionForwardTransition\(plan\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(forward, "Missing animateReplayActionForwardTransition");
  assert.match(forward, /state\.replay\.index = plan\.targetIndex;\s*render\(\);[\s\S]*const path = actionResultPath\(plan\.result\);/);
  assert.match(forward, /destElement\.classList\.add\("replay-action-source-hidden"\);/);

  const reverse = script.match(/function animateReplayActionReverseTransition\(plan\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(reverse, "Missing animateReplayActionReverseTransition");
  assert.match(reverse, /state\.replay\.index = plan\.targetIndex;[\s\S]*render\(\);[\s\S]*const destElement = cardElementForCardId\(plan\.result\.cardId\);/);

  const finish = script.match(/function finishReplayActionFlight\(key\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(finish, "Missing finishReplayActionFlight");
  assert.match(finish, /animation\.overlay\?\.remove\(\);\s*animation\.ghost\?\.remove\(\);\s*unhideReplayActionDestination\(animation\.destElement\);/);
  assert.doesNotMatch(finish, /render\(\)/);

  assert.match(script, /function createFireworkGhost\(result\)/);
  assert.doesNotMatch(script, /replayReverseTargetRect|replayActionVisualEvent|is-settling|settlingAction/);
  assert.doesNotMatch(read("public/styles.css"), /is-settling/);
});

test("replay board highlights the last completed action, not the upcoming one", () => {
  const script = read("public/app.js");
  const server = read("server.js");

  assert.match(script, /lastResult: table\.lastResult \|\| null,/);
  assert.doesNotMatch(script, /lastResult: event\?\.result \|\| null,/);
  assert.match(server, /score: scoreRoom\(room\),\s*lastResult: room\.lastResult\s*\};/);
});

test("replay forward steps animate the replacement draw", () => {
  const script = read("public/app.js");

  assert.match(script, /const replacement = plan\.event\.replacementCard \|\| null;/);
  assert.match(script, /state\.pendingDrawAnimation = \{\s*key: snapshot\.key,\s*seat: plan\.result\.actorSeat,\s*cardId: replacement\.id\s*\};/);
  assert.match(script, /animateReplayReplacementDraw\(animation\.key, animation\.drawSeat, animation\.drawCard\);/);
  assert.match(script, /function animateReplayReplacementDraw\(key, seat, card\)/);
  assert.match(script, /function animateDrawIntoHand\(key, replacement\)/);
  assert.match(script, /animateDrawIntoHand\(snapshot\.key, replacement\);/);
  assert.match(script, /const concealed = !cardHasDetails\(card\) \|\| replayHandView\(seat\) === "knowledge";/);
  assert.match(script, /knowledgeGrid: concealed \? renderKnowledgeGrid\(card, replayKnowledgeForCard\(card\.id, seat\)\) : null/);
  assert.match(script, /if \(concealed && replacement\.knowledgeGrid\) \{\s*visual\.append\(replacement\.knowledgeGrid\);/);
});

test("replay discard targeting uses the displayed replay snapshot", () => {
  const client = loadClientForUiStateTest();
  const discardedCard = { id: "r3", color: "red", rank: 3 };
  client.state.room = {
    code: "ROOM",
    status: "ended",
    fireworks: { red: 5 },
    players: []
  };
  client.state.replay = {
    ...client.state.replay,
    isOpen: true,
    index: 0,
    data: {
      code: "ROOM",
      colors: [{ id: "red", label: "Red" }],
      settings: { maxHints: 8, maxBombs: 3 },
      actionEvents: [
        {
          seq: 1,
          type: "discard",
          result: { action: "discard", type: "discard", cardId: discardedCard.id, card: discardedCard },
          hands: { A: [], B: [] },
          table: { deckCount: 40, discard: [], fireworks: { red: 2 }, bombs: 0, hints: 7 },
          knowledge: { A: { cards: {} }, B: { cards: {} } }
        }
      ],
      layoutEvents: []
    }
  };

  assert.equal(client.discardBucketForCard(discardedCard), client.neededDiscardPile);
});

test("hidden replay setting folds layout checkpoints into action steps", () => {
  const client = loadClientForUiStateTest();
  const layoutSnapshot = {
    hands: {
      A: [{ id: "a1", color: "red", rank: 1, layout: { x: 42, y: 44, rotation: 12 } }],
      B: [{ id: "b1", color: "blue", rank: 2, layout: { x: 50, y: 50, rotation: 0 } }]
    },
    table: { deckCount: 40, score: 0, hints: 7, bombs: 0 },
    knowledge: { A: { cards: {} }, B: { cards: {} } }
  };
  client.state.replay.data = {
    actionEvents: [
      {
        seq: 1,
        type: "give-clue",
        hands: {
          A: [{ id: "a1", color: "red", rank: 1, layout: { x: 20, y: 30, rotation: 0 } }],
          B: [{ id: "b1", color: "blue", rank: 2, layout: { x: 50, y: 50, rotation: 0 } }]
        },
        table: { deckCount: 40, score: 0, hints: 7, bombs: 0 },
        knowledge: { A: { cards: {} }, B: { cards: {} } }
      },
      {
        seq: 3,
        type: "play",
        hands: {
          A: [{ id: "a1", color: "red", rank: 1, layout: { x: 20, y: 30, rotation: 0 } }],
          B: [{ id: "b1", color: "blue", rank: 2, layout: { x: 50, y: 50, rotation: 0 } }]
        },
        table: { deckCount: 40, score: 0, hints: 7, bombs: 0 },
        knowledge: { A: { cards: {} }, B: { cards: {} } }
      }
    ],
    layoutEvents: [
      { seq: 2, type: "layout", ...layoutSnapshot }
    ]
  };

  let events = client.replayTimelineEvents();
  assert.deepEqual(Array.from(events, (event) => event.type), ["give-clue", "play"]);
  assert.equal(events[1].hands.A[0].layout.x, 42);
  assert.equal(events[1].hands.A[0].layout.rotation, 12);

  client.setReplayLayoutCheckpointsVisible(true, { update: false });
  events = client.replayTimelineEvents();
  assert.deepEqual(Array.from(events, (event) => event.type), ["give-clue", "layout", "play"]);

  client.state.replay.index = 1;
  client.setReplayLayoutCheckpointsVisible(false, { update: false });
  events = client.replayTimelineEvents();
  assert.deepEqual(Array.from(events, (event) => event.type), ["give-clue", "play"]);
  assert.equal(client.state.replay.index, 1);
  assert.equal(events[1].hands.A[0].layout.x, 42);
});

test("rainbow cards are included as a sixth suit", () => {
  const server = read("server.js");
  const script = read("public/app.js");

  assert.match(server, /id: "rainbow", label: "Rainbow"/);
  assert.match(script, /id: "rainbow", label: "Rainbow"/);
});
