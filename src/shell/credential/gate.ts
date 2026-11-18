import type { ProofFacts } from './proof.js'

// ── Groups that admit by passport proof ──────────────────────────────────────
//
// A group may state a rule in its args, as one line of text:
//
//   requires: 'passport age>=18 nationality=CAN,USA'
//
// (`passport` alone admits any valid passport. Text, not a structure, so that
// the shell can pin it through the Group type's own edit form -- see pins.ts --
// and so that a person reading a group's args can read its rule.)
//
// and then its members are not a list its keeper wrote. They are whoever has
// published a verified `passport-proof` letter into the group that satisfies
// the rule -- something every reader works out for themselves from the letters
// they hold, with the same answer. The keeper sets the rule and cannot make an
// exception to it.
//
// Three things make a proof count for a group, all decided here:
//   - it was made FOR this group: its scope is the group's, so its nullifier
//     is this group's and says nothing about the holder anywhere else;
//   - it proves at least what the rule asks;
//   - its passport is not already in the group under another key: one
//     nullifier is one member. The latest proof wins, which is also how a
//     member moves to a new key.
//
// Pure: no library, no clock. The shell supplies the letters and the verdicts.

export interface PassportRule {
  minAge?: number
  nationalityIn?: string[]
  /** The group states a rule this version cannot read. Nobody satisfies it: a
   *  gate that fails open would admit everyone to a group that meant to admit few. */
  unreadable?: true
}

/** The scope a proof must carry to count for the group rooted at `root`. */
export const groupScope = (root: string): string => `souspli:group:${root}`

const UNREADABLE: PassportRule = { unreadable: true }

/** Read a rule from its text. Anything not exactly in the grammar is unreadable. */
export function parseRule(text: string): PassportRule {
  const [head, ...terms] = text.trim().split(/\s+/)
  if (head !== 'passport' || text.length > 1024) return UNREADABLE
  const out: PassportRule = {}
  for (const term of terms) {
    const age = /^age>=(\d{1,3})$/.exec(term)
    const nat = /^nationality=([A-Z]{3}(?:,[A-Z]{3})*)$/.exec(term)
    if (age && out.minAge === undefined) {
      const n = Number(age[1])
      if (n < 1 || n > 149) return UNREADABLE
      out.minAge = n
    } else if (nat && out.nationalityIn === undefined) {
      const list = nat[1]!.split(',')
      if (list.length > 200 || new Set(list).size !== list.length) return UNREADABLE
      out.nationalityIn = list
    } else return UNREADABLE
  }
  return out
}

/** A rule as the text a group states. The inverse of parseRule for a readable rule. */
export function formatRule(rule: PassportRule): string {
  return ['passport', ...(rule.minAge !== undefined ? [`age>=${rule.minAge}`] : []), ...(rule.nationalityIn ? [`nationality=${rule.nationalityIn.join(',')}`] : [])].join(' ')
}

/** The passport rule a group's args state, or null when the group states none. */
export function passportRuleOf(groupArgs: unknown): PassportRule | null {
  if (!groupArgs || typeof groupArgs !== 'object' || Array.isArray(groupArgs)) return null
  const requires = (groupArgs as Record<string, unknown>).requires
  if (requires === undefined || requires === null || requires === '') return null
  return typeof requires === 'string' ? parseRule(requires) : UNREADABLE
}

/** Whether verified proof facts meet the rule, as proofs made for `scope` (a group's, or a ballot's). */
export function satisfies(rule: PassportRule, scope: string, facts: ProofFacts): boolean {
  if (rule.unreadable) return false
  if (facts.scope !== scope || facts.subscope !== '') return false
  // "At least 21" satisfies "at least 18"; no age proof satisfies neither.
  if (rule.minAge !== undefined && (facts.minAge === undefined || facts.minAge < rule.minAge)) return false
  // "One of CAN, USA" does not satisfy "CAN": the holder might be American.
  // Every nationality the proof allows must be one the rule allows.
  if (rule.nationalityIn !== undefined) {
    if (!facts.nationalityIn || !facts.nationalityIn.every((c) => rule.nationalityIn!.includes(c))) return false
  }
  return true
}

export interface Candidate {
  envelopeHash: string
  authorScheme: string
  authorKey: string
  /** The time the letter claims. Only orders one passport's own proofs against each other. */
  created: number
  facts: ProofFacts
}

/**
 * The members a rule admits, from verified proof letters posted into the
 * group: `scheme:key` → the proof that admits them. One passport, one member.
 */
export function admitted(rule: PassportRule, root: string, candidates: Candidate[]): Map<string, Candidate> {
  const byNullifier = new Map<string, Candidate>()
  for (const c of candidates) {
    if (!satisfies(rule, groupScope(root), c.facts)) continue
    const held = byNullifier.get(c.facts.nullifier)
    // Latest wins; the envelope hash settles a tie the same way for every reader.
    if (!held || c.created > held.created || (c.created === held.created && c.envelopeHash < held.envelopeHash)) {
      byNullifier.set(c.facts.nullifier, c)
    }
  }
  const members = new Map<string, Candidate>()
  for (const c of byNullifier.values()) {
    const id = `${c.authorScheme}:${c.authorKey.toLowerCase()}`
    const held = members.get(id)
    // One key holding two passports is still one member.
    if (!held || c.created > held.created) members.set(id, c)
  }
  return members
}

/** A rule in words, for the trusted chrome. */
export function describeRule(rule: PassportRule): string {
  if (rule.unreadable) return 'a rule this version of Souspli cannot read (nobody is admitted)'
  const parts: string[] = []
  if (rule.minAge !== undefined) parts.push(`aged ${rule.minAge} or over`)
  if (rule.nationalityIn) parts.push(rule.nationalityIn.length === 1 ? `a citizen of ${rule.nationalityIn[0]}` : `a citizen of one of ${rule.nationalityIn.join(', ')}`)
  return `a passport proof: ${parts.length ? parts.join(', ') : 'any valid passport'}`
}
