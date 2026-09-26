# Contributing to Souspli

Thank you for looking. The project is an alpha with a small surface and strong
opinions; this page is the short version of both.

## Before you write code

- **Bugs:** open an issue with what you did, what you expected and what happened.
  For anything security-relevant, do **not** open an issue — see
  [SECURITY.md](SECURITY.md).
- **Features:** open an issue first. Many obvious features are absent on purpose
  (no global feed, no reputation score, no read receipts, no automatic fetching);
  the [roadmap](docs/next/roadmap.md) says which and why.
- **Format changes:** the [specification](docs/how/protocol/spec.md) is a draft and
  can change, but any change must come with updated
  [conformance vectors](docs/how/protocol/conformance.md).

## Ground rules of the codebase

1. **The container trusts nothing and knows nothing.** `src/main` and `src/preload`
   must not import from `src/shell` or `src/format`. CI enforces this.
2. **Admission is the only gate.** A new transport, relay or resolver adds reach,
   never authority. It hands over bytes; it decides nothing.
3. **Nothing touches the network unless a person asked,** and the interface says
   what it will reveal *before* it happens. No prefetching, no retries that fetch,
   no telemetry.
4. **Trust signals live in the header.** Never give a letter's program a way to
   learn or display who signed it.
5. **Claims are labelled as claims.** `created`, `type`, `replyTo`, `inGroup`, a
   roster entry, a named signatory: all of them are an author's say-so, and the
   interface must not present them as facts. ✓ is reserved for verification.
6. **No scores.** Show who, and how they relate to the reader — not a number.
7. **Do not edit `samples/*.html` casually.** A type is identified by the hash of its
   program; changing a byte creates a new type and orphans the old one's label.
8. **The bridge is four functions.** Adding a fifth needs a very good reason and a
   design note.

## Workflow

```bash
pnpm install
pnpm typecheck
pnpm test:unit          # ~1 s
pnpm test:cage          # full end-to-end run, several minutes
```

- Branch from `master`; open a pull request; CI runs on Linux, macOS and Windows.
- A change to behaviour comes with a test. For the container, that means a new
  hostile page — see [Testing](docs/how/develop/testing.md) — and a moment's thought
  about how the test could pass for the wrong reason.
- A change to what the app reveals, stores or sends updates
  [What leaks when](docs/use/privacy.md) in the same pull request. A change to what
  works updates [Status](docs/use/status.md).
- Match the surrounding code: its comment density, naming and idiom. Comments here
  explain *why*, and often record the mistake that led to the current design. Keep
  doing that.
- Write commit messages and pull request descriptions for a reader who was not
  there.
- Dependencies wait a week. No version younger than 7 days is installed:
  `minimumReleaseAge` in `pnpm-workspace.yaml` enforces it for the app (on every
  install, lockfile included), and `min-release-age` in `relay/.npmrc` and
  `site/.npmrc` for those two, which needs npm 11 or later to take effect. If a
  security fix can't wait, exclude that one package with
  `minimumReleaseAgeExclude` and say why in the pull request.

Docs use the public vocabulary (*letter*, *type*, *Souspli*); code keeps its own
(*thing*, *program*, *shell*, *cage*). The [glossary](docs/glossary.md) maps them.

## Licence

By contributing you agree that your contribution is licensed under
[Apache-2.0](LICENSE), the licence of the project.
