import { constants, createHash, generateKeyPairSync, privateEncrypt, randomBytes, sign, type KeyObject } from 'node:crypto'

// ── A synthetic passport, for tests ──────────────────────────────────────────
//
// Builds the files a passport chip holds -- DG1, DG15, EF.SOD -- under a
// made-up state certificate, with real signatures, so the verifier is tested
// against structurally genuine data without any real person's passport in the
// repository. Mirrors ICAO 9303: CSCA signs the document signer, the signer
// signs the security object, the security object lists the data group hashes,
// and the chip key (DG15) answers Active Authentication challenges.

const cat = (...parts: Uint8Array[]): Uint8Array => new Uint8Array(Buffer.concat(parts))

export function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = cat(...parts)
  const n = body.length
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]
  return cat(Uint8Array.from([tag, ...len]), body)
}
const seq = (...p: Uint8Array[]): Uint8Array => tlv(0x30, ...p)
const set = (...p: Uint8Array[]): Uint8Array => tlv(0x31, ...p)
const int = (n: number): Uint8Array => tlv(0x02, Uint8Array.from(n < 0x80 ? [n] : [0, n]))
const oct = (b: Uint8Array): Uint8Array => tlv(0x04, b)
const NULL = Uint8Array.from([0x05, 0x00])
function oid(dotted: string): Uint8Array {
  const [a, b, ...rest] = dotted.split('.').map(Number)
  const out = [a! * 40 + b!]
  for (let v of rest) {
    const chunk = [v & 0x7f]
    while ((v = Math.floor(v / 128)) > 0) chunk.unshift((v & 0x7f) | 0x80)
    out.push(...chunk)
  }
  return tlv(0x06, Uint8Array.from(out))
}
const SHA256 = seq(oid('2.16.840.1.101.3.4.2.1'), NULL)
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), NULL)
const RSA_PSS_SHA256 = seq(
  oid('1.2.840.113549.1.1.10'),
  seq(tlv(0xa0, SHA256), tlv(0xa1, seq(oid('1.2.840.113549.1.1.8'), SHA256)), tlv(0xa2, int(32)))
)
const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(b).digest())
const name = (cn: string): Uint8Array => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, new TextEncoder().encode(cn)))))
const utc = (s: string): Uint8Array => tlv(0x17, new TextEncoder().encode(s))

function rsaSign(data: Uint8Array, key: KeyObject, pss: boolean): Uint8Array {
  return new Uint8Array(
    sign('sha256', data, pss ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : { key, padding: constants.RSA_PKCS1_PADDING })
  )
}

function certificate(subject: string, issuer: string, serial: number, subjectKey: KeyObject, issuerKey: KeyObject, pss: boolean): Uint8Array {
  const alg = pss ? RSA_PSS_SHA256 : SHA256_RSA
  const spki = new Uint8Array(subjectKey.export({ type: 'spki', format: 'der' }))
  const tbs = seq(tlv(0xa0, int(2)), int(serial), alg, name(issuer), seq(utc('200101000000Z'), utc('491231235959Z')), name(subject), spki)
  return seq(tbs, alg, tlv(0x03, Uint8Array.from([0]), rsaSign(tbs, issuerKey, pss)))
}

const rsa = (bits: number): { publicKey: KeyObject; privateKey: KeyObject } => generateKeyPairSync('rsa', { modulusLength: bits })

export interface TestState {
  /** The state's CSCA certificate (DER): the trust anchor. */
  anchor: Uint8Array
  /** Issue a passport of this state. */
  issue(opts?: { surname?: string; given?: string; nationality?: string; expiry?: string }): TestPassport
}

export interface TestPassport {
  dg1: Uint8Array
  dg15: Uint8Array
  sod: Uint8Array
  /** What the chip answers to an Active Authentication challenge. */
  chipSign(challenge: Uint8Array): Uint8Array
}

/** A made-up issuing state. `pss` signs everything with RSA-PSS, as Canada does; otherwise PKCS#1 v1.5. */
export function makeState(code = 'UTO', pss = false): TestState {
  const csca = rsa(2048)
  const signer = rsa(2048)
  const anchor = certificate(`CSCA ${code}`, `CSCA ${code}`, 1, csca.publicKey, csca.privateKey, pss)
  const dsc = certificate(`DS ${code}`, `CSCA ${code}`, 2, signer.publicKey, csca.privateKey, pss)
  return {
    anchor,
    issue({ surname = 'ERIKSSON', given = 'ANNA<MARIA', nationality = code, expiry = '350101' } = {}) {
      const line1 = `P<${code}${surname}<<${given}`.padEnd(44, '<').slice(0, 44)
      const line2 = `L898902C36${nationality}7408122F${expiry}9`.padEnd(43, '<') + '0'
      const dg1 = tlv(0x61, Uint8Array.from([0x5f, 0x1f, 88]), new TextEncoder().encode(line1 + line2))
      const chip = rsa(1024)
      const dg15 = tlv(0x6f, new Uint8Array(chip.publicKey.export({ type: 'spki', format: 'der' })))
      const eContent = seq(int(0), SHA256, seq(seq(int(1), oct(sha256(dg1))), seq(int(15), oct(sha256(dg15)))))
      const attrs = cat(
        seq(oid('1.2.840.113549.1.9.3'), set(oid('2.23.136.1.1.1'))),
        seq(oid('1.2.840.113549.1.9.4'), set(oct(sha256(eContent))))
      )
      const signerInfo = seq(
        int(1),
        seq(name(`CSCA ${code}`), int(2)),
        SHA256,
        tlv(0xa0, attrs),
        pss ? RSA_PSS_SHA256 : seq(oid('1.2.840.113549.1.1.1'), NULL),
        oct(rsaSign(set(attrs), signer.privateKey, pss))
      )
      const signedData = seq(int(3), set(SHA256), seq(oid('2.23.136.1.1.1'), tlv(0xa0, oct(eContent))), tlv(0xa0, dsc), set(signerInfo))
      const sod = tlv(0x77, seq(oid('1.2.840.113549.1.7.2'), tlv(0xa0, signedData)))
      return {
        dg1,
        dg15,
        sod,
        // ISO 9796-2 scheme 1: 6A ‖ M1 ‖ SHA-1(M1 ‖ challenge) ‖ BC, under the chip's private key.
        chipSign(challenge) {
          const m1 = randomBytes(128 - 20 - 2)
          const h = createHash('sha1').update(m1).update(challenge).digest()
          const block = Buffer.concat([Uint8Array.from([0x6a]), m1, h, Uint8Array.from([0xbc])])
          return new Uint8Array(privateEncrypt({ key: chip.privateKey, padding: constants.RSA_NO_PADDING }, block))
        }
      }
    }
  }
}
