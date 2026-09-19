import { describe, expect, it } from 'vitest'
import { applyPins, pinsOf, SHELL_PINNED_KEYS } from '../../src/shell/library/pins'

const H = 'ab'.repeat(32)

describe('pins — what the shell seeds into a draft stays in it', () => {
  it('pins only the pointers the shell owns, and only real ones', () => {
    expect(pinsOf({ inGroup: H, title: 'mine to edit', verdict: 'hide', replyTo: '' })).toEqual({
      inGroup: H,
      verdict: 'hide'
    })
    expect(pinsOf({ inGroup: 7, attests: null })).toEqual({})
    expect(pinsOf(null)).toEqual({})
    expect(pinsOf(new Map([['votesOn', H]]))).toEqual({ votesOn: H })
  })

  it('covers every relation the library indexes', () => {
    // library/index.ts refuses to load otherwise; this is the readable half.
    for (const rel of ['replyTo', 'attests', 'votesOn', 'inGroup']) expect(SHELL_PINNED_KEYS).toContain(rel)
  })

  it('puts a dropped pointer back — the article program has never heard of inGroup', () => {
    expect(applyPins({ title: 'My post', blocks: [] }, { inGroup: H })).toEqual({
      title: 'My post',
      blocks: [],
      inGroup: H
    })
  })

  it('the shell’s value wins: a program does not get to retarget the human’s click', () => {
    expect(applyPins({ replyTo: 'cd'.repeat(32), body: 'x' }, { replyTo: H })).toEqual({ replyTo: H, body: 'x' })
  })

  it('leaves a program with no pins entirely alone', () => {
    const args = { attests: H, statement: 'typed by hand' }
    expect(applyPins(args, {})).toBe(args)
  })

  it('handles Map args, and args that cannot carry a pointer at all', () => {
    const out = applyPins(new Map<string, unknown>([['body', 'x']]), { inGroup: H }) as Map<string, unknown>
    expect(out.get('inGroup')).toBe(H)
    expect(out.get('body')).toBe('x')
    expect(applyPins(null, { inGroup: H })).toEqual({ inGroup: H })
    expect(applyPins('just a string', { inGroup: H })).toEqual({ inGroup: H })
  })
})
