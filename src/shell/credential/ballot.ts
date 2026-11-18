import { parseRule, satisfies, type PassportRule } from './gate.js'
import type { ProofFacts } from './proof.js'

// ── Secret ballots ───────────────────────────────────────────────────────────
//
// Three kinds of letter, and a rule every reader applies alone:
//
//   ballot        the question, the options, who may vote (a passport rule),
//                 and the WITNESSES: named keys, and how many of them must agree.
//   ballot-vote   one choice, signed by a one-time key, with passport proofs
//                 bound to that key and scoped to this ballot. It names nobody.
//   ballot-close  a witness's list of the votes it held when the ballot closed.
//
// A vote is valid when its proofs verify and meet the ballot's rule. One
// passport has one nullifier per ballot, so however many votes it casts, one
// counts.
//
// The deadline is the witnesses'. No letter can prove what time it was written,
// so "before the close" means "listed by at least `quorum` witnesses". Until
// that many have published a closing, the count is provisional and says so.
// After, it is fixed: anyone holding the ballot, the votes and the closings
// computes the same result. Fewer than a quorum of witnesses can neither drop a
// vote nor let a late one in; a quorum acting together can do both, and that is
// exactly the trust a ballot's author places in the witnesses it names.
//
// Pure: the shell supplies letters and verdicts; this decides what counts.

export interface Ballot {
  question: string
  options: string[]
  rule: PassportRule
  /** `scheme:key` of each witness, with the name the ballot gives it. */
  witnesses: { id: string; name: string }[]
  quorum: number
  /** When the ballot says it closes, ms since the epoch. A claim, which witnesses act on by their own clocks. */
  closes: number | null
}

/** The scope a vote's proofs must carry for the ballot with this envelope hash. */
export const ballotScope = (ballotHash: string): string => `souspli:ballot:${ballotHash}`

const MAX_OPTIONS = 16
const MAX_WITNESSES = 16
/** A closing lists at most this many votes (its args are one string, capped at 1 MiB by the format). */
export const MAX_LISTED_VOTES = 8000

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null)

/** A ballot from its args, or null when it is not one a reader can act on. */
export function parseBallot(args: unknown): Ballot | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  const a = args as Record<string, unknown>
  const question = text(a.question, 500)
  if (!question) return null
  if (!Array.isArray(a.options) || a.options.length < 2 || a.options.length > MAX_OPTIONS) return null
  const options = a.options.map((o) => text(o, 200))
  if (options.some((o) => o === null) || new Set(options).size !== options.length) return null
  if (!Array.isArray(a.witnesses) || a.witnesses.length < 1 || a.witnesses.length > MAX_WITNESSES) return null
  const witnesses: Ballot['witnesses'] = []
  for (const w of a.witnesses as unknown[]) {
    const e = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>
    const key = typeof e.key === 'string' ? e.key.trim().replace(/^0x/i, '').toLowerCase() : ''
    const scheme = typeof e.scheme === 'string' && e.scheme ? e.scheme : 'eth-eip191'
    if (scheme !== 'eth-eip191' || !/^[0-9a-f]{40}$/.test(key)) return null
    const id = `${scheme}:${key}`
    if (witnesses.some((x) => x.id === id)) return null
    witnesses.push({ id, name: typeof e.name === 'string' ? e.name.slice(0, 100) : '' })
  }
  const quorum = a.quorum
  if (typeof quorum !== 'number' || !Number.isInteger(quorum) || quorum < 1 || quorum > witnesses.length) return null
  const closesAt = typeof a.closes === 'string' ? Date.parse(a.closes) : NaN
  return {
    question,
    options: options as string[],
    // No rule at all would let one person vote without limit; a ballot must state one.
    rule: typeof a.requires === 'string' ? parseRule(a.requires) : { unreadable: true },
    witnesses,
    quorum,
    closes: Number.isFinite(closesAt) ? closesAt : null
  }
}

/** The vote hashes a closing lists, or null when its list is malformed. */
export function parseClosing(args: unknown): Set<string> | null {
  const votes = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>).votes : undefined
  if (typeof votes !== 'string' || votes.length % 64 !== 0 || votes.length > MAX_LISTED_VOTES * 64 || !/^[0-9a-f]*$/.test(votes)) return null
  const out = new Set<string>()
  for (let i = 0; i < votes.length; i += 64) out.add(votes.slice(i, i + 64))
  return out
}

/** A closing's list: the vote hashes, sorted, end to end. */
export function encodeClosing(voteHashes: string[]): string {
  return [...new Set(voteHashes)].sort().join('')
}

export interface CastVote {
  envelopeHash: string
  /** The time the vote letter claims; only orders one passport's own votes. */
  created: number
  choice: number
  facts: ProofFacts
}

export interface Closing {
  envelopeHash: string
  /** `scheme:key` of the letter's author. */
  author: string
  created: number
  votes: Set<string>
}

/** The votes that are valid for this ballot: proofs meet its rule, made for it, for an option it has. */
export function validVotes(ballot: Ballot, ballotHash: string, votes: CastVote[]): CastVote[] {
  const scope = ballotScope(ballotHash)
  return votes.filter((v) => Number.isInteger(v.choice) && v.choice >= 0 && v.choice < ballot.options.length && satisfies(ballot.rule, scope, v.facts))
}

const later = (a: { created: number; envelopeHash: string }, b: { created: number; envelopeHash: string }): boolean =>
  a.created > b.created || (a.created === b.created && a.envelopeHash < b.envelopeHash)

export interface Tally {
  /** A quorum of witnesses has closed the ballot: the counts are final. */
  closed: boolean
  /** Votes per option, in the ballot's order. */
  counts: number[]
  /** How many votes the counts add up to. */
  counted: number
  /** How many named witnesses have published a closing. */
  closings: number
  quorum: number
  /** Valid votes held that a closed ballot does not count: no quorum of witnesses listed them. */
  unwitnessed: number
  /** The votes behind the counts (one per passport). */
  countedVotes: string[]
}

/** Count a ballot from the vote letters and closings a reader holds. */
export function tally(ballot: Ballot, ballotHash: string, votes: CastVote[], closings: Closing[]): Tally {
  // One closing per named witness: its latest.
  const byWitness = new Map<string, Closing>()
  const named = new Set(ballot.witnesses.map((w) => w.id))
  for (const c of closings) {
    if (!named.has(c.author)) continue
    const held = byWitness.get(c.author)
    if (!held || later(c, held)) byWitness.set(c.author, c)
  }
  const closed = byWitness.size >= ballot.quorum
  const valid = validVotes(ballot, ballotHash, votes)
  const witnessed = (v: CastVote): boolean => {
    let n = 0
    for (const c of byWitness.values()) if (c.votes.has(v.envelopeHash)) n++
    return n >= ballot.quorum
  }
  const eligible = closed ? valid.filter(witnessed) : valid
  // One passport, one vote: its latest among those that are eligible.
  const byNullifier = new Map<string, CastVote>()
  for (const v of eligible) {
    const held = byNullifier.get(v.facts.nullifier)
    if (!held || later(v, held)) byNullifier.set(v.facts.nullifier, v)
  }
  const counts = ballot.options.map(() => 0)
  for (const v of byNullifier.values()) counts[v.choice]!++
  return {
    closed,
    counts,
    counted: byNullifier.size,
    closings: byWitness.size,
    quorum: ballot.quorum,
    unwitnessed: closed ? valid.length - eligible.length : 0,
    countedVotes: [...byNullifier.values()].map((v) => v.envelopeHash).sort()
  }
}
