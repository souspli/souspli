import { X509Certificate, constants, createHash, createPublicKey, publicDecrypt, timingSafeEqual, verify, type KeyObject } from 'node:crypto'
import { DerError, children, int, octets, oid, readOne, seq, type DerNode } from './der.js'

// ── Passport verification (ICAO 9303 passive authentication, plus the chip's
//    signature over the author's key) ────────────────────────────────────────
//
// A `passport` letter carries the files read from a passport chip. This module
// answers one question for the trusted header: are these the genuine, unaltered
// data of a passport issued by a state whose signing certificate we hold — and
// did that passport's chip sign THIS letter's author key?
//
// The chain, each link checked here with nothing fetched:
//
//   bundled CSCA certificate ── signs ──▶ document signer certificate (in the SOD)
//   document signer          ── signs ──▶ the SOD's signed attributes
//   signed attributes        ── hash  ──▶ the security object (a list of hashes)
//   security object          ── hash  ──▶ DG1 (the identity data) and DG15 (the chip's key)
//   chip key (DG15)          ── signs ──▶ a challenge derived from the author's address
//
// Pure: bytes in, a verdict out. It parses hostile input, so the shell runs it
// in the credential worker, never in the process that holds keys.

export interface PassportInput {
  /** EF.DG1 as read from the chip (tag 61). */
  dg1: Uint8Array
  /** EF.SOD as read from the chip (tag 77). */
  sod: Uint8Array
  /** EF.DG15, the chip's Active Authentication public key (tag 6F). */
  dg15?: Uint8Array
  /** The chip's Active Authentication response to the author-derived challenge. */
  aaResponse?: Uint8Array
}

export interface TrustAnchor {
  /** What the header calls it, e.g. "Canada CSCA 2017". */
  name: string
  der: Uint8Array
}

export interface PassportFacts {
  documentType: string
  issuingState: string
  nationality: string
  surname: string
  givenNames: string
  documentNumber: string
  /** YYMMDD, as the chip has it. The century is not recorded. */
  dateOfBirth: string
  /** YYMMDD. */
  dateOfExpiry: string
  sex: string
  /** Past its expiry date by this machine's clock. */
  expired: boolean
  /** Which bundled certificate the document signer chains to. */
  anchor: string
  /**
   * Whether the chip signed the author's key.
   *  - `signed`: it did. The author held the physical passport.
   *  - `absent`: the letter carries no chip signature. Anyone holding a copy of
   *     these files could have published them.
   *  - `unsupported`: there is one, of a kind this version cannot check.
   */
  chip: 'signed' | 'absent' | 'unsupported'
}

export type PassportResult =
  | { status: 'verified'; facts: PassportFacts }
  /** The data contradicts itself or a signature fails: not a genuine reading for this author. */
  | { status: 'invalid'; reason: string }
  /** Nothing is wrong that we can see, but we cannot vouch for it (no certificate for this state, an unsupported algorithm). */
  | { status: 'unverifiable'; reason: string }

/** Domain separation for the challenge the chip signs. Shared with the reader app. */
export const BIND_DOMAIN = 'souspli-passport-bind-v1:'

/** The 8-byte Active Authentication challenge that binds a passport to a 20-byte address. */
export function bindChallenge(address: Uint8Array): Uint8Array {
  if (address.length !== 20) throw new Error('address must be 20 bytes')
  return createHash('sha256').update(BIND_DOMAIN, 'ascii').update(address).digest().subarray(0, 8)
}

const HASH_BY_OID: Record<string, string> = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.4': 'sha224',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512'
}
const RSA_PKCS1_BY_OID: Record<string, string | null> = {
  '1.2.840.113549.1.1.1': null, // rsaEncryption: the hash is the signer's digest algorithm
  '1.2.840.113549.1.1.5': 'sha1',
  '1.2.840.113549.1.1.14': 'sha224',
  '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512'
}
const ECDSA_BY_OID: Record<string, string> = {
  '1.2.840.10045.4.1': 'sha1',
  '1.2.840.10045.4.3.1': 'sha224',
  '1.2.840.10045.4.3.2': 'sha256',
  '1.2.840.10045.4.3.3': 'sha384',
  '1.2.840.10045.4.3.4': 'sha512'
}
const OID_RSA_PSS = '1.2.840.113549.1.1.10'
const OID_MGF1 = '1.2.840.113549.1.1.8'
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
/** ISO 9796-2 two-byte trailers: the hash identifier that precedes 0xCC. */
const ISO9796_HASH: Record<number, string> = { 0x33: 'sha1', 0x38: 'sha224', 0x34: 'sha256', 0x36: 'sha384', 0x35: 'sha512' }

