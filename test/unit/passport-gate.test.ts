import { describe, it, expect } from 'vitest'
import { admitted, describeRule, formatRule, groupScope, parseRule, passportRuleOf, satisfies, type Candidate } from '../../src/shell/credential/gate.js'
import type { ProofFacts } from '../../src/shell/credential/proof.js'

const ROOT = 'ab'.repeat(32)
const SCOPE = groupScope(ROOT)
const facts = (over: Partial<ProofFacts> = {}): ProofFacts => ({
  minAge: 18,
  nationalityIn: ['CAN'],
  scope: groupScope(ROOT),
  subscope: '',
  nullifier: '01'.repeat(32),
  provedAt: 1_800_000_000,
  anchor: 'test',
  ...over
})
const cand = (key: string, created: number, over: Partial<ProofFacts> = {}, hash = key.repeat(32)): Candidate => ({
  envelopeHash: hash,
  authorScheme: 'eth-eip191',
  authorKey: key.repeat(20),
  created,
  facts: facts(over)
})

describe('passportRuleOf', () => {
  it('reads a rule, and reads no rule as no gate', () => {
    expect(passportRuleOf({ name: 'x' })).toBeNull()
    expect(passportRuleOf(null)).toBeNull()
    expect(passportRuleOf({ requires: '' })).toBeNull()
    expect(passportRuleOf({ requires: 'passport age>=18 nationality=CAN,USA' })).toEqual({ minAge: 18, nationalityIn: ['CAN', 'USA'] })
    expect(passportRuleOf({ requires: 'passport nationality=CAN' })).toEqual({ nationalityIn: ['CAN'] })
    expect(passportRuleOf({ requires: 'passport' })).toEqual({})
  })
  it('fails closed on a rule it cannot read: an unknown gate admits nobody', () => {
    for (const requires of ['x', 'email', 'passport age>=0', 'passport age>=150', 'passport age>=18.5', 'passport age>=18 age>=21', 'passport nationality=', 'passport nationality=can', 'passport nationality=CAN,CAN', 'passport resident=CAN', 'Passport', 7, {}, { passport: { minAge: 18 } }]) {
      expect(passportRuleOf({ requires }), JSON.stringify(requires)).toEqual({ unreadable: true })
    }
    expect(satisfies({ unreadable: true }, SCOPE, facts())).toBe(false)
  })
  it('writes a rule as the text it reads', () => {
    for (const text of ['passport', 'passport age>=18', 'passport nationality=CAN,USA', 'passport age>=21 nationality=CAN']) {
      expect(formatRule(parseRule(text))).toBe(text)
    }
  })
})

describe('satisfies', () => {
  it('takes a stronger proof for a weaker rule, never the reverse', () => {
    expect(satisfies({ minAge: 18 }, SCOPE, facts({ minAge: 21 }))).toBe(true)
    expect(satisfies({ minAge: 21 }, SCOPE, facts({ minAge: 18 }))).toBe(false)
    expect(satisfies({ minAge: 18 }, SCOPE, facts({ minAge: undefined }))).toBe(false)
    expect(satisfies({ nationalityIn: ['CAN', 'USA', 'MEX'] }, SCOPE, facts({ nationalityIn: ['CAN', 'USA'] }))).toBe(true)
    // "Canadian or American" is not a proof of being Canadian.
    expect(satisfies({ nationalityIn: ['CAN'] }, SCOPE, facts({ nationalityIn: ['CAN', 'USA'] }))).toBe(false)
    expect(satisfies({ nationalityIn: ['CAN'] }, SCOPE, facts({ nationalityIn: undefined }))).toBe(false)
    expect(satisfies({}, SCOPE, facts({ minAge: undefined, nationalityIn: undefined }))).toBe(true)
  })
  it('only counts a proof made for this group', () => {
    expect(satisfies({}, SCOPE, facts({ scope: groupScope('cd'.repeat(32)) }))).toBe(false)
    expect(satisfies({}, SCOPE, facts({ scope: 'souspli:test' }))).toBe(false)
    expect(satisfies({}, SCOPE, facts({ subscope: 'x' }))).toBe(false)
  })
})

describe('admitted', () => {
  const rule = { minAge: 18, nationalityIn: ['CAN'] }
  it('admits each key with a satisfying proof', () => {
    const m = admitted(rule, ROOT, [cand('aa', 10, { nullifier: '01'.repeat(32) }), cand('bb', 10, { nullifier: '02'.repeat(32) }), cand('cc', 10, { nullifier: '03'.repeat(32), minAge: 16 })])
    expect([...m.keys()].sort()).toEqual([`eth-eip191:${'aa'.repeat(20)}`, `eth-eip191:${'bb'.repeat(20)}`])
  })
  it('counts one passport once: the latest proof moves the membership to its key', () => {
    const same = { nullifier: '07'.repeat(32) }
    expect([...admitted(rule, ROOT, [cand('aa', 10, same), cand('bb', 20, same)]).keys()]).toEqual([`eth-eip191:${'bb'.repeat(20)}`])
    expect([...admitted(rule, ROOT, [cand('bb', 20, same), cand('aa', 10, same)]).keys()]).toEqual([`eth-eip191:${'bb'.repeat(20)}`])
    // Same claimed second: every reader breaks the tie the same way, whatever order the letters arrived in.
    const tie = [cand('aa', 10, same, 'f0'.repeat(32)), cand('bb', 10, same, '0f'.repeat(32))]
    expect([...admitted(rule, ROOT, tie).keys()]).toEqual([...admitted(rule, ROOT, [...tie].reverse()).keys()])
    expect([...admitted(rule, ROOT, tie).keys()]).toEqual([`eth-eip191:${'bb'.repeat(20)}`])
  })
  it('counts one key once, however many passports it holds', () => {
    const m = admitted(rule, ROOT, [cand('aa', 10, { nullifier: '01'.repeat(32) }), cand('aa', 20, { nullifier: '02'.repeat(32) }, 'ee'.repeat(32))])
    expect(m.size).toBe(1)
  })
})

describe('describeRule', () => {
  it('says the rule in words', () => {
    expect(describeRule({ minAge: 18, nationalityIn: ['CAN'] })).toBe('a passport proof: aged 18 or over, a citizen of CAN')
    expect(describeRule({})).toBe('a passport proof: any valid passport')
    expect(describeRule({ unreadable: true })).toContain('nobody is admitted')
  })
})
