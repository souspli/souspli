import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { CasStore } from '../../src/main/store'

// A blob is written whole or not at all. A process killed mid-write must not
// leave a truncated file under the hash of the whole: a blob that exists is
// never written again, so it would stay broken.

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

describe('CasStore.put', () => {
  it('stores bytes under their hash, and leaves no temporary file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cas-'))
    try {
      const cas = new CasStore(dir)
      const bytes = new TextEncoder().encode('hello')
      expect(cas.put(bytes)).toBe(sha(bytes))
      expect(readdirSync(join(dir, 'blobs'))).toEqual([sha(bytes)])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rewrites a truncated blob left by a killed write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cas-'))
    try {
      const cas = new CasStore(dir)
      const bytes = new Uint8Array(4096).map((_, i) => i & 0xff)
      writeFileSync(join(dir, 'blobs', sha(bytes)), bytes.subarray(0, 100))
      cas.put(bytes)
      expect(Buffer.from(readFileSync(join(dir, 'blobs', sha(bytes))))).toEqual(Buffer.from(bytes))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sweeps temporary files from killed writes when opened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cas-'))
    try {
      new CasStore(dir)
      writeFileSync(join(dir, 'blobs', '.tmp-123-abc'), 'partial')
      const cas = new CasStore(dir)
      expect(readdirSync(join(dir, 'blobs'))).toEqual([])
      expect(cas.list()).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
