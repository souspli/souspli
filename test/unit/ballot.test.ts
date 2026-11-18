import { describe, it, expect } from 'vitest'
import { ballotScope, encodeClosing, parseBallot, parseClosing, tally, validVotes, type CastVote, type Closing } from '../../src/shell/credential/ballot.js'
import { deriveBallotKey } from '../../src/shell/keyring/index.js'
import type { ProofFacts } from '../../src/shell/credential/proof.js'

const HASH = 'ba'.repeat(32)
const W = ['a1', 'a2', 'a3'].map((b) => b.repeat(20))
const args = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  question: 'Shall we?',
  options: ['Yes', 'No'],
  requires: 'passport age>=18 nationality=CAN',
  witnesses: W.map((key, i) => ({ key, name: `witness ${i + 1}` })),
  quorum: 2,
  closes: '2026-12-01T00:00:00Z',
  ...over
})
const ballot = parseBallot(args())!
const facts = (nullifier: string, over: Partial<ProofFacts> = {}): ProofFacts => ({
  minAge: 18,
  nationalityIn: ['CAN'],
  scope: ballotScope(HASH),
  subscope: '',
  nullifier: nullifier.repeat(32),
  provedAt: 1_800_000_000,
  anchor: 'test',
  ...over
})
const vote = (hash: string, choice: number, nullifier: string, created = 10, over: Partial<ProofFacts> = {}): CastVote => ({ envelopeHash: hash.repeat(32), created, choice, facts: facts(nullifier, over) })
const closing = (witness: number, hashes: string[], created = 100, id = `c${witness}`): Closing => ({
  envelopeHash: id.padEnd(64, '0'),
  author: `eth-eip191:${W[witness]}`,
  created,
  votes: new Set(hashes.map((h) => h.repeat(32)))
})

describe('parseBallot', () => {
  it('reads a ballot', () => {
    expect(ballot).toMatchObject({ question: 'Shall we?', options: ['Yes', 'No'], quorum: 2, rule: { minAge: 18, nationalityIn: ['CAN'] }, closes: Date.UTC(2026, 11, 1) })
    expect(ballot.witnesses.map((w) => w.id)).toEqual(W.map((k) => `eth-eip191:${k}`))
    expect(parseBallot(args({ witnesses: [{ key: `0x${W[0]!.toUpperCase()}` }], quorum: 1 }))?.witnesses[0]?.id).toBe(`eth-eip191:${W[0]}`)
  })
  it('refuses what a reader could not act on', () => {
    for (const over of [{ question: '' }, { options: ['only'] }, { options: ['a', 'a'] }, { options: new Array(17).fill(0).map((_, i) => `o${i}`) }, { witnesses: [] }, { witnesses: [{ key: 'nope' }] }, { witnesses: [{ key: W[0] }, { key: W[0] }] }, { quorum: 0 }, { quorum: 4 }, { quorum: 1.5 }]) {
      expect(parseBallot(args(over)), JSON.stringify(over).slice(0, 50)).toBeNull()
    }
    expect(parseBallot(null)).toBeNull()
  })
  it('a ballot with no readable rule admits no votes, rather than all of them', () => {
    for (const requires of [undefined, '', 'everyone', 7]) {
      const b = parseBallot(args({ requires }))!
      expect(validVotes(b, HASH, [vote('01', 0, 'n1')])).toEqual([])
    }
  })
})

describe('closings', () => {
  it('round-trip a sorted, de-duplicated list', () => {
    const list = encodeClosing(['bb'.repeat(32), 'aa'.repeat(32), 'bb'.repeat(32)])
    expect(list).toBe('aa'.repeat(32) + 'bb'.repeat(32))
    expect([...parseClosing({ votes: list })!]).toEqual(['aa'.repeat(32), 'bb'.repeat(32)])
    expect(parseClosing({ votes: '' })!.size).toBe(0)
  })
  it('refuse a malformed list', () => {
    for (const votes of [undefined, 7, 'abc', 'AA'.repeat(32), 'zz'.repeat(32)]) expect(parseClosing({ votes })).toBeNull()
  })
})

describe('validVotes', () => {
  it('needs proofs that meet the rule, made for this ballot, for an option it has', () => {
    const ok = vote('01', 1, 'n1')
    expect(validVotes(ballot, HASH, [ok])).toEqual([ok])
    expect(validVotes(ballot, HASH, [vote('02', 2, 'n2'), vote('03', -1, 'n3'), vote('04', 0.5, 'n4')])).toEqual([])
    expect(validVotes(ballot, HASH, [vote('05', 0, 'n5', 10, { minAge: 16 })])).toEqual([])
    expect(validVotes(ballot, HASH, [vote('06', 0, 'n6', 10, { nationalityIn: ['CAN', 'USA'] })])).toEqual([])
    // Proofs made for another ballot: a vote cannot be replayed from one ballot into the next.
    expect(validVotes(ballot, HASH, [vote('07', 0, 'n7', 10, { scope: ballotScope('cd'.repeat(32)) })])).toEqual([])
  })
})

