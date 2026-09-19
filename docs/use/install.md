# Install

Souspli runs on macOS, Windows and Linux.

## Download

Installers are attached to each release at
**[github.com/souspli/souspli/releases](https://github.com/souspli/souspli/releases)**:

| Platform | File |
|---|---|
| macOS | `Souspli-<version>-mac-<arch>.dmg` |
| Windows | `Souspli-<version>-win-x64.exe` |
| Linux | `Souspli-<version>-linux-<arch>.AppImage`, or the `.deb` |

If no release is listed yet, [build it from source](../how/develop/building.md) — it
is three commands.

## Alpha builds are unsigned

Until the project's code-signing certificates are in place, your operating system
will warn you the first time:

- **macOS** — right-click the app → **Open**, or run
  `xattr -dr com.apple.quarantine "/Applications/Souspli.app"`.
- **Windows** — SmartScreen: **More info → Run anyway**.
- **Linux** — `chmod +x Souspli-*.AppImage`, then run it; or install the `.deb`.

There is no auto-update yet. Check the releases page for new versions.

## First run

Souspli shows a notice headed **⚠ Experimental alpha** and asks you to acknowledge
it. Read it; it is short and it is true:

- Your identity key is created on first launch and stored on your machine —
  protected by your operating system's keychain where one is available, and by a
  weaker software scheme where it is not. The badge in the top bar tells you which.
- Do not use this identity for anything valuable, and do not put anything in a
  letter that you could not bear to leak. **A signed letter is public and permanent
  once shared.**

Then you are looking at an empty library. [Write your first letter](first-letter.md),
or open a `.thing` file somebody sent you.

## Where your data lives

| | |
|---|---|
| macOS | `~/Library/Application Support/Souspli` |
| Windows | `%APPDATA%\Souspli` |
| Linux | `~/.config/Souspli` |

That directory holds your encrypted identity file, the library index, the
content-addressed blob store and the bundles you are able to re-serve. Deleting it
deletes your identity. [Back up your key first](identity.md).
