import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InstanceRegistry } from '../../src/shell/instances'

// Running copies find each other through files in one shared folder: a record
// each, a request to quit, and the plan of what to reopen after an update.

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'inst-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('InstanceRegistry', () => {
  it('each copy sees the others, never itself, and not ones that are gone', () => {
    withDir((dir) => {
      const live = new Set([101, 102, 103])
      const alive = (pid: number): boolean => live.has(pid)
      const a = new InstanceRegistry(dir, { pid: 101, profile: null }, { alive })
      const b = new InstanceRegistry(dir, { pid: 102, profile: 'bob' }, { alive })
      const c = new InstanceRegistry(dir, { pid: 103, profile: 'carol' }, { alive })
      for (const r of [a, b, c]) r.register()
      expect(a.others().map((o) => o.profile).sort()).toEqual(['bob', 'carol'])
      // Carol's process ended without cleaning up.
      live.delete(103)
      expect(a.others().map((o) => o.profile)).toEqual(['bob'])
      // Bob quit properly.
      b.unregister()
      expect(a.others()).toEqual([])
    })
  })

  it('a record nobody has refreshed is stale, whatever its pid says', () => {
    withDir((dir) => {
      const a = new InstanceRegistry(dir, { pid: 1, profile: null }, { alive: () => true })
      const b = new InstanceRegistry(dir, { pid: 2, profile: 'bob' }, { alive: () => true })
      b.register()
      const old = new Date(Date.now() - 10 * 60_000)
      utimesSync(join(dir, '2.json'), old, old)
      expect(a.others()).toEqual([])
    })
  })

  it('a quit request reaches the others, not its sender, and not later copies', () => {
    withDir((dir) => {
      let t = 1_000_000
      const now = (): number => t
      const a = new InstanceRegistry(dir, { pid: 1, profile: 'alice' }, { now, alive: () => true })
      const b = new InstanceRegistry(dir, { pid: 2, profile: 'bob' }, { now, alive: () => true })
      t += 10
      a.requestQuit()
      expect(a.quitRequested()).toBe(false)
      expect(b.quitRequested()).toBe(true)
      // A copy started after the request is not being asked.
      t += 10
      const late = new InstanceRegistry(dir, { pid: 3, profile: null }, { now, alive: () => true })
      expect(late.quitRequested()).toBe(false)
      a.clearQuitRequest()
      expect(b.quitRequested()).toBe(false)
    })
  })

  it('the relaunch plan is taken once, by the version it was written for', () => {
    withDir((dir) => {
      const a = new InstanceRegistry(dir, { pid: 1, profile: 'alice' })
      a.writeRelaunchPlan('0.2.3', ['alice', 'bob', 'alice', null])
      // The old version starting again (the install failed) does not take it.
      expect(new InstanceRegistry(dir, { pid: 2, profile: null }).takeRelaunchPlan('0.2.2')).toBeNull()
      const r = new InstanceRegistry(dir, { pid: 3, profile: null })
      expect(r.takeRelaunchPlan('0.2.3')).toEqual(['alice', 'bob', null])
      expect(r.takeRelaunchPlan('0.2.3')).toBeNull()
    })
  })

  it('a stale plan is thrown away, not acted on', () => {
    withDir((dir) => {
      let t = 0
      const now = (): number => t
      new InstanceRegistry(dir, { pid: 1, profile: 'alice' }, { now }).writeRelaunchPlan('0.2.3', ['alice'])
      t += 60 * 60_000
      expect(new InstanceRegistry(dir, { pid: 2, profile: null }, { now }).takeRelaunchPlan('0.2.3')).toBeNull()
    })
  })
})
