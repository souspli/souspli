import welcomeB64 from './welcome.thing.b64?raw'

// ── The welcome letter ───────────────────────────────────────────────────────
//
// A new install used to open onto an empty window. It now opens onto a real
// letter, so the first thing anyone learns is what the trust header looks like
// over something signed.
//
// It gets no special treatment: it is ordinary bundle bytes handed to the same
// admission gate as a file from a stranger, and if it did not verify it would
// be refused like one. It is signed by a key that was generated for this one
// letter and never stored (tools/welcome/make.ts), so there is no project key
// anywhere to protect, and the header truthfully shows an unknown address.
//
// Base64 text rather than a binary so it travels through the bundler the same
// way the starters do (`?raw`) and stays reviewable as a diff of one file.

/** Library meta flag: set once the first-run offer has been made, whether or
 *  not the letter was admitted, so deleting it is final. */
export const WELCOME_FLAG = 'welcome_v1'

export function welcomeBundle(): Uint8Array {
  return new Uint8Array(Buffer.from(welcomeB64.replace(/\s+/g, ''), 'base64'))
}
