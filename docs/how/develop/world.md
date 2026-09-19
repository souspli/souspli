# A 30-account world on one machine

Souspli is for groups, but a test that mints a key, uses it once and throws it away
never lets you *look* at a contract with four real signatories or a tribe two hops
deep. `tools/world/` builds a standing world of 30 named accounts and seeds a
scenario across them, using the app's own modules and signer — a bundle this makes
is a bundle the app could have made.

```bash
pnpm world provision        # 30 accounts (identity files + roster)
pnpm world seed             # build the scenario across them
pnpm world ls               # the roster, addresses, how much each holds
pnpm world show ada         # one account: its tribe and its feed
pnpm world open ada         # the real app, on Ada's library
pnpm world live ada grace   # several instances at once
pnpm world forum            # the same forum, ranked in two libraries
pnpm world relay            # post on one instance; receive it on another, unasked
pnpm world magnet           # seed on one instance, fetch it on another
pnpm world reset            # delete world/
```

**`pnpm world forum` is the one to run if you only run one.** It prints the same
forum as two different accounts see it — identical letters, different order, because
each library weights the same votes by whose vouches reach the voter. Ada's top post
is the investigation three of her own people voted up; the listicle four strangers
pushed sits last for her. Linus, who has vouched for nobody, sees the listicle first.

That is also the best two-minute demonstration of what Souspli is *for*.

`relay` and `magnet` are two-machine tests on one machine: two real instances, two
keys, two libraries, bytes actually moving. `relay` starts a local relay in-process,
so it works offline; `--relay wss://…` points it at a real one.

## What the seeded world holds

- **Two forums with different keepers and moderators**, a four-deep argument with
  votes on comments as well as posts, one hidden post and one endorsed, a pending
  join request, and a post too large to travel inline — so one reader holds it as an
  *offer* with **Fetch** beside it.
- **Contracts:** a lease with all four signatures; a consultancy agreement at 2 of 4;
  a deed with 2 of 2 *plus one signature the document never asked for*.
- **An article with five attestations**, three of them inside Ada's tribe.
- **A vouch graph with real shape:** from Ada, four keys at one hop and seven at two;
  three-hop keys fall outside; one cluster does not reach her at all.
- Essays, memos, posters and name tags so feeds are not one contract and a void. The
  essays are pastiche and say so in their `rights` line.

## Rules of the harness

- `world/accounts/<name>/` **is** a real profile directory — the same files the app
  writes — so there is no conversion between what this builds and what the app opens.
- It runs under `ELECTRON_RUN_AS_NODE`: Electron's native ABI (for SQLite) with no
  window, so one process holds all thirty libraries.
- **One writer per library.** A live instance takes a lockfile; offline commands
  refuse while it is held.
- **The OS sandbox is never switched off quietly.** `open` and `live` check the
  setuid helper first and refuse until you either fix it or pass `--no-sandbox`
  explicitly.
- The mnemonic in `roster.ts` is a hardcoded **development phrase**, so `reset` +
  `provision` gives byte-identical addresses. It is not a secret. Never put value
  there.
- Images are generated, not committed.

Details: [`tools/world/README.md`](../../../tools/world/README.md).
