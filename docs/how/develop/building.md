# Building from source

Requirements: Node 22, [pnpm](https://pnpm.io), and a C++ toolchain (one native
module, `better-sqlite3`, is compiled at install).

```bash
git clone https://github.com/souspli/souspli.git
cd souspli
pnpm install
pnpm dev            # launch Souspli with hot reload
```

| Command | Does |
|---|---|
| `pnpm dev` | Launch the app with HMR (electron-vite dev server). |
| `pnpm build` | Compile main / preload / renderer into `out/`. |
| `pnpm start` | Launch the built app from `out/`. |
| `pnpm dev:cage` | Launch the bare container harness: one benign letter in a cage, no client. |
| `pnpm typecheck` | Both TypeScript projects. |
| `pnpm test:unit` | Fast pure-logic tests (Vitest). |
| `pnpm test:cage` | Build, then the full Playwright run: escape battery + client specs. |
| `pnpm world …` | The [30-account world](world.md). |
| `pnpm gen:vectors` | Regenerate [conformance vectors](../protocol/conformance.md). |
| `pnpm dist` | Installers for the current platform → `release/`. |

## Toolchain notes

- **Windows:** install the Visual Studio Build Tools (VC++ workload) *before*
  `pnpm install`:
  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```
- **macOS:** Xcode Command Line Tools. **Linux:** `build-essential`, `python3`.
- Packaged installers ship the compiled module; end users need none of this.
- `better-sqlite3` must match Electron's ABI, not Node's. `postinstall` runs
  `pnpm rebuild:native`; run it by hand if you see a module-version error.
- The build emits CommonJS for the main and preload scripts on purpose (see
  `electron.vite.config.ts`).

## Linux: the OS sandbox on dev machines and CI

On a normal Linux desktop Chromium's sandbox initialises by itself. In a locked-down
container (unprivileged user namespaces disabled by AppArmor, setuid helper not
root-owned) Electron aborts on launch. Either enable it once:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
# or make the setuid helper root-owned:
# sudo chown root:root node_modules/electron/dist/chrome-sandbox
# sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

or, for a throwaway dev container, `pnpm dev:nosandbox`
(`ELECTRON_DISABLE_SANDBOX=1`, read by the binary before any JavaScript runs). That
turns the OS process sandbox **off** — a dev-only accommodation; every other layer
still applies. Headless: `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a pnpm start`.

What this does and does not affect is explained on the
[security page](../architecture/security.md).

## Packaging

`electron-builder` (`electron-builder.yml`) packages the app.

```bash
pnpm dist          # current platform → release/
pnpm dist:linux    # AppImage + deb
pnpm dist:mac      # dmg + zip   (must run on macOS)
pnpm dist:win      # nsis .exe   (best run on Windows)
pnpm pack:dir      # unpacked app, no installer — quick local check
```

Cross-platform builds happen in CI: pushing a `v*` tag runs
`.github/workflows/release.yml` on macOS, Windows and Linux runners and drafts a
GitHub Release with the installers attached.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Builds are currently **unsigned**. To sign, provide an Apple Developer ID with
notarisation credentials and a Windows code-signing certificate as CI secrets;
electron-builder reads them from the environment.

`appId` (`org.souspli.app`) is the update and signing identity. Do not change it.

## Environment variables

| Variable | Effect |
|---|---|
| `SHELL_USER_DATA_DIR` | Use this directory as the whole profile. |
| `SHELL_ALLOW_MULTI=1` | Skip the single-instance lock (several profiles at once). |
| `SHELL_SCALE` | Force the device scale factor (Linux defaults to 2). |
| `SHELL_FORCE_SOFTWARE_KEYS=1` | Ignore the OS keychain. |
| `SHELL_TORRENT_OFFLINE=1` | No DHT, trackers or local discovery. |
| `SHELL_ENS_RPC` | Ethereum RPC endpoint for ENS (requires `viem`, which is not a dependency). |

The `SHELL_` prefix is the code's name for the client; see the
[glossary](../../glossary.md).
