import { secp256k1 } from '@noble/curves/secp256k1.js'

// ── Who a private letter is for ──────────────────────────────────────────────
//
// A sealed letter is sealed to x-only encryption keys (§7). A person can be
// named three ways in the New dialog, and they are not equally good:
//
//   0x address  an AUTHOR key. It cannot be turned into an encryption key, so
//               the shell looks for one they bound to a letter of theirs you
//               hold (Author.ek, signed by them). The best of the three.
//   npub1…      an encryption key in nostr's spelling.
//   64 hex      the same, raw.
//
// The last two are only what you were told: nothing proves whose they are.
// They are checked to be points on the curve, so a typo is refused rather than
// sealed to a key nobody holds.

export type ParsedRecipient =
  | { kind: 'enc'; ek: string }
  | { kind: 'author'; scheme: string; key: string }
  | { kind: 'error'; reason: string }

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!
  }
  return chk
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (const c of hrp) out.push(c.charCodeAt(0) >>> 5)
  out.push(0)
  for (const c of hrp) out.push(c.charCodeAt(0) & 31)
  return out
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0
  let bits = 0
  const out: number[] = []
  const maxv = (1 << to) - 1
  for (const v of data) {
    if (v < 0 || v >> from !== 0) return null
    acc = (acc << from) | v
    bits += from
    while (bits >= to) {
      bits -= to
      out.push((acc >>> bits) & maxv)
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv)
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null
  }
  return out
}

/** BIP-173 bech32 (not bech32m: NIP-19 uses the original). */
export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convertBits([...bytes], 8, 5, true)!
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]
  const mod = polymod(values) ^ 1
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31)
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join('')}`
}

export function bech32Decode(text: string): { hrp: string; bytes: Uint8Array } | null {
  if (text.length > 90 || (text !== text.toLowerCase() && text !== text.toUpperCase())) return null
  const s = text.toLowerCase()
  const sep = s.lastIndexOf('1')
  if (sep < 1 || sep + 7 > s.length) return null
  const hrp = s.slice(0, sep)
  const data: number[] = []
  for (const c of s.slice(sep + 1)) {
    const d = CHARSET.indexOf(c)
    if (d === -1) return null
    data.push(d)
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null
  const bytes = convertBits(data.slice(0, -6), 5, 8, false)
  return bytes ? { hrp, bytes: Uint8Array.from(bytes) } : null
}

const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

/** Is this 64-hex string the x coordinate of a point on secp256k1? */
export function isXOnlyKey(hex: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(hex)) return false
  try {
    secp256k1.Point.fromHex(`02${hex}`)
    return true
  } catch {
    return false
  }
}

export function npubOf(ekHex: string): string {
  return bech32Encode('npub', Uint8Array.from(ekHex.match(/../g)!.map((h) => parseInt(h, 16))))
}

/** Read what was typed into the To box. Never resolves an address: that
 *  needs the library, and is the caller's job. */
export function parseRecipient(input: string): ParsedRecipient {
  const t = input.trim()
  if (/^npub1/i.test(t)) {
    const d = bech32Decode(t)
    if (!d || d.hrp !== 'npub') return { kind: 'error', reason: 'That npub is mistyped: its checksum does not match.' }
    if (d.bytes.length !== 32) return { kind: 'error', reason: 'That npub is not 32 bytes.' }
    const ek = toHex(d.bytes)
    if (!isXOnlyKey(ek)) return { kind: 'error', reason: 'That npub is not a valid key.' }
    return { kind: 'enc', ek }
  }
  if (/^[0-9a-f]{64}$/i.test(t)) {
    const ek = t.toLowerCase()
    if (!isXOnlyKey(ek)) return { kind: 'error', reason: 'That is not a valid encryption key (not a point on the curve).' }
    return { kind: 'enc', ek }
  }
  if (/^(0x)?[0-9a-f]{40}$/i.test(t)) return { kind: 'author', scheme: 'eth-eip191', key: t.replace(/^0x/i, '').toLowerCase() }
  return { kind: 'error', reason: 'Enter an address (0x…), an npub, or a 64-character key.' }
}