/** Thrown for "we cannot check this", as opposed to "this is wrong". */
class Unsupported extends Error {}
class Invalid extends Error {}

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && timingSafeEqual(a, b)

function hashName(algorithmIdentifier: DerNode | undefined): string {
  const id = oid(seq(algorithmIdentifier)[0])
  const name = HASH_BY_OID[id]
  if (!name) throw new Unsupported(`hash algorithm ${id}`)
  return name
}

/** Verify `signature` over `data` as the AlgorithmIdentifier `sigAlg` describes. */
function verifySignature(sigAlg: DerNode, digest: string, key: KeyObject, data: Uint8Array, signature: Uint8Array): boolean {
  const parts = seq(sigAlg)
  const id = oid(parts[0])
  if (id === OID_RSA_PSS) {
    // RSASSA-PSS-params: [0] hash, [1] mask generation, [2] salt length. Absent means SHA-1 and 20.
    let hash = 'sha1'
    let mgfHash = 'sha1'
    let saltLength = 20
    for (const p of parts[1] ? seq(parts[1]) : []) {
      const inner = children(p.value)[0]
      if (p.tag === 0xa0) hash = hashName(inner)
      else if (p.tag === 0xa1) {
        const mgf = seq(inner)
        if (oid(mgf[0]) !== OID_MGF1) throw new Unsupported('mask generation function')
        mgfHash = hashName(mgf[1])
      } else if (p.tag === 0xa2) saltLength = int(inner)
    }
    if (mgfHash !== hash) throw new Unsupported('RSA-PSS with a different mask hash')
    return verify(hash, data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength }, signature)
  }
  if (id in RSA_PKCS1_BY_OID) {
    return verify(RSA_PKCS1_BY_OID[id] ?? digest, data, { key, padding: constants.RSA_PKCS1_PADDING }, signature)
  }
  if (id in ECDSA_BY_OID) return verify(ECDSA_BY_OID[id]!, data, { key, dsaEncoding: 'der' }, signature)
  throw new Unsupported(`signature algorithm ${id}`)
}

interface Sod {
  /** The LDS security object: what is actually signed, through the attributes. */
  eContent: Uint8Array
  certificates: Uint8Array[]
  digest: string
  /** DER of the signed attributes as signed (SET tag), or null when the content is signed directly. */
  signedAttrs: Uint8Array | null
  messageDigest: Uint8Array | null
  sigAlg: DerNode
  signature: Uint8Array
}

function parseSod(sod: Uint8Array): Sod {
  const outer = readOne(sod)
  if (outer.tag !== 0x77) throw new Invalid('EF.SOD does not start with tag 77')
  const contentInfo = seq(readOne(outer.value))
  if (oid(contentInfo[0]) !== OID_SIGNED_DATA) throw new Invalid('EF.SOD is not CMS SignedData')
  const signedData = seq(seq(contentInfo[1], 0xa0)[0])
  // version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
  const encap = seq(signedData[2])
  const eContent = octets(seq(encap[1], 0xa0)[0])
  const certSet = signedData.find((n) => n.tag === 0xa0)
  const certificates = certSet ? children(certSet.value).map((c) => c.raw) : []
  const signerInfos = seq(signedData[signedData.length - 1], 0x31)
  if (signerInfos.length !== 1) throw new Unsupported(`${signerInfos.length} signers in EF.SOD`)
  // version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature
  const si = seq(signerInfos[0])
  const digest = hashName(si[2])
  const hasAttrs = si[3]?.tag === 0xa0
  const sigAlg = si[hasAttrs ? 4 : 3]
  const signature = octets(si[hasAttrs ? 5 : 4])
  if (!sigAlg) throw new Invalid('EF.SOD signer has no signature algorithm')
  let signedAttrs: Uint8Array | null = null
  let messageDigest: Uint8Array | null = null
  if (hasAttrs) {
    // The attributes travel under an implicit [0] tag but are signed as a SET.
    signedAttrs = Uint8Array.from(si[3]!.raw)
    signedAttrs[0] = 0x31
    for (const attr of children(si[3]!.value)) {
      const [type, values] = seq(attr)
      if (oid(type) === OID_MESSAGE_DIGEST) messageDigest = octets(seq(values, 0x31)[0])
    }
    if (!messageDigest) throw new Invalid('EF.SOD signed attributes carry no message digest')
  }
  return { eContent, certificates, digest, signedAttrs, messageDigest, sigAlg, signature }
}

