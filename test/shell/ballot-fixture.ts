import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { buildBundle, ethAddress, ethSigner } from './helpers.js'
import { hash, parseBundle } from '../../src/format/index.js'
import { deriveBallotKey } from '../../src/shell/keyring/index.js'

// A secret ballot built the same way every time, so its hash -- and so the scope a vote's
// proofs must carry, and the one-time address the test identity votes from -- never changes.
// The proof fixtures in test/passport-fixtures/*/ballot-*.json were made for exactly
// these (see zk/fixture.sh in the nfcid tools). `pnpm tsx test/shell/ballot-fixture.ts`
// prints the values to make them with.

const key = (b: number): Uint8Array => new Uint8Array(32).fill(b)
export const ORGANIZER = key(4)
export const WITNESS_1 = key(5)
export const WITNESS_2 = key(6)
/** The identity the app under test is given: the ballot's third witness, and a voter. */
export const IDENTITY = key(7)
const hexOf = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const STUB = new TextEncoder().encode('<!doctype html><p>ballot fixture</p>')

export function ballotBundle(): Promise<Uint8Array> {
  return buildBundle(ethSigner(ORGANIZER), {
    type: 'ballot',
    program: STUB,
    created: 1_794_000_000,
    args: new Map<string, unknown>([
      ['question', 'Shall we?'],
      ['options', ['Yes', 'No']],
      ['requires', 'passport age>=18'],
      [
        'witnesses',
        [WITNESS_1, WITNESS_2, IDENTITY].map((k, i) => new Map<string, string>([['key', hexOf(ethAddress(k))], ['scheme', 'eth-eip191'], ['name', `Witness ${i + 1}`]]))
      ],
      ['quorum', 2],
      // In the past, so a witness may close it.
      ['closes', '2026-11-01T00:00:00.000Z']
    ])
  })
}

export async function ballotHash(): Promise<string> {
  return hexOf(hash(parseBundle(await ballotBundle()).envelope))
}

/** The address IDENTITY votes from on this ballot. */
export async function identityVoteAddress(): Promise<string> {
  const secret = deriveBallotKey(IDENTITY, await ballotHash())
  const pub = secp256k1.Point.fromBytes(secp256k1.getPublicKey(secret, true)).toBytes(false)
  return `0x${hexOf(keccak_256(pub.subarray(1)).subarray(12))}`
}

if (process.argv[1]?.endsWith('ballot-fixture.ts')) {
  void (async () => {
    console.log(`scope    souspli:ballot:${await ballotHash()}`)
    console.log(`identity ${await identityVoteAddress()}`)
  })()
}