describe('tally', () => {
  const votes = [vote('01', 0, 'n1'), vote('02', 0, 'n2'), vote('03', 1, 'n3')]

  it('is provisional until a quorum of witnesses closes, counting every valid vote held', () => {
    expect(tally(ballot, HASH, votes, [])).toMatchObject({ closed: false, counts: [2, 1], counted: 3, closings: 0, quorum: 2 })
    expect(tally(ballot, HASH, votes, [closing(0, ['01'])])).toMatchObject({ closed: false, counts: [2, 1], closings: 1 })
  })

  it('once closed, counts only votes a quorum of witnesses listed', () => {
    // Vote 03 reached only one witness: it is late, or was dropped, and either way is not counted.
    const t = tally(ballot, HASH, votes, [closing(0, ['01', '02', '03']), closing(1, ['01', '02'])])
    expect(t).toMatchObject({ closed: true, counts: [2, 0], counted: 2, unwitnessed: 1 })
    expect(t.countedVotes).toEqual(['01'.repeat(32), '02'.repeat(32)])
  })

  it('a single witness cannot drop a vote, nor admit a late one', () => {
    // Witness 1 omits vote 01; the other two list it.
    expect(tally(ballot, HASH, votes, [closing(0, ['02', '03']), closing(1, ['01', '02', '03']), closing(2, ['01', '02', '03'])]).counts).toEqual([2, 1])
    // Witness 1 alone lists a vote that arrived after the others closed.
    const late = vote('09', 1, 'n9')
    expect(tally(ballot, HASH, [...votes, late], [closing(0, ['01', '02', '03', '09']), closing(1, ['01', '02', '03']), closing(2, ['01', '02', '03'])]).counts).toEqual([2, 1])
  })

  it('counts one vote per passport: its latest witnessed one', () => {
    const changed = [vote('01', 0, 'n1', 10), vote('04', 1, 'n1', 20)]
    expect(tally(ballot, HASH, changed, []).counts).toEqual([0, 1])
    // The later vote was not witnessed: the earlier, witnessed one stands.
    expect(tally(ballot, HASH, changed, [closing(0, ['01']), closing(1, ['01'])]).counts).toEqual([1, 0])
    // Same claimed time: every reader settles it the same way, whatever order they hold them in.
    const tie = [vote('05', 0, 'n5', 10), vote('06', 1, 'n5', 10)]
    expect(tally(ballot, HASH, tie, []).counts).toEqual(tally(ballot, HASH, [...tie].reverse(), []).counts)
  })

  it('ignores closings from keys the ballot does not name, and takes a witness’s latest', () => {
    const stranger: Closing = { envelopeHash: 'ee'.repeat(32), author: `eth-eip191:${'ff'.repeat(20)}`, created: 100, votes: new Set() }
    expect(tally(ballot, HASH, votes, [stranger, stranger, closing(0, ['01'])]).closed).toBe(false)
    // Witness 1 first lists nothing, then publishes a fuller list.
    const t = tally(ballot, HASH, votes, [closing(0, [], 100, 'c0a'), closing(0, ['01', '02', '03'], 200, 'c0b'), closing(1, ['01', '02', '03'])])
    expect(t.counts).toEqual([2, 1])
  })

  it('gives every reader holding the same letters the same result', () => {
    const closings = [closing(0, ['01', '02', '03']), closing(1, ['01', '03']), closing(2, ['02', '03'])]
    const a = tally(ballot, HASH, votes, closings)
    const b = tally(ballot, HASH, [...votes].reverse(), [...closings].reverse())
    expect(b).toEqual(a)
    expect(a.counts).toEqual([2, 1])
  })
})

describe('the one-time ballot key', () => {
  const identity = new Uint8Array(32).fill(7)
  it('is the same every time for one identity and ballot, and different for any other', () => {
    const k = Buffer.from(deriveBallotKey(identity, HASH)).toString('hex')
    expect(Buffer.from(deriveBallotKey(identity, HASH)).toString('hex')).toBe(k)
    expect(Buffer.from(deriveBallotKey(identity, 'cd'.repeat(32))).toString('hex')).not.toBe(k)
    expect(Buffer.from(deriveBallotKey(new Uint8Array(32).fill(8), HASH)).toString('hex')).not.toBe(k)
    expect(k).not.toBe(Buffer.from(identity).toString('hex'))
  })
})
