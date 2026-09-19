# Testing

| Suite | Command | What it is |
|---|---|---|
| Unit | `pnpm test:unit` | Vitest: pure logic (draft validation, protocol handler, naming, HD keys, hardening flags, the dependency boundary) plus the format tests and one test per [conformance vector](../protocol/conformance.md). About a second. |
| End to end | `pnpm test:cage` | Builds, then drives the **real app** through Playwright: the escape battery (`test/cage.spec.ts`) and the client specs (`test/shell/*.spec.ts`). Several minutes. |
| Types | `pnpm typecheck` | Both TypeScript projects. |

CI (`.github/workflows/test.yml`) runs typecheck and unit tests on Linux, and the
end-to-end run on **Linux, macOS and Windows** for every push and pull request.

`pnpm test:cage` is cross-platform: a small launcher (`scripts/run-cage-tests.mjs`)
wraps the run in `xvfb-run` only on headless Linux. Run a subset by passing paths:

```bash
pnpm build && node scripts/run-cage-tests.mjs test/shell/forum.spec.ts
```

The run ends with a wall — one line per attack, all green when the container holds —
then `CAGE HOLDS n/n attempts blocked`, followed by the measured OS-sandbox state
([why that qualifier is there](../architecture/security.md)).

## How egress is verified

Each hostile page receives the canary's addresses through the legitimate bridge
(`getArgs().args.canary`) and tries to beacon to them. The suite asserts from the
**main process** and from the **canary listener** — both outside the renderer — that
nothing arrived: not a TCP socket, HTTP request, WebSocket upgrade or UDP datagram.
The page's own error callbacks are secondary evidence; the canary's silence is the
proof.

## Adding an attack

1. **Add the hostile page**, `test/things/<attack>.html`: a self-contained inline
   script that runs the attack on load and reports over the bridge.

   ```html
   <script>
     const canary = ((window.bridge.getArgs() || {}).args || {}).canary || {};
     const r = { attack: 'my-attack' };
     try { /* …attempt the escape… */ } catch (e) { r.error = String(e); }
     // Always emit a final 'done' so the test can await it, even on failure.
     setTimeout(() => window.bridge.emit('done', r), 800);
   </script>
   ```

   The script runs in `<head>` during parse, so `document.body` may be null — append
   to `document.documentElement` if you need the DOM.

2. **Add the assertion** in `test/cage.spec.ts`:

   ```ts
   test('my attack is blocked', async ({ open, canary }) => {
     const cage = await open({ thing: 'my-attack.html' })
     const r = await cage.waitForEmit('done')
     expect(/* the attack did not succeed */).toBe(true)
     expect(canary.silent()).toBe(true) // nothing left the process
   })
   ```

   For escalation checks, read the main-process event log with `cage.events()` and
   assert the relevant `blocked-request` / `navigation-blocked` /
   `window-open-denied` / `permission-denied` entry.

3. **Ask how it could pass for the wrong reason.** A test that would stay green if
   the attack *succeeded silently* is worse than no test. Prefer assertions observed
   from outside the page.

## Client specs

Every spec launches the app against its own throwaway profile
(`SHELL_USER_DATA_DIR`), so nothing leaks between tests or from your own install.
`test/shell/helpers.ts` has the launch fixture, an in-process Nostr relay
(`relay-server.ts`), and builders for signed, sealed and deliberately broken bundles.

Things the specs pin that are easy to regress: nothing is posted to a relay unasked;
nothing is fetched unasked; a relayer is never shown as an author; sealed plaintext
never reaches disk; the private key never reaches disk; a tribe-weighted order never
degrades to a raw one without saying so.
