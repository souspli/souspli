import { describe, expect, it } from 'vitest'
import { parseArgs, profileName } from '../../src/shell/cli'

describe('parseArgs', () => {
  it('no arguments is the app, as always', () => {
    expect(parseArgs([])).toEqual({ command: 'gui', profile: null, target: null, yes: false, files: [], error: null })
  })

  it('reads every command and its flag spelling', () => {
    for (const [args, command] of [
      [['version'], 'version'],
      [['--version'], 'version'],
      [['-v'], 'version'],
      [['help'], 'help'],
      [['--help'], 'help'],
      [['-h'], 'help'],
      [['identity'], 'identity'],
      [['profiles'], 'profiles']
    ] as const) {
      expect(parseArgs(args).command, args.join(' ')).toBe(command)
    }
    expect(parseArgs(['profile', 'delete', 'Joe'])).toMatchObject({ command: 'profile-delete', target: 'joe' })
    expect(parseArgs(['profile', 'delete', 'joe', '--yes'])).toMatchObject({ yes: true })
  })

  it('--profile in both spellings, and alongside a command', () => {
    expect(parseArgs(['--profile', 'Joe'])).toMatchObject({ command: 'gui', profile: 'joe' })
    expect(parseArgs(['--profile=joe'])).toMatchObject({ command: 'gui', profile: 'joe' })
    expect(parseArgs(['--profile', 'joe', 'identity'])).toMatchObject({ command: 'identity', profile: 'joe' })
    expect(parseArgs(['identity', '--profile=joe'])).toMatchObject({ command: 'identity', profile: 'joe' })
  })

  it('ignores flags that belong to somebody else, and the entry script', () => {
    const p = parseArgs(['--no-sandbox', '--inspect=0', '--remote-debugging-port=0', '-psn_0_12345', '/x/out/main/shell/main.js', '--profile', 'joe'])
    expect(p).toMatchObject({ command: 'gui', profile: 'joe', error: null, files: [] })
  })

  it('keeps .thing files for the app to open', () => {
    expect(parseArgs(['/tmp/a.thing', '--profile', 'joe', 'B.THING'])).toMatchObject({ command: 'gui', files: ['/tmp/a.thing', 'B.THING'] })
  })

  it('refuses what it cannot read', () => {
    expect(parseArgs(['frobnicate']).error).toMatch(/unknown command/)
    expect(parseArgs(['--profile']).error).toMatch(/needs a name/)
    expect(parseArgs(['--profile', '--yes']).error).toMatch(/needs a name/)
    expect(parseArgs(['--profile', '../x']).error).toMatch(/not a profile name/)
    expect(parseArgs(['profile']).error).toMatch(/profile delete/)
    expect(parseArgs(['profile', 'rename', 'x']).error).toMatch(/unknown/)
    expect(parseArgs(['profile', 'delete']).error).toMatch(/needs a name/)
  })
})

describe('profileName', () => {
  it('one folder name, lowercased', () => {
    expect(profileName('Joe')).toBe('joe')
    expect(profileName('test-2_b')).toBe('test-2_b')
  })
  it('nothing that could be a path, hidden, or empty', () => {
    for (const bad of ['', '..', '.joe', 'a/b', 'a\\b', '-x', '_x', 'a b', 'é', 'x'.repeat(33)]) {
      expect(profileName(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
