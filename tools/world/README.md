# tools/world — a 30-account world on one machine

The shell is for groups, but everything social in it — petnames, vouches and
tribes, attestations, co-signing — had only ever been exercised by tests that
mint a key, use it once and throw it away. This builds a standing world of 30
named accounts so you can *look* at a contract with four real signatories, or a
tribe two hops deep, in the actual app.

```
pnpm world provision     # 30 accounts (identity files + roster)
pnpm world seed          # build the scenario across them
pnpm world ls            # the roster, addresses, how much each holds
pnpm world show ada      # one account: its tribe and its feed
pnpm world open ada      # the real GUI, on Ada's library
pnpm world live ada grace   # several instances at once
pnpm world magnet        # seed on one instance, fetch it on another
pnpm world relay         # post on one; receive it on another, unasked
pnpm world forum         # the same forum, ranked in two libraries
pnpm world reset         # delete world/
```

`magnet` and `relay` are the two-machine tests, on one machine: two real
instances, two real keys, two real libraries, and bytes actually moving between
them. `relay` starts a local relay in-process by default, so it works offline;
`--relay wss://…` points it at a real one.

`forum` is the one to run if you only run one. It prints the same forum as two
different accounts see it — identical bytes, different order, because each
library weights the same votes by whose vouches reach the voter. Ada's top post
is the investigation three of her own people voted up; the listicle four
strangers pushed sits **last** for her, because one person she vouched for voted
against it. Linus, who has vouched for nobody on the desk, sees the listicle
first. `--forum tenants` picks the other one.

## What the seeded world holds

Two forums, so "which communities am I in" is a real question:

- **Meridian Press — the wire.** Ada keeps it, Grace moderates. Five posts: an
  investigation with headings and a footnote, a photo essay with an actual
  photograph wrapped in the text, a listicle, spam, and an oversize plate set.
  A four-deep argument runs under the investigation, with votes on the
  *comments* as well as the posts, so a thread has an order too. Grace has
  hidden one post and endorsed another — both verdicts, so neither path is
  theoretical. Kestrel, a stranger, has asked to join and is still pending,
  because the roster is what decides.
- **Vale Street tenants.** A different keeper, a different moderator, and a
  roster Ada is on but the press desk mostly is not.

The plate set is over the relay's 32 KiB inline cap, so Linus — who reads the
wire from outside — holds it as an **offer** rather than a post: a stub saying
it exists, with Fetch beside it. Pressing Fetch resolves, which is the whole
pointer path in miniature. (Staged: the bytes sit in his seed store and the
locator is `bundle:`, so it works with no swarm. Over a real relay it would be
a magnet.)

Images are **generated, not committed** (`tools/world/image.ts`): a binary blob
in the repo is a thing nobody reviews and everybody carries.

## Why it is cheap

`world/accounts/<slug>/` **is** a real `SHELL_USER_DATA_DIR` — the same
`identity.key.enc`, `library/` and `seeds/` the app writes — so there is no
conversion step between what this builds and what the GUI opens.

Thirty Electron GUIs are not needed to build one. The harness runs under
`ELECTRON_RUN_AS_NODE`, which gives Electron's native ABI (needed:
`better-sqlite3` is built against it) with no browser, no window and no X
server, so one process holds all thirty libraries. That works because the
modules it borrows were already kept clean — `library/` and `main/store.ts`
import no Electron, and `keyring/hd.ts` says outright that it "must stay pure".

Two things do want real Electron. `AdmissionService` runs its decode in a
`utilityProcess`; the harness calls `admitBundle` from `src/format` instead,
which is the same gate `main.ts` uses directly in `signAndAdmit`. And anything
with a window is the job of `pnpm world open`.

**No production code changed for this.** The harness reuses shipped modules;
outside `tools/` it added a `.gitignore` line, one `package.json` script, and
`tools/**` in the typecheck include.

## What it signs with

Each account's bundles are signed by `Keyring.load(dir).signer` — the product's
own signer, loaded from the identity file the app reads — not a signer
reimplemented here. A bundle this makes is a bundle the shell could have made.

## The scenario

- **Vale Street lease** — landlord, tenant, two witnesses, all four signed.
- **Consultancy agreement** — 2 of 4. Unsigned is not half-valid, and the
  chrome's wording says so.
- **Deed of variation** — 2 of 2, *plus one signature the document never asked
  for*, shown rather than hidden.
- **Harbour Yard article** — five attestations, three of them inside Ada's
  tribe: the count is free to manufacture, the tribe half is not.
- **A vouch graph with real shape** — from Ada, four keys at one hop and seven
  at two; three-hop keys fall outside the cap; one cluster reaches her not at
  all, so strangers correctly show no badge.
- Nametags, a memo and a poster, so feeds are not one contract and a void.

## The mnemonic

`roster.ts` holds a **hardcoded dev phrase**. It is not a secret, `world/` is
gitignored, and every key it derives is written in software mode. It exists so
`reset` + `provision` rebuilds byte-identical addresses — a note saying "the
contract Ada drafted" keeps meaning the same thing. Never put value here.

## Two rules

**One writer per library.** A live instance takes a lockfile; offline commands
refuse while it is held, because two writers on one SQLite file is a corruption
risk and a running GUI would not hear about the write anyway. A lock whose
owning process is gone is recognised as stale and cleared automatically.

**The OS sandbox is not switched off quietly.** `open`/`live` check Chromium's
SUID helper first. If it is not root-owned and setuid they print both remedies —
the `sudo` fix, or an explicit `--no-sandbox` — and refuse until you pick one.
Running with Layer 1 off prints a notice every time, in the same register as the
cage suite's `CAGE_ALLOW_NO_SANDBOX`.
