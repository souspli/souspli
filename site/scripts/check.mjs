// Build gate for souspli.org: what we build ships no JavaScript, loads nothing
// from another origin, has no dead internal links, and every page is small
// enough to arrive in the first round trip.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_dist')

// ~10 TCP segments: what a server may send before the first ACK comes back.
const BUDGET = 14 * 1024
// Reference documents that are long by nature. Everything else must fit.
const OVER_BUDGET_OK = new Set(['/how/protocol/spec/', '/talk/'])
// The talk is a keyboard-driven slide deck: it IS JavaScript, and it inlines its
// fonts and runtime into one file. The one thing it may not do is what nothing
// here may do -- reach another origin -- and that rule still applies to it.
const SCRIPT_OK = new Set(['/talk/'])

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

const problems = []
const sizes = []
for (const file of walk(dist)) {
  if (!file.endsWith('.html')) continue
  const url = '/' + path.relative(dist, file).split(path.sep).join('/').replace(/index\.html$/, '')
  const html = fs.readFileSync(file, 'utf8')
  // Code samples legitimately mention <script>; they are escaped, so a literal
  // tag here is a real one.
  if (!SCRIPT_OK.has(url) && /<script\b/i.test(html)) problems.push(`${url}: contains a <script> tag`)
  // Prose ABOUT the web quotes url(…) and @import; only look outside code.
  const prose = html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, '')
  if (!SCRIPT_OK.has(url) && /\son[a-z]+\s*=\s*["']/i.test(prose)) problems.push(`${url}: inline event handler`)
  // Anything the browser would FETCH must be same-origin or inline. Plain <a>
  // links elsewhere are fine: following one is the reader's decision.
  for (const m of html.matchAll(/<(img|link|source|video|audio|iframe|embed|object)\b[^>]*?\s(?:src|href|data|poster)="([^"]+)"/gi)) {
    if (/^(https?:)?\/\//i.test(m[2])) problems.push(`${url}: <${m[1]}> loads ${m[2]}`)
  }
  if (/url\(\s*["']?(https?:)?\/\//i.test(prose)) problems.push(`${url}: CSS loads a remote url()`)
  if (/@import/i.test(prose)) problems.push(`${url}: CSS @import`)

  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/gi)) {
    const href = m[1]
    if (!href.startsWith('/')) {
      if (!/^([a-z][a-z0-9+.-]*:|#)/i.test(href)) problems.push(`${url}: relative link survived: ${href}`)
      continue
    }
    const clean = href.split('#')[0]
    const target = path.join(dist, clean, clean.endsWith('/') ? 'index.html' : '')
    if (!fs.existsSync(target)) problems.push(`${url}: dead link ${href}`)
  }

  const gz = zlib.gzipSync(html, { level: 9 }).length
  sizes.push([gz, url])
  if (gz > BUDGET && !OVER_BUDGET_OK.has(url)) problems.push(`${url}: ${gz} bytes gzipped, over the ${BUDGET} budget`)
}

sizes.sort((a, b) => b[0] - a[0])
console.log(`checked ${sizes.length} pages; largest:`)
for (const [gz, url] of sizes.slice(0, 5)) console.log(`  ${String(gz).padStart(6)} B gz  ${url}`)
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log('ok — no scripts, no remote resources, no dead links, all pages within budget')