/** The data group hashes the security object lists, and the hash they use. */
function parseSecurityObject(eContent: Uint8Array): { hash: string; groups: Map<number, Uint8Array> } {
  const lds = seq(readOne(eContent))
  const hash = hashName(lds[1])
  const groups = new Map<number, Uint8Array>()
  for (const entry of seq(lds[2])) {
    const [number, value] = seq(entry)
    groups.set(int(number), octets(value))
  }
  return { hash, groups }
}

type Mrz = Omit<PassportFacts, 'expired' | 'anchor' | 'chip'>

function parseDg1(dg1: Uint8Array): Mrz {
  const outer = readOne(dg1)
  if (outer.tag !== 0x61) throw new Invalid('DG1 does not start with tag 61')
  // 5F1F is a two-byte tag, which the generic reader does not take: read it by hand.
  const v = outer.value
  if (v[0] !== 0x5f || v[1] !== 0x1f) throw new Invalid('DG1 holds no MRZ')
  const body = readOne(Uint8Array.from([0x04, ...v.subarray(2)])).value
  const mrz = new TextDecoder('ascii').decode(body)
  if (!/^[A-Z0-9<]+$/.test(mrz)) throw new Invalid('MRZ has characters outside A-Z, 0-9 and <')
  const clean = (s: string): string => s.replace(/<+$/g, '').replace(/</g, ' ').trim()
  const names = (s: string): { surname: string; givenNames: string } => {
    const [surname = '', given = ''] = s.split('<<')
    return { surname: clean(surname), givenNames: clean(given) }
  }
  if (mrz.length === 88) {
    // TD3, the passport booklet: two lines of 44.
    const l2 = mrz.slice(44)
    return {
      documentType: clean(mrz.slice(0, 2)),
      issuingState: clean(mrz.slice(2, 5)),
      ...names(mrz.slice(5, 44)),
      documentNumber: clean(l2.slice(0, 9)),
      nationality: clean(l2.slice(10, 13)),
      dateOfBirth: l2.slice(13, 19),
      sex: clean(l2.slice(20, 21)),
      dateOfExpiry: l2.slice(21, 27)
    }
  }
  if (mrz.length === 90) {
    // TD1, the card: three lines of 30.
    const l2 = mrz.slice(30, 60)
    return {
      documentType: clean(mrz.slice(0, 2)),
      issuingState: clean(mrz.slice(2, 5)),
      documentNumber: clean(mrz.slice(5, 14)),
      dateOfBirth: l2.slice(0, 6),
      sex: clean(l2.slice(7, 8)),
      dateOfExpiry: l2.slice(8, 14),
      nationality: clean(l2.slice(15, 18)),
      ...names(mrz.slice(60))
    }
  }
  throw new Unsupported(`MRZ of ${mrz.length} characters`)
}

/** YYMMDD expiry, read as 20YY, against `nowMs`. The document is valid through its expiry date. */
function isExpired(yymmdd: string, nowMs: number): boolean {
  if (!/^\d{6}$/.test(yymmdd)) return true
  const end = Date.UTC(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6)) + 1)
  return nowMs >= end
}

/**
 * Active Authentication with an RSA chip key: ISO 9796-2 scheme 1 with partial
 * message recovery. The opened signature is `6A ‖ M1 ‖ H(M1 ‖ challenge) ‖ trailer`,
 * where M1 is a nonce the chip chose.
 */
export function rsaChipSigned(key: KeyObject, challenge: Uint8Array, response: Uint8Array): boolean {
  let opened: Uint8Array
  try {
    opened = publicDecrypt({ key, padding: constants.RSA_NO_PADDING }, response)
  } catch {
    return false
  }
  const last = opened[opened.length - 1]
  let hash: string | undefined
  let trailer: number
  if (last === 0xbc) {
    hash = 'sha1'
    trailer = 1
  } else if (last === 0xcc) {
    hash = ISO9796_HASH[opened[opened.length - 2]!]
    trailer = 2
  } else return false
  if (!hash || opened[0] !== 0x6a) return false
  const digestLength = createHash(hash).digest().length
  const m1End = opened.length - trailer - digestLength
  if (m1End < 1) return false
  const expected = createHash(hash).update(opened.subarray(1, m1End)).update(challenge).digest()
  return equal(opened.subarray(m1End, m1End + digestLength), expected)
}

