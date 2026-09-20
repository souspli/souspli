// Pure: no sqlite, no Electron -- so it is unit-tested directly, and so the tools
// that vet a roster (tools/welcome/forum.ts) read a key EXACTLY as the app does
// rather than by an imitation of it.

/** A key as a person writes one into a roster, a contract or a vouch.
 *
 *  The app DISPLAYS an address as `0xD879…5632`, so that is what people paste --
 *  and this used to accept bare lowercase hex only and drop everything else as
 *  "junk", silently. The keeper of the welcome forum listed themselves as its
 *  moderator that way, and the app ignored them: not a member, not a moderator,
 *  no Hide/Endorse on their own forum, and nothing anywhere saying why. The
 *  world harness writes bare hex, so no test had ever typed a key the way a
 *  human does.
 *
 *  So: an optional 0x prefix and any letter case are the same key. Anything that
 *  is still not plausible hex of a sane length is program data, and is ignored. */
export function claimedKey(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/^0x/, '')
  return /^[0-9a-f]{40,64}$/.test(key) ? key : null
}
