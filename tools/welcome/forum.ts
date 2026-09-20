// Bundle the welcome forum's roster into the app.
//
//   pnpm welcome:forum path/to/group-xxxxxxxx.thing
//
// The welcome LETTER is signed by a key that was thrown away. The welcome FORUM
// cannot be: a forum needs a keeper who can name moderators and admit members,
// which means a real key held by a real person. So the forum is made the
// ordinary way -- New → Group in the app, by whoever will keep it -- saved with
// Share… → Save as file…, and handed to this script, which checks it is what it
// claims to be before writing it where the app looks (src/shell/welcome/
// forum.thing.b64). An empty file there means "no forum yet": the app then
// offers the relay alone.
//
// Later versions of the roster are NOT bundled. They reach people the way every
// letter does -- post them to the relay -- and the app reads membership and
// moderators from the latest version a reader holds.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { admitBundle, cborToJs, parseBundle } from '../../src/format/index.js'

const OUT = join(__dirname, '..', '..', 'src', 'shell', 'welcome', 'forum.thing.b64')
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

const file = process.argv[2]
if (!file) {
  console.error('usage: pnpm welcome:forum <group.thing>    (or --clear to remove it)')
  process.exit(2)
}
if (file === '--clear') {
  writeFileSync(OUT, '')
  console.log('cleared: the app will offer the relay alone')
  process.exit(0)
}

const bytes = new Uint8Array(readFileSync(file))
const r = admitBundle(parseBundle(bytes))
if (r.status !== 'valid') throw new Error(`that file does not admit: ${JSON.stringify(r)}`)
if (r.sealed) throw new Error('a sealed letter cannot be the public welcome forum')
if (r.manifest.type !== 'group') throw new Error(`that is a '${r.manifest.type}', not a group`)
if (r.envelope.seq !== undefined && r.envelope.seq !== null && r.envelope.seq > 1) {
  throw new Error(`that is version ${r.envelope.seq} of a roster. Bundle the FIRST version: its hash is the forum's identity, and every post names it.`)
}
const args = cborToJs(r.manifest.args) as { name?: unknown; purpose?: unknown; members?: unknown }
const members = Array.isArray(args.members) ? (args.members as { role?: string; name?: string }[]) : []

writeFileSync(OUT, Buffer.from(bytes).toString('base64').replace(/(.{100})/g, '$1\n') + '\n')
console.log(`wrote ${OUT}`)
console.log(`  forum     ${String(args.name ?? '(unnamed)')}`)
console.log(`  purpose   ${String(args.purpose ?? '')}`)
console.log(`  keeper    0x${hex(r.envelope.author.k)}  (${r.envelope.author.s})`)
console.log(`  root      ${hex(r.envelopeHash)}   ← the forum's identity; posts carry it as inGroup`)
console.log(`  roster    ${members.length} listed; moderators: ${members.filter((m) => m.role === 'moderator').map((m) => m.name || '?').join(', ') || 'none'}`)
if (!members.some((m) => m.role === 'moderator')) {
  console.log('  note      no moderators are named, so nothing in this forum is moderated for anyone.')
}
console.log('Next: post this letter to the relay from the app (Share… → Post to relays), then commit the file.')