/**
 * Verify a passport reading. `authorAddress` is the letter's 20-byte author key,
 * or null when the author's scheme has no such address (then no chip signature
 * can bind to it). `nowMs` only decides the `expired` fact.
 */
export function verifyPassport(input: PassportInput, anchors: TrustAnchor[], authorAddress: Uint8Array | null, nowMs: number): PassportResult {
  try {
    const sod = parseSod(input.sod)
    const lds = parseSecurityObject(sod.eContent)

    // 1. The identity data is the data the security object lists.
    const dg1Hash = lds.groups.get(1)
    if (!dg1Hash) throw new Invalid('the security object lists no hash for DG1')
    if (!equal(createHash(lds.hash).update(input.dg1).digest(), dg1Hash)) throw new Invalid('DG1 does not match the hash in the security object')

    // 2. The security object is what the document signer signed.
    let signed: Uint8Array = sod.eContent
    if (sod.signedAttrs) {
      if (!equal(createHash(sod.digest).update(sod.eContent).digest(), sod.messageDigest!)) {
        throw new Invalid('the security object does not match the signed digest')
      }
      signed = sod.signedAttrs
    }
    if (sod.certificates.length === 0) throw new Unsupported('EF.SOD carries no document signer certificate')
    let signer: X509Certificate | null = null
    for (const der of sod.certificates.slice(0, 4)) {
      let cert: X509Certificate
      try {
        cert = new X509Certificate(der)
      } catch {
        throw new Unsupported('a document signer certificate this version cannot read')
      }
      if (verifySignature(sod.sigAlg, sod.digest, cert.publicKey, signed, sod.signature)) {
        signer = cert
        break
      }
    }
    if (!signer) throw new Invalid('the document signer did not sign this security object')

    // 3. The document signer was certified by a state certificate we hold.
    let anchor: string | null = null
    for (const a of anchors) {
      try {
        if (signer.verify(new X509Certificate(a.der).publicKey)) {
          anchor = a.name
          break
        }
      } catch {
        /* an anchor of another key type: not the issuer */
      }
    }
    const mrz = parseDg1(input.dg1)
    if (!anchor) return { status: 'unverifiable', reason: `no bundled certificate of ${mrz.issuingState || 'the issuing state'} signed this passport's document signer` }

    // 4. The chip itself signed the author's key.
    let chip: PassportFacts['chip'] = 'absent'
    if (input.aaResponse) {
      if (!input.dg15) throw new Invalid('a chip signature without the chip key (DG15)')
      if (!authorAddress) throw new Invalid('a chip signature cannot bind to this kind of author key')
      const dg15Hash = lds.groups.get(15)
      if (!dg15Hash || !equal(createHash(lds.hash).update(input.dg15).digest(), dg15Hash)) {
        throw new Invalid('DG15 does not match the hash in the security object')
      }
      const holder = readOne(input.dg15)
      if (holder.tag !== 0x6f) throw new Invalid('DG15 does not start with tag 6F')
      let chipKey: KeyObject
      try {
        chipKey = createPublicKey({ key: Buffer.from(holder.value), format: 'der', type: 'spki' })
      } catch {
        throw new Unsupported('a chip key this version cannot read')
      }
      if (chipKey.asymmetricKeyType !== 'rsa') chip = 'unsupported'
      else if (rsaChipSigned(chipKey, bindChallenge(authorAddress), input.aaResponse)) chip = 'signed'
      else throw new Invalid("the chip's signature is not over this author's key")
    }

    return { status: 'verified', facts: { ...mrz, expired: isExpired(mrz.dateOfExpiry, nowMs), anchor, chip } }
  } catch (e) {
    if (e instanceof Unsupported) return { status: 'unverifiable', reason: `unsupported: ${e.message}` }
    if (e instanceof Invalid) return { status: 'invalid', reason: e.message }
    if (e instanceof DerError) return { status: 'invalid', reason: `malformed data: ${e.message}` }
    return { status: 'invalid', reason: 'malformed data' }
  }
}
