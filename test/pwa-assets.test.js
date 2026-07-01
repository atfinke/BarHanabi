const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function pngDimensions(path) {
  const buffer = fs.readFileSync(path);
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

test("app shell advertises Home Screen metadata", () => {
  const html = read("public/index.html");

  for (const pattern of [
    /<meta name="theme-color" content="#151c20">/,
    /<meta name="apple-mobile-web-app-capable" content="yes">/,
    /<meta name="apple-mobile-web-app-title" content="Bar Hanabi">/,
    /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/,
    /<meta name="mobile-web-app-capable" content="yes">/,
    /<meta name="application-name" content="Bar Hanabi">/,
    /<link rel="manifest" href="\/manifest\.webmanifest">/,
    /<link rel="apple-touch-icon" sizes="180x180" href="\/assets\/icons\/app-icon-180\.png">/,
    /<link rel="icon" type="image\/png" sizes="192x192" href="\/assets\/icons\/app-icon-192\.png">/
  ]) {
    assert.match(html, pattern);
  }

  assert.doesNotMatch(html, /<link rel="icon" href="data:,">/);
});

test("web app manifest uses standalone iPhone-friendly launch metadata", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));

  assert.equal(manifest.name, "Bar Hanabi");
  assert.equal(manifest.short_name, "Bar Hanabi");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#151c20");
  assert.equal(manifest.background_color, "#151c20");
  assert.equal(manifest.orientation, "portrait");
  assert.deepEqual(
    manifest.icons.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type,
      purpose: icon.purpose
    })),
    [
      {
        src: "/assets/icons/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/assets/icons/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable"
      }
    ]
  );
});

test("Home Screen icon files exist at declared sizes", () => {
  for (const size of [180, 192, 512]) {
    assert.deepEqual(pngDimensions(`public/assets/icons/app-icon-${size}.png`), {
      width: size,
      height: size
    });
  }
});

test("static server serves manifest and icon MIME types", () => {
  const server = read("server.js");

  assert.match(server, /\.png": "image\/png"/);
  assert.match(server, /\.webmanifest": "application\/manifest\+json; charset=utf-8"/);
});
