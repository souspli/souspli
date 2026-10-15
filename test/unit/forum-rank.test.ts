import { describe, expect, it } from 'vitest'
import { firstSeen, hotness, rank } from '../../src/shell/forum/rank'
import { voteClaim } from '../../src/shell/library/index'

const H = 3_600_000
const NOW = 1_800_000_000_000

describe('firstSeen', () => {
  it('is the earlier of the claim and the arrival', () => {
    expect(firstSeen(1000, 5_000_000)).toBe(1_000_000) // written before it arrived
    expect(firstSeen(9_999_999_999, 5_000_000)).toBe(5_000_000) // dated into the future: arrival wins
    expect(firstSeen(0, 5_000_000)).toBe(5_000_000) // no claim
  })
})

describe('hotness', () => {
  it('rises with points and sinks with age', () => {
    expect(hotness(10, H)).toBeGreaterThan(hotness(5, H))
    expect(hotness(10, H)).toBeGreaterThan(hotness(10, 10 * H))
    expect(hotness(0, 0)).toBe(0)
  })
})

describe('rank', () => {
  const rows = [
    { id: 'old-popular', points: 30, firstSeen: NOW - 48 * H },
    { id: 'fresh-liked', points: 5, firstSeen: NOW - 1 * H },
    { id: 'brand-new', points: 0, firstSeen: NOW - 60_000 },
    { id: 'middling', points: 3, firstSeen: NOW - 6 * H }
  ]
  it('top: points over age, like HN', () => {
    expect(rank(rows, 'top', NOW).map((r) => r.id)).toEqual(['fresh-liked', 'middling', 'old-popular', 'brand-new'])
  })
  it('new: newest first, whatever the points', () => {
    expect(rank(rows, 'new', NOW).map((r) => r.id)).toEqual(['brand-new', 'fresh-liked', 'middling', 'old-popular'])
  })
  it('breaks ties toward the newer post, and does not mutate its input', () => {
    const tie = [
      { id: 'a', points: 0, firstSeen: NOW - 2 * H },
      { id: 'b', points: 0, firstSeen: NOW - 1 * H }
    ]
    expect(rank(tie, 'top', NOW).map((r) => r.id)).toEqual(['b', 'a'])
    expect(tie.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('voteClaim', () => {
  const target = 'a'.repeat(64)
  it('reads +1, -1, and 0 (a withdrawal)', () => {
    expect(voteClaim({ votesOn: target, dir: 1 })).toEqual({ target, dir: 1 })
    expect(voteClaim({ votesOn: target, dir: -1 })).toEqual({ target, dir: -1 })
    expect(voteClaim({ votesOn: target, dir: 0 })).toEqual({ target, dir: 0 })
  })
  it('a weight a program could choose is still not a vote', () => {
    expect(voteClaim({ votesOn: target, dir: 2 })).toBeNull()
    expect(voteClaim({ votesOn: target, dir: 'up' })).toBeNull()
    expect(voteClaim({ votesOn: target })).toBeNull()
    expect(voteClaim({ dir: 1 })).toBeNull()
  })
})
