// The command line without the app: run by souspli.cmd (build/win) under
// ELECTRON_RUN_AS_NODE, where Electron attaches the console so output shows
// and the delete prompt can be answered. Same commands as main.ts runs at its
// top (cli.ts), minus anything that needs the keychain.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nodeContext, parseArgs, runCommand } from './cli.js'

function version(): string {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as { version?: string }).version ?? '?'
  } catch {
    return '?'
  }
}

/** No command: tell souspli.cmd to open the app with the same arguments. */
export const OPEN_THE_APP = 100

const parsed = parseArgs(process.argv.slice(2))
if (parsed.command === 'gui' && !parsed.error) process.exit(OPEN_THE_APP)
runCommand(parsed, nodeContext(version())).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`souspli: ${(e as Error).message}\n`)
    process.exit(1)
  }
)
