import { describe, expect, it } from 'vitest'
import { claimedTitle, sanitizeTitle, MAX_TITLE_CHARS } from '../../src/shell/library/title'

// A title is program-supplied text drawn in TRUSTED chrome. These pin the
// terms it is allowed in on.
describe('claimedTitle', () => {
  it('reads the field each built-in type keeps its summary in', () => {
    expect(claimedTitle({ title: 'Flood defences approved' })).toBe('Flood defences approved')
    expect(claimedTitle({ subject: 'Friday', message: 'long…' })).toBe('Friday')
    expect(claimedTitle({ name: 'Ada' })).toBe('Ada')
    expect(claimedTitle({ invoiceNumber: 'INV-0042' })).toBe('INV-0042')
    expect(claimedTitle({ replyTo: 'ab'.repeat(32), body: 'I disagree.\nAt length.' })).toBe('I disagree.')
  })

  it('reads args that arrive as a Map (CBOR maps do)', () => {
    expect(claimedTitle(new Map([['title', 'From a map']]))).toBe('From a map')
  })

  it('prefers a title over a body, and skips an empty one', () => {
    expect(claimedTitle({ title: '   ', subject: 'Used instead' })).toBe('Used instead')
  })

  it('offers nothing rather than guessing', () => {
    expect(claimedTitle({ votesOn: 'ab'.repeat(32), dir: 1 })).toBeNull()
    expect(claimedTitle({ title: 42 })).toBeNull()
    expect(claimedTitle({ title: { nested: 'x' } })).toBeNull()
    expect(claimedTitle(null)).toBeNull()
    expect(claimedTitle('a string')).toBeNull()
    expect(claimedTitle(['title'])).toBeNull()
  })
})

describe('sanitizeTitle', () => {
  it('never lets a title borrow the chrome’s ✓', () => {
    for (const tick of ['✓', '✔', '✅', '☑', '🗸', '√']) {
      expect(sanitizeTitle(`${tick} verified by your bank`)).toBe('verified by your bank')
    }
    expect(sanitizeTitle('✓✓✓')).toBeNull()
  })

  it('strips what can reorder or hide text', () => {
    // RLO makes "gnp.exe" read as "exe.png" in a naive renderer.
    expect(sanitizeTitle('invoice\u202Egnp.exe')).toBe('invoice gnp.exe')
    expect(sanitizeTitle('a\u200Bb\u2066c\u2069d\uFEFFe')).toBe('a b c d e')
    expect(sanitizeTitle('tab\there\u0007bell')).toBe('tab here bell')
  })

  it('is one line', () => {
    expect(sanitizeTitle('\n\n  second line is first  \nthird')).toBe('second line is first')
    expect(sanitizeTitle('a\u2028b')).toBe('a b')
  })

  it('caps stacked combining marks', () => {
    const zalgo = 'e' + '\u0301'.repeat(40)
    // NFC folds the first mark into the base; two more may ride on it.
    expect(Array.from(sanitizeTitle(zalgo)!.normalize('NFD')).length).toBeLessThanOrEqual(4)
  })

  it('is short, and never splits a surrogate pair', () => {
    const long = '😀'.repeat(200)
    const out = sanitizeTitle(long)!
    expect(Array.from(out).length).toBe(MAX_TITLE_CHARS)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/)
    expect(sanitizeTitle('x'.repeat(MAX_TITLE_CHARS))).toBe('x'.repeat(MAX_TITLE_CHARS))
  })
})
