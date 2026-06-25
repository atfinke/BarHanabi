const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

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
    /id="verbalClueButton"/,
    /id="autoCluePreviewToggle"/,
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
  assert.ok(resetButtonBlocks.length > 0);
  assert.match(html, /id="resetButton"[\s\S]*>Restart<\/button>/);

  const autoClueRule = cssRule(styles, ".auto-clue-toggle");
  const resetButtonRule = cssRule(styles, ".reset-button");
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 520px)"));
  const mobileAutoClueRule = cssRule(mobileStyles, ".auto-clue-toggle");
  const mobileResetButtonRule = cssRule(mobileStyles, ".reset-button");

  for (const property of ["font-size", "font-weight", "line-height", "text-transform"]) {
    assert.equal(declarationValue(resetButtonRule, property), declarationValue(autoClueRule, property));
    assert.equal(
      declarationValue(mobileResetButtonRule, property),
      declarationValue(mobileAutoClueRule, property)
    );
  }

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

test("auto clue checkbox cannot create mobile horizontal overflow", () => {
  const styles = read("public/styles.css");
  const toggleRule = cssRule(styles, ".auto-clue-toggle");
  const inputRule = cssRule(styles, ".auto-clue-toggle input");

  assert.match(toggleRule, /position: relative;/);
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

test("client keeps verbal clue selection and action-selection flows separate", () => {
  const script = read("public/app.js");

  for (const pattern of [
    /cluePreview/,
    /type: "clue-selection"/,
    /type: "verbal-clue"/,
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
  assert.match(script, /verbalClueButton\.addEventListener\("click", \(\) => giveVerbalClue\(\)\);/);
  assert.match(script, /function selectedOpponentClueCandidates\(\)/);
  assert.match(script, /function hasValidOpponentClueSelection\(\)/);
  assert.match(script, /const targetCardIds = selectedCardIds\(opponentSeat\(\)\);/);
  assert.match(script, /return selectedOpponentClueCandidates\(\)\.length > 0;/);
  assert.match(script, /verbalClueButton\.disabled = state\.pendingAction \|\| !canAct \|\| state\.room\.hints <= 0 \|\| !hasValidOpponentClueSelection\(\);/);
  assert.doesNotMatch(script, /autoClueButton/);
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
  assert.match(styles, /\.clue-chooser \{/);
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
  assert.match(script, /verbalClueButton\.disabled =[\s\S]*state\.room\.hints <= 0/);
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

test("card interactions auto-rotate during drag without gesture controls", () => {
  const script = read("public/app.js");
  const styles = read("public/styles.css");

  for (const pattern of [
    /function bindCardPointer/,
    /function autoRotationForX/,
    /rotation: autoRotationForX\(x\)/,
    /const clampedX = clamp\(x, 12, 88\)/,
    /const rotation = Number\.isFinite\(Number\(next\.rotation\)\) \? Number\(next\.rotation\) : autoRotationForX\(clampedX\)/,
    /rotation: clamp\(rotation, -145, 145\)/
  ]) {
    assert.match(script, pattern);
  }

  assert.match(styles, /\.self-hand \{[\s\S]*touch-action: none;/);
  assert.doesNotMatch(script, /rotateSelected|rotateLeftButton|rotateRightButton/);
  assert.doesNotMatch(script, /handPointers|rotationGesture|gesturestart|gesturechange|gestureend|gesturecancel|GestureEvent|event\.rotation|angleDelta/);
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
