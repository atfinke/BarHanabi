# Agent Notes

Small two-phone Hanabi table app. Keep changes direct, mobile-first, and easy
to deploy.

## Current Shape

- `server.js`: Node HTTP server, API, in-memory rooms, and SSE broadcaster.
- `public/`: dependency-free client.
- `test/`: Node test runner coverage.
- `.deploy/` and `screenshots/`: local-only; never commit their contents.

## Rules For Future Agents

- Do not commit credentials, SSH keys, AWS keys, screenshots, or generated local
  deployment files.
- Do not add client dependencies unless there is a clear reason. The app is
  intentionally dependency-free for quick deploys.
- Preserve the two-phone flow: creator defaults to player A, joiner defaults to
  player B, but both can manually switch seats.
- Existing rooms are in memory. Any server restart wipes active games.
- Favor fixes that keep the app usable on iPhone-sized screens first.
- Keep controls obvious. Avoid adding text-heavy help panels to the game screen.
- The user may edit this repo concurrently. Re-read target files and diffs
  before patching, keep edits narrow, and never overwrite unrelated local work.
- Treat end-game changes as user-owned unless explicitly asked to work on them.
- Before deploying, run `node --check server.js`, `node --check public/app.js`,
  and relevant `node --test` tests unless explicitly skipped.

## Test Discipline

- Tests are not a receipt for every edit. Add a new test only when it protects
  meaningful behavior that could plausibly regress and would matter to a player,
  deploy, or server contract.
- Prefer updating existing behavior tests over adding new tests. For renames,
  copy cleanup, selector cleanup, dead-code removal, or internal wiring changes,
  update existing assertions and use `rg`/syntax checks when that is enough.
- Do not add tests for pointless negatives or generic paths: unknown action
  rejection, obsolete names staying removed, deleted controls not existing,
  exact source text, or implementation-shape details unless behavior cannot be
  exercised directly.
- Before adding a new test, be able to state the failure it would catch. If the
  answer is just "proves I changed it" or "guards against someone reverting this
  exact cleanup," do not add the test.

## Deployment

The current deployment target is Render Free:
`https://bar-hanabi.onrender.com/`.

- Service type: Web Service
- Repository: `atfinke/BarHanabi`
- Branch: `main`
- Build command: `npm install`
- Start command: `npm start`
- Auto-deploy: On commit to `main`
- Free instances sleep after inactivity; deploys and restarts wipe active rooms.
