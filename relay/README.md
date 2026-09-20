# relay/ — relay.souspli.org

A small [Nostr](https://github.com/nostr-protocol/nips) relay for Souspli letters,
on Cloudflare Workers with one Durable Object. It is what makes a forum possible:
every other way a letter travels needs someone to hand it to you, and a relay is how
one reaches a person who never asked for it.

It is a **standalone package**, outside the repo's pnpm workspace, so deploying it
never installs the desktop app.

## What it is, and is not

- It carries **one kind of event** — a Souspli letter, [kind 3400](../docs/how/protocol/relay-event.md)
  — and the slice of NIP-01 that needs: `EVENT` / `REQ` / `CLOSE` in,
  `EVENT` / `EOSE` / `OK` / `CLOSED` / `NOTICE` out. NIP-11 at `GET /`.
- It **adds reach, never authority.** It checks that an event is well-formed, is the
  kind it carries, and is really signed by the key it names. It does **not** look
  inside the letter: whether the bundle is any good is each reader's admission gate's
  business, and a relay that claimed to have checked would be inviting clients to
  trust it.
- It is **not where letters are kept.** It retains the newest `MAX_EVENTS`; a letter
  lives in its readers' libraries.

## Policy

| | |
|---|---|
| Kinds | 3400 only |
| Content | ≤ `MAX_CONTENT_BYTES` (45 KB: the app's 32 KiB inline cap, base64'd). Bigger letters are posted as a **pointer** (`thing-fetch`). |
| Required tags | `["t","thing"]` and `["x",<envelope hash>]`; a bundle **or** a pointer |
| `created_at` | not more than an hour in the future (a far-future date would deafen readers that follow a cursor) |
| Rate | `EVENTS_PER_PUBKEY_PER_HOUR` (60) and `EVENTS_PER_IP_PER_HOUR` (120) |
| Blocking | `BLOCKED_PUBKEYS`, comma-separated hex keys — the operator's only moderation lever |
| Subscriptions | 4 per connection, 4 filters each; stored events are sent **oldest first**, newest `limit` (≤ 1000) |

Moderation of *content* does not happen here. A forum's moderators sign verdicts that
readers honour or not; the relay's job is to bound what it costs to be offered junk.

All of the above are `vars` in `wrangler.jsonc` — change them in the Cloudflare
dashboard without a deploy.

## What it learns about people

A relay necessarily sees the address of whoever connects, and what they subscribe to
and post. This one is built to keep as little of that as it can:

- The address is used **only** to rate-limit. It is hashed together with the current
  hour, kept for at most two hours, and **never stored next to an event**: the relay
  does not record who posted from where.
- Request logging (`observability`) is **off** in `wrangler.jsonc`, on purpose.
- Events are stored exactly as signed — the seven NIP-01 fields, nothing added.

Cloudflare itself, as the host, sees connections. The app says all of this to a
person before they add the relay.

## Develop and test

```bash
cd relay
npm ci
npm test                  # the pure core: what an event is, the policy, filters
npm run test:integration  # the REAL Worker + Durable Object in workerd, over WebSockets
npm run dev               # ws://127.0.0.1:8787
```

The whole app against it, two real instances and a letter moving between them:

```bash
npm run dev -- --port 8797            # in relay/
pnpm world relay --from alan --to grace --relay ws://127.0.0.1:8797   # in the repo root
```

## Deploy

**Once, from the Cloudflare dashboard** (the same way the site is deployed — no
credentials leave your browser):

1. **Workers & Pages → Create → Workers → Import a repository** → `souspli/souspli`.
2. Name the Worker **`souspli-relay`** — the `name` in `wrangler.jsonc`. (A different
   name works, but the dashboard will warn until the two agree, and offers a PR to
   sync them.)
3. Build settings:

   | | |
   |---|---|
   | Root directory | `relay` (no leading slash) |
   | Build command | *(empty)* |
   | Deploy command | `npm ci && npx wrangler deploy` |
   | Build variable | `SKIP_DEPENDENCY_INSTALL` = `1` |

   The variable matters. This package is npm, but it lives in a repository whose
   root is a **pnpm** project, so Cloudflare's automatic step runs `pnpm install`
   here, walks up to the root `pnpm-workspace.yaml` — which pnpm 11 uses for
   settings only — and fails with *"packages field missing or empty"*. Skipping the
   automatic install and running `npm ci` ourselves avoids that, and guarantees the
   desktop app's dependencies are never installed to deploy a relay.
4. Save and deploy. The first deploy creates the Durable Object (migration `v1`) and,
   because `wrangler.jsonc` declares `relay.souspli.org` as a custom domain on a zone
   this account already holds, the DNS record and certificate too.

The directory must exist on the branch Cloudflare builds (`master`): *"root directory
not found"* means it is building a commit from before `relay/` was merged.

After that every push to `master` that touches `relay/` redeploys it.

**Or from a terminal:** `npx wrangler login`, then `npm run deploy`.

**Check it:**

```bash
curl -s -H 'Accept: application/nostr+json' https://relay.souspli.org/ | head -c 200
pnpm world relay --from alan --to grace --relay wss://relay.souspli.org
```

Durable Objects with SQLite storage are available on the Workers **free** plan; at
this project's scale the relay should cost nothing. Hibernating WebSockets mean idle
connections do not keep the object in memory.
