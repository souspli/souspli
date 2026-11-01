import { describe, it, expect } from 'vitest'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { ethSigner, ethAddress } from './helpers.js'
import {
  admitBundle,
  parseBundle,
  parseTar,
  buildSealedBundle,
  unsealerFromKey,
  hash,
  toHex
} from '../../src/format/index.js'

// buildSealedBundle is the mirror of sealed admission: every recipient admits
// the result as `valid`, anyone else gets `not-for-me`, and nothing readable
// sits in the tar.

const hex = (b: Uint8Array): string => toHex(b)

describe('authoring — buildSealedBundle', () => {
  const author = secp256k1.utils.randomSecretKey()
  const bob = secp256k1.utils.randomSecretKey()
  const carol = secp256k1.utils.randomSecretKey()
  const eve = secp256k1.utils.randomSecretKey()
  const pub = (k: Uint8Array): Uint8Array => schnorr.getPublicKey(k)
  const program = new TextEncoder().encode('<!doctype html><p>for your eyes only</p>')
  const img = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7])
  const ek = pub(author)

  const build = (): Promise<Uint8Array> =>
    buildSealedBundle(ethSigner(author), [pub(bob), pub(carol)], {
      program,
      type: 'memo',
      args: new Map([['subject', 'the plan']]),
      attachments: new Map([['pic.png', { bytes: img, mime: 'image/png' }]]),
      enc: { e: 'nostr-x-only', ek }
    })

  it('every recipient admits it, with the author, args, attachments and binding intact', async () => {
    const tar = await build()
    for (const reader of [bob, carol]) {
      const r = admitBundle(parseBundle(tar), { unsealer: unsealerFromKey(reader) })
      expect(r.status).toBe('valid')
      if (r.status !== 'valid') return
      expect(r.sealed).toBe(true)
      expect(hex(r.envelope.author.k)).toBe(hex(ethAddress(author)))
      expect(r.manifest.type).toBe('memo')
      expect((r.manifest.args as Map<string, string>).get('subject')).toBe('the plan')
      expect(hex(r.attachments.get('pic.png')!)).toBe(hex(img))
      expect(hex(r.program)).toBe(hex(program))
      expect(r.envelope.author.e).toBe('nostr-x-only')
      expect(hex(r.envelope.author.ek!)).toBe(hex(ek))
    }
  })

  it('anyone else, the author included, gets not-for-me', async () => {
    const tar = await build()
    for (const other of [eve, author]) {
      expect(admitBundle(parseBundle(tar), { unsealer: unsealerFromKey(other) }).status).toBe('not-for-me')
    }
    expect(admitBundle(parseBundle(tar)).status).toBe('not-for-me')
  })

  it('the tar holds no plaintext: no manifest.cbor or program, and no readable words', async () => {
    const tar = await build()
    const names = [...parseTar(tar).keys()].sort()
    expect(names).toEqual(['blobs/' + hex(hash(img)), 'envelope.cbor', 'manifest.enc', 'program.enc'].sort())
    const text = new TextDecoder('latin1').decode(tar)
    for (const leak of ['for your eyes only', 'the plan', 'memo', 'nostr-x-only', 'subject']) {
      expect(text.includes(leak), leak).toBe(false)
    }
    // Nor the author's address or encryption key, in any form.
    for (const k of [ethAddress(author), ek]) {
      expect(Buffer.from(tar).includes(Buffer.from(k))).toBe(false)
    }
  })

  it('sealing twice gives unrelated bytes, so copies cannot be matched up', async () => {
    const [a, b] = [await build(), await build()]
    expect(hex(hash(a))).not.toBe(hex(hash(b)))
    expect(hex(parseTar(a).get('envelope.cbor')!)).not.toBe(hex(parseTar(b).get('envelope.cbor')!))
  })

  it('a tampered member fails the whole bundle', async () => {
    const tar = await build()
    const src = parseBundle(tar)
    src.programEnc![src.programEnc!.length - 1]! ^= 1
    expect(admitBundle(src, { unsealer: unsealerFromKey(bob) }).status).toBe('invalid')
  })

  it('refuses a recipient that is not a 32-byte key, and no recipients at all', async () => {
    await expect(buildSealedBundle(ethSigner(author), [new Uint8Array(33)], { program, type: 'memo' })).rejects.toThrow(
      /32-byte/
    )
    await expect(buildSealedBundle(ethSigner(author), [], { program, type: 'memo' })).rejects.toThrow(/no recipients/)
  })
})
