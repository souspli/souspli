// The build gate (check.mjs) proves what we PUBLISH. This looks at what visitors
// RECEIVE: a CDN can rewrite HTML after the build gate has passed, and only a
// fetch of the deployed site can see that.
//
// Cloudflare's own Web Analytics beacon is expected and allowed: it is switched
// on for the Pages project, and the site makes no claim to the contrary. What
// this still catches is anything ELSE turning up in served pages — another
// script, a cookie, a weakened CSP, an edge rewrite, a page over budget.
//
// Some edge injection keys on real navigation headers (a bare curl is served
// the untouched file), so this asks the way a browser does.
const BASE = process.env.SITE_URL ?? 'https://souspli.org'
const BUDGET = 14 * 1024
const OVER_BUDGET_OK = new Set(['/how/protocol/spec/'])
const CF_BEACON = /\ssrc=["']https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/
const NAV = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-encoding': 'identity', // measure bytes ourselves, below
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
}

const { gzipSync } = await import('node:zlib')
const problems = []
const seen = new Set()
const queue = ['/']
while (queue.length) {
  const url = queue.shift()
  if (seen.has(url)) continue
  seen.add(url)
  const res = await fetch(BASE + url, { headers: NAV, redirect: 'manual' })
  if (res.status !== 200) {
    problems.push(`${url}: HTTP ${res.status}`)
    continue
  }
  const html = await res.text()
  const csp = res.headers.get('content-security-policy') ?? ''
  if (!/default-src 'none'/.test(csp)) problems.push(`${url}: Content-Security-Policy missing or weakened`)
  if (res.headers.get('set-cookie')) problems.push(`${url}: sets a cookie`)
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (CF_BEACON.test(m[0])) continue
    problems.push(`${url}: served with ${m[0].slice(0, 120)}`)
  }
  if (/cdn-cgi\/|__cf_email__/i.test(html)) problems.push(`${url}: edge rewrite present (cdn-cgi / email obfuscation)`)
  const gz = gzipSync(html, { level: 9 }).length
  if (gz > BUDGET && !OVER_BUDGET_OK.has(url)) problems.push(`${url}: ${gz} bytes gzipped as served`)
  for (const m of html.matchAll(/<a\b[^>]*?\shref="(\/[^"#]*)/gi)) if (!seen.has(m[1])) queue.push(m[1])
}

console.log(`${BASE}: ${seen.size} pages fetched as a browser would`)
if (problems.length) {
  // One line per distinct cause reads better than 48 copies of it.
  const byCause = new Map()
  for (const p of problems) {
    const cause = p.slice(p.indexOf(': ') + 2)
    byCause.set(cause, (byCause.get(cause) ?? 0) + 1)
  }
  console.error(`\n${problems.length} problem(s):`)
  for (const [cause, n] of byCause) console.error(`  ${n} page(s): ${cause}`)
  process.exit(1)
}
console.log('ok — nothing unexpected in what visitors receive')
