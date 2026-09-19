// The welcome letter: the first thing a new install shows, so that the first
// thing anyone sees is a real letter under a real trust header rather than an
// empty window.
//
// It is signed by a key that exists only inside this run. The key is generated,
// used once, and never written anywhere — so nothing else can ever be signed by
// it, there is no project key to guard, and the letter's header honestly shows
// an address the reader has never seen. The letter says so, which makes the
// stranger's address a lesson instead of a wart.
//
// Generated ONCE and frozen, like the sealed conformance vectors: a fresh key
// means fresh bytes and a fresh hash on every run, and the hash is this
// letter's identity. `FORCE=1 pnpm gen:welcome` replaces it deliberately.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { admitBundle, buildBundle, jsToCbor, parseBundle, type Signer } from '../../src/format/index.js'

const ROOT = join(__dirname, '..', '..')
const OUT = join(ROOT, 'src', 'shell', 'welcome', 'welcome.thing.b64')

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

function ethAddress(priv: Uint8Array): Uint8Array {
  const uncompressed = secp256k1.Point.fromBytes(secp256k1.getPublicKey(priv, true)).toBytes(false)
  const addr = keccak_256(uncompressed.subarray(1))
  return addr.subarray(addr.length - 20)
}

/** EIP-191 personal_sign — the same construction the keyring and the
 *  conformance generator use. */
function ethSigner(priv: Uint8Array): Signer {
  return {
    scheme: 'eth-eip191',
    pubkey: ethAddress(priv),
    async sign(signingInput) {
      const prefix = utf8(`\x19Ethereum Signed Message:\n${signingInput.length}`)
      const msg = new Uint8Array(prefix.length + signingInput.length)
      msg.set(prefix, 0)
      msg.set(signingInput, prefix.length)
      const recd = secp256k1.sign(keccak_256(msg), priv, { prehash: false, format: 'recovered' })
      const out = new Uint8Array(65)
      out.set(recd.subarray(1, 65), 0)
      out[64] = recd[0]! + 27
      return out
    }
  }
}

const p = (text: string): { kind: string; text: string } => ({ kind: 'paragraph', text })
const h = (text: string): { kind: string; text: string } => ({ kind: 'heading', text })
const sub = (text: string): { kind: string; text: string } => ({ kind: 'subheading', text })

// Strings only — never a number — so canonical CBOR's float rules cannot bite.
const args = {
  title: 'Welcome to Souspli',
  deck: 'You are reading a letter. Here is what that means, and what to try next.',
  authors: ['The Souspli project'],
  publisher: 'Souspli',
  section: 'Welcome',
  language: 'en',
  rights: 'Apache-2.0. Pass it on.',
  blocks: [
    p(
      'This is a letter: one signed file that carries its own words, layout and behaviour. It came bundled with the app, and it was checked exactly like a letter from a stranger before a single pixel of it was drawn. Nothing on this screen has touched the network.'
    ),
    h('Look up'),
    p(
      'The strip above this letter belongs to Souspli, not to the letter. A letter can draw anything it likes down here — including a very convincing “signed by your bank” — but it cannot draw up there. The header is the only place that can tell you who really signed something.'
    ),
    p(
      'This one says “✓ signed”, followed by an address you have never seen. That key was made to sign this one letter and was then destroyed, so nothing else will ever be signed by it. It is a stranger to you, and the header is right not to pretend otherwise.'
    ),
    h('Three things to try'),
    sub('1. Write something'),
    p(
      'Press New and pick Memo. Fill it in under Edit, flip to View to see exactly what will be signed, then press Publish. Publishing signs the letter with your key. It does not send it anywhere.'
    ),
    sub('2. Hand it to someone'),
    p(
      'Open your memo, press Share…, then Save as file. Send that file however you like — email, a chat, a USB stick. Whoever opens it sees that you signed it, and that not one byte has changed since.'
    ),
    sub('3. Answer this letter'),
    p(
      'Press Comment, above, and write a reply. Your comment is a new letter of yours that points at this one, and it appears underneath it. That is all a thread is. A forum is the same idea with a roster and votes — see File → Forums once you hold a group.'
    ),
    h('Before you rely on it'),
    p(
      'Souspli is an experimental alpha. A signed letter is public and permanent once you share it: you can publish a newer version, but you cannot take the old one back. Private, sealed letters can be opened but not yet written. And your key lives only on this machine — back it up under File → Account & Keys.'
    ),
    h('Where next'),
    p(
      'Guides, the reasoning behind all this, and the full specification are at souspli.org. You can delete this letter whenever you like. It will not come back.'
    )
  ]
}

async function main(): Promise<void> {
  if (existsSync(OUT) && process.env.FORCE !== '1') {
    console.log(`${OUT} exists — it is frozen. FORCE=1 to replace it (its hash, and so its identity, will change).`)
    return
  }
  const priv = randomBytes(32) // lives and dies in this process
  const bundle = await buildBundle(ethSigner(priv), {
    program: new Uint8Array(readFileSync(join(ROOT, 'samples', 'article.html'))),
    type: 'article',
    args: jsToCbor(args)
  })
  priv.fill(0)

  // What we ship must pass the same gate it will meet on someone's machine.
  const admitted = admitBundle(parseBundle(bundle))
  if (admitted.status !== 'valid') throw new Error(`the welcome letter does not admit: ${JSON.stringify(admitted)}`)

  const b64 = Buffer.from(bundle).toString('base64').replace(/(.{100})/g, '$1\n')
  writeFileSync(OUT, b64 + '\n')
  console.log(`wrote ${OUT}`)
  console.log(`  ${bundle.length} bytes · envelope ${hex(admitted.envelopeHash)} · signed by 0x${hex(admitted.envelope.author.k)}`)
}

void main()
