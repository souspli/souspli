import { buildBundle, ethSigner } from './helpers.js'
import { hash, parseBundle } from '../../src/format/index.js'

// A forum that admits by passport proof, built the same way every time so that
// its root hash -- and so the scope a proof for it must carry -- never changes.
// The proof fixtures in test/passport-fixtures/a/group-*.json were made for
// exactly this root (see GROUP_ROOT, and zk/fixture.sh in the nfcid tools).
// The program is a stub on purpose: the shell reads a group by its type and
// args, and a fixture must not move when samples/group.html is edited.

export const KEEPER = new Uint8Array(32).fill(3)
export const RULE = 'passport age>=18 nationality=AUS,NZL'
const STUB = new TextEncoder().encode('<!doctype html><p>gated forum fixture</p>')

export function gatedGroupBundle(): Promise<Uint8Array> {
  return buildBundle(ethSigner(KEEPER), {
    type: 'group',
    program: STUB,
    created: 1_794_000_000,
    args: new Map<string, unknown>([
      ['name', 'Antipodeans, 18 and over'],
      ['members', []],
      ['requires', RULE]
    ])
  })
}

/** The root hash of the fixture group: the envelope hash of the bundle above. */
export async function gatedGroupRoot(): Promise<string> {
  const src = parseBundle(await gatedGroupBundle())
  return Buffer.from(hash(src.envelope)).toString('hex')
}

