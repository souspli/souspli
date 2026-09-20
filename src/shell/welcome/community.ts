import forumB64 from './forum.thing.b64?raw'

// ── Somewhere to go ──────────────────────────────────────────────────────────
//
// A new install opens onto a welcome letter, and then there is nobody to talk
// to: the relay list is empty by design, and no community is suggested. This is
// the suggestion -- and ONLY a suggestion. Nothing here is connected to, fetched
// or admitted until a person reads what it costs and says yes (see the chrome's
// community dialog). "The relay list starts empty" stays true.
//
// Two parts, either of which can exist without the other:
//
//   · the project's relay, which is an address;
//   · the welcome forum, which is a `group` letter -- a roster whose keeper is
//     a real, living key, because a forum needs someone who can name moderators
//     and admit members. That is the opposite of the welcome LETTER, whose key
//     was thrown away on purpose. So the forum letter is made by its keeper in
//     the app and dropped in here (forum.thing.b64) by `pnpm welcome:forum`,
//     which checks it; an empty file means no forum, and the offer is then the
//     relay alone. test/unit/welcome-forum.test.ts holds whatever is bundled to
//     the same terms, and pins its hash -- the forum's permanent identity.
//
// Like the welcome letter, the forum is ordinary bytes handed to the ordinary
// admission gate. Bundled is not trusted.

/** Overridable so specs can point at a relay running inside the test process,
 *  and so a fork of the project can point at its own. */
export const suggestedRelay = (): string => process.env.SHELL_SUGGESTED_RELAY?.trim() || 'wss://relay.souspli.org'

/** The welcome forum's group letter, or null while nobody has made one. */
export function welcomeForumBundle(): Uint8Array | null {
  const b64 = (process.env.SHELL_WELCOME_FORUM_B64 ?? forumB64).replace(/\s+/g, '')
  return b64.length === 0 ? null : new Uint8Array(Buffer.from(b64, 'base64'))
}
