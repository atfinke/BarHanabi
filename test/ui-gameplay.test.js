const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function cssRule(styles, selector) {
  const start = styles.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing CSS rule for ${selector}`);
  const end = styles.indexOf("\n}", start);
  assert.notEqual(end, -1, `Unclosed CSS rule for ${selector}`);
  return styles.slice(start, end + 2);
}

function declarationValue(rule, property) {
  const match = rule.match(new RegExp(`${property}:\\s*([^;]+);`));
  assert.ok(match, `Missing ${property} in ${rule}`);
  return match[1];
}

function fakeElement() {
  return {
    checked: false,
    disabled: false,
    dataset: {},
    style: {
      setProperty() {}
    },
    offsetWidth: 40,
    offsetHeight: 64,
    textContent: "",
    classList: {
      add() {},
      remove() {},
      contains() {
        return true;
      },
      toggle() {}
    },
    addEventListener() {},
    append() {},
    replaceChildren() {},
    remove() {},
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    },
    setAttribute() {}
  };
}

function loadClientForUiStateTest() {
  const elements = new Map();
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
      matchMedia() {
        return { matches: false };
      },
      requestAnimationFrame(callback) {
        callback(0);
      },
      setTimeout() {
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
      getItem() {
        return null;
      },
      setItem() {}
    },
    URLSearchParams,
    requestAnimationFrame(callback) {
      callback(0);
    },
    setTimeout,
    clearTimeout,
    console
  };

  vm.runInNewContext(
    `${read("public/app.js")}\nglobalThis.__client = { state, applyRoomState, tableDisplayRoom, updateActionButtons, updateRoomCodeLabel, roomCodeLabel, selfPlayButton, selfDiscardButton, selfHand, opponentHand };`,
    sandbox
  );
  return sandbox.__client;
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

test("setup screen uses softened browser chrome and wider mobile gutters", () => {
  const html = read("public/index.html");
  const styles = read("public/styles.css");

  assert.match(html, /<meta name="theme-color" content="#151c20">/);
  assert.match(styles, /--chrome-bg: #151c20;/);
  assert.match(styles, /--page-x: clamp\(20px, 5\.5vw, 28px\);/);
  assert.match(styles, /\.app-shell \{[\s\S]*padding: calc\(env\(safe-area-inset-top\) \+ 12px\) var\(--page-x\) calc\(env\(safe-area-inset-bottom\) \+ 14px\);/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*\.app-shell \{[\s\S]*padding: calc\(env\(safe-area-inset-top\) \+ 8px\) var\(--page-x\) calc\(env\(safe-area-inset-bottom\) \+ 8px\);/);
  assert.doesNotMatch(styles, /padding: calc\(env\(safe-area-inset-top\) \+ 8px\) 8px calc\(env\(safe-area-inset-bottom\) \+ 8px\);/);
});

test("mobile UI exposes current controls and omits retired controls", () => {
  const html = read("public/index.html");
  const styles = read("public/styles.css");

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

  const resetButtonBlocks = styles.match(/\.reset-button\s*\{[^}]*\}/g) || [];
  assert.equal(resetButtonBlocks.length, 0);
  assert.match(html, /id="resetButton"[\s\S]*>Restart<\/button>/);
  assert.doesNotMatch(html, /id="resetButton"[^>]*danger-outline/);

  const settingsActionButtonRule = cssRule(styles, ".settings-action-button");
  const settingsToggleRule = cssRule(styles, ".settings-toggle");
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 520px)"));
  const mobileSettingsButtonRule = cssRule(mobileStyles, ".settings-button");

  assert.match(styles, /\.settings-button,\n\.settings-close-button \{[\s\S]*width: 40px;/);
  assert.equal(declarationValue(mobileSettingsButtonRule, "width"), "38px");
  assert.equal(declarationValue(settingsActionButtonRule, "width"), "100%");
  assert.equal(declarationValue(settingsToggleRule, "justify-content"), "space-between");

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
  const styles = read("public/styles.css");

  assert.match(html, /id="settingsButton"[\s\S]*aria-controls="settingsPopover"[\s\S]*aria-expanded="false"/);
  assert.match(html, /id="settingsPopover"[\s\S]*aria-hidden="true"/);
  assert.match(html, /class="settings-popover-header"[\s\S]*id="settingsPopoverTitle">Settings<\/h2>/);
  assert.match(html, /class="settings-controls"[\s\S]*id="resetButton"[\s\S]*Restart/);
  assert.match(html, /for="autoCluePreviewToggle"[\s\S]*Auto Clue[\s\S]*id="autoCluePreviewToggle"/);
  assert.match(html, /for="manualRotationToggle"[\s\S]*Manual Rotation[\s\S]*id="manualRotationToggle"/);
  assert.doesNotMatch(html, /settingsPopover[\s\S]*(hintSetting|bombSetting|rainbowSetting)/);

  for (const pattern of [
    /const settingsButton = document\.querySelector\("#settingsButton"\);/,
    /const settingsPopover = document\.querySelector\("#settingsPopover"\);/,
    /settingsButton\.addEventListener\("click", \(\) => toggleSettingsPopover\(\)\);/,
    /function openSettingsPopover\(\)/,
    /function closeSettingsPopover\(\)/,
    /settingsButton\.setAttribute\("aria-expanded", "true"\);/,
    /settingsButton\.setAttribute\("aria-expanded", "false"\);/
  ]) {
    assert.match(script, pattern);
  }

  assert.match(styles, /\.clue-chooser,\n\.settings-popover \{/);
  assert.match(styles, /\.clue-chooser-panel,\n\.settings-popover-panel \{/);
  assert.match(html, /class="settings-icon"[\s\S]*viewBox="0 0 24 24"/);
  assert.match(styles, /\.settings-icon \{/);
  assert.match(styles, /\.settings-toggle \{/);
});

test("room code control copies the full room share link", () => {
  const html = read("public/index.html");
  const script = read("public/app.js");
  const styles = read("public/styles.css");

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
  assert.match(styles, /\.room-code-button \{/);
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

test("settings toggles cannot create mobile horizontal overflow", () => {
  const styles = read("public/styles.css");
  const toggleRule = cssRule(styles, ".settings-toggle");
  const inputRule = cssRule(styles, ".settings-toggle input");

  assert.match(toggleRule, /position: relative;/);
  assert.match(toggleRule, /justify-content: space-between;/);
  assert.match(inputRule, /position: absolute;/);
  assert.match(inputRule, /inset: 0;/);
  assert.match(inputRule, /width: 100%;/);
  assert.match(inputRule, /min-height: 0;/);
  assert.match(inputRule, /height: 100%;/);
  assert.match(inputRule, /margin: 0;/);
});

test("game state shows hints before bombs", () => {
  const html = read("public/index.html");
  const script = read("public/app.js");

  assert.match(html, /<span>Deck<\/span>[\s\S]*id="deckCount"[\s\S]*<span>Hints<\/span>[\s\S]*id="hintCount"[\s\S]*<span>Bombs<\/span>[\s\S]*id="bombCount"/);
  assert.match(script, /hintCount\.textContent = `\$\{tableRoom\.hints\}\/\$\{tableRoom\.maxHints\}`;/);
  assert.match(script, /bombCount\.textContent = `\$\{tableRoom\.bombs\}\/\$\{tableRoom\.maxBombs\}`;/);
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
  const styles = read("public/styles.css");

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
  assert.match(styles, /\.clue-chooser,\n\.settings-popover \{/);
  assert.match(styles, /\.clue-chooser-options \{/);
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
  const styles = read("public/styles.css");

  assert.match(script, /const selfClueLabel = document\.querySelector\("#selfClueLabel"\);/);
  assert.match(script, /const opponentClueLabel = document\.querySelector\("#opponentClueLabel"\);/);
  assert.match(script, /function renderClueLabels\(\)/);
  assert.match(script, /renderSingleClueLabel\(selfClueLabel, selection\.seat === state\.mySeat \? selection : null\);/);
  assert.match(script, /renderSingleClueLabel\(opponentClueLabel, selection\.seat === opponentSeat\(\) \? selection : null\);/);
  assert.match(script, /selfClueLabel\.textContent = selection\.clue\.label;/);
  assert.match(html, /id="opponentClueLabel"/);
  assert.match(styles, /\.clue-label \{/);
  assert.match(styles, /--other-selection-dot-width: 4px;/);
  assert.match(styles, /\.clue-label::before \{/);
  assert.match(styles, /border: var\(--other-selection-dot-width\) dotted var\(--other-selection-ring\);/);
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
  const styles = read("public/styles.css");
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
  assert.match(styles, /\.rotation-wheel \{[\s\S]*touch-action: none;/);
  assert.match(styles, /\.rotation-wheel-track \{/);
  assert.match(styles, /\.rotation-wheel-knob \{/);
  assert.match(styles, /\.rotation-wheel-spoke,\n\.rotation-wheel-knob \{[\s\S]*transition: transform 180ms/);
  assert.match(styles, /\.rotation-wheel\.is-rotating \.rotation-wheel-spoke,\n\.rotation-wheel\.is-rotating \.rotation-wheel-knob \{[\s\S]*transition-duration: 0ms;/);
  assert.match(cssRule(styles, ".rotation-wheel-track"), /rgba\(16, 38, 76, 0\.9\)/);
  assert.match(styles, /\.self-hand \{[\s\S]*touch-action: none;/);
  assert.doesNotMatch(script, /rotateSelected|rotateLeftButton|rotateRightButton/);
  assert.doesNotMatch(script, /rotation: autoRotationForX\(x\)/);
  assert.doesNotMatch(script, /gesture\.rotationStart|pointers\.length >= 2/);
  assert.doesNotMatch(script, /gesturestart|gesturechange|gestureend|gesturecancel|GestureEvent|event\.rotation/);
});

test("manual rotation mode does not disable auto rotation or off-turn arrangement", () => {
  const script = read("public/app.js");

  assert.match(script, /manualRotationToggle\.addEventListener\("change", \(\) => renderRotationWheel\(\)\);/);
  assert.match(script, /function normalizeDragLayout\(layout\) \{[\s\S]*const next = normalizeLayout\(layout\);[\s\S]*return manualRotationEnabled\(\)[\s\S]*\? next[\s\S]*: normalizeLayout\(\{ \.\.\.next, rotation: autoRotationForX\(next\.x\) \}\);/);
  assert.match(script, /gesture\.latestLayout = normalizeDragLayout\(layout\);/);
  assert.match(script, /function canArrangeOwnCards\(\) \{[\s\S]*return state\.room && state\.room\.status !== "ended";/);
  assert.match(script, /if \(!canArrangeOwnCards\(\)\) \{/);
  assert.match(script, /const isOwnSelected = player\.seat === state\.mySeat && isLocallySelected && canArrangeOwnCards\(\);/);
  assert.match(script, /const canShow = manualRotationEnabled\(\) && canArrangeOwnCards\(\);/);
  assert.match(script, /const layout = targets\.length > 0[\s\S]*\? normalizeLayout\(state\.localLayouts\[targets\[0\]\.card\.id\] \|\| targets\[0\]\.card\.layout\)[\s\S]*: normalizeLayout\(\{ x: 50, y: 54, rotation: 0 \}\);/);
  assert.match(script, /if \(!manualRotationEnabled\(\) \|\| targets\.length === 0 \|\| !canArrangeOwnCards\(\)\) return;/);
  assert.match(script, /function canSelectOwnCards\(\) \{[\s\S]*return canArrangeOwnCards\(\) && state\.room\.turnSeat === state\.mySeat;/);
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

test("rainbow cards are included as a sixth suit", () => {
  const server = read("server.js");
  const script = read("public/app.js");
  const styles = read("public/styles.css");

  assert.match(server, /id: "rainbow", label: "Rainbow"/);
  assert.match(script, /id: "rainbow", label: "Rainbow"/);
  assert.match(styles, /\.color-rainbow/);
});
