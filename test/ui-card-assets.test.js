const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("card art assets are wired through the client", () => {
  const script = fs.readFileSync("public/app.js", "utf8");

  assert.ok(fs.existsSync("public/assets/cards/back.webp"));
  assert.match(script, /assets\/cards\/[^`'"]*\.webp/);
  assert.match(script, /card-art/);
  assert.match(script, /card-back-art/);
});

test("full-size cards stay visually blank until image assets load", () => {
  const script = fs.readFileSync("public/app.js", "utf8");
  assert.doesNotMatch(script, /card-asset-fallback/);

  assert.match(script, /function revealCardImageWhenReady/);
  assert.match(script, /image\.complete && image\.naturalWidth > 0/);
});

test("discard thumbnails reuse card face artwork", () => {
  const script = fs.readFileSync("public/app.js", "utf8");

  assert.match(script, /item\.replaceChildren\(createCardFace\(card, \{ revealImmediately: true \}\)\);/);
  assert.doesNotMatch(script, /const rank = document\.createElement\("strong"\);[\s\S]*item\.replaceChildren\(rank\);/);
});

test("unchanged discard piles are not rebuilt during hand move renders", () => {
  const script = fs.readFileSync("public/app.js", "utf8");

  assert.match(script, /discardRenderKey:\s*""/);
  assert.match(script, /function discardRenderKey\(room, cards\)/);
  assert.match(script, /const renderKey = discardRenderKey\(room, cards\);/);
  assert.match(script, /if \(renderKey === state\.discardRenderKey\) return;/);
  assert.match(script, /state\.discardRenderKey = renderKey;/);
});

test("new discard cards do not rebuild existing discard thumbnails", () => {
  const script = fs.readFileSync("public/app.js", "utf8");

  assert.match(script, /function discardElementsByCardId\(\)/);
  assert.match(script, /let element = existingElements\.get\(card\.id\);/);
  assert.match(script, /if \(!element\) \{[\s\S]*element = createMiniCard\(card\);[\s\S]*\}/);
  assert.match(script, /updateMiniCard\(element, card, isLastDiscard\(card, room\)\);/);
  assert.match(script, /syncDiscardChildren\(neededDiscardPile, needed\);/);
  assert.match(script, /syncDiscardChildren\(spentDiscardPile, spent\);/);
  assert.doesNotMatch(script, /neededDiscardPile\.replaceChildren\(\.\.\.needed\);/);
  assert.doesNotMatch(script, /spentDiscardPile\.replaceChildren\(\.\.\.spent\);/);
});

test("hidden card backs stay image-only", () => {
  const script = fs.readFileSync("public/app.js", "utf8");

  assert.doesNotMatch(script, /hidden-mark/);
  assert.doesNotMatch(script, /slot-number/);
  assert.doesNotMatch(script, /textContent = "\\?"/);
});
