// Wrangler's custom build step (wrangler.jsonc → build.command): make sure this
// package's dependencies are installed before it bundles.
//
// Why a relay needs this at all: it is an npm package inside a repository whose
// root is a pnpm project, so Cloudflare's automatic install has to be switched
// off (SKIP_DEPENDENCY_INSTALL=1 -- see README). That leaves installing to the
// deploy command, and Workers Builds has TWO of those -- one for the production
// branch, one for every other -- so forgetting `npm ci` in either fails the
// build with "Could not resolve @noble/curves". Doing it here means whichever
// command runs, and on whichever branch, the bundle finds its imports.
//
// A no-op when they are already there, so `wrangler dev` starts instantly and
// never reinstalls underneath itself.
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const needed = ['@noble/curves', '@noble/hashes']
const missing = needed.filter((name) => !existsSync(join(root, 'node_modules', name, 'package.json')))

if (missing.length === 0) process.exit(0)
console.log(`[ensure-deps] missing ${missing.join(', ')} — running npm ci --omit=dev`)
// Runtime dependencies only: wrangler is already running, and nothing else in
// devDependencies is needed to bundle.
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: root, stdio: 'inherit' })
