// Take the website's screenshot of the real app, headlessly.
//
//   pnpm world provision && pnpm world seed     # once: the populated library
//   pnpm build
//   node tools/screenshot/capture.mjs [account] [title-substring]
//
// The window is two native views -- the trusted chrome, and the cage composited
// over part of it -- so no single capturePage() sees what a person sees. Each
// view is captured and the two are laid together at the cage's real bounds in
// an offscreen page, which is then captured once more. It runs against a COPY
// of the world account, so the world itself is never touched.
//
// On a headless box (the default Xvfb screen is 1280 wide and would clip this):
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/screenshot/capture.mjs
import { _electron } from 'playwright'
import { cpSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const who = process.argv[2] ?? 'ada'
const wanted = (process.argv[3] ?? 'Harbour Yard redevelopment').toLowerCase()
const OUT = join(ROOT, 'site', 'public', 'img')
const W = 1440
const H = 900

const src = join(ROOT, 'world', 'accounts', who)
if (!existsSync(join(src, 'library'))) {
  console.error(`no world account '${who}' — run: pnpm world provision && pnpm world seed`)
  process.exit(1)
}
const profile = mkdtempSync(join(tmpdir(), 'souspli-shot-'))
for (const part of ['identity.key.enc', 'library', 'seeds']) cpSync(join(src, part), join(profile, part), { recursive: true })

const app = await _electron.launch({
  args: [join(ROOT, 'out', 'main', 'shell', 'main.js')],
  env: {
    ...process.env,
    SHELL_USER_DATA_DIR: profile,
    SHELL_SCALE: '1',
    SHELL_TORRENT_OFFLINE: '1',
    SHELL_NO_WELCOME: '1',
    SHELL_FORCE_SOFTWARE_KEYS: '1',
    SHELL_ALLOW_MULTI: '1'
  }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = (js) =>
  app.evaluate(
    async ({ webContents }, code) =>
      webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
        .executeJavaScript(code),
    js
  )

try {
  await sleep(3500)
  await app.evaluate(({ BaseWindow }, [w, h]) => BaseWindow.getAllWindows()[0].setContentSize(w, h), [W, H])
  await chrome("document.querySelector('[data-testid=safety-ack]')?.click()")
  await sleep(600)

  // Open the letter whose feed title matches.
  const opened = await chrome(`(() => {
    const row = [...document.querySelectorAll('.sh-feed .sh-feed-item')].find((i) =>
      (i.querySelector('[data-testid=feed-title]')?.textContent ?? '').toLowerCase().includes(${JSON.stringify(wanted)}))
    if (!row) return null
    row.click()
    return row.querySelector('[data-testid=feed-title]').textContent
  })()`)
  if (!opened) throw new Error(`no letter in ${who}'s feed with a title containing "${wanted}"`)
  await sleep(2500)

  const views = await app.evaluate(async ({ BaseWindow }) => {
    const out = []
    for (const v of BaseWindow.getAllWindows()[0].contentView.children) {
      if (typeof v.getVisible === 'function' && !v.getVisible()) continue
      out.push({ b: v.getBounds(), png: (await v.webContents.capturePage()).toPNG().toString('base64') })
    }
    return out
  })

  // Lay the views together exactly where the window puts them.
  const layers = views
    .map((v) => `<img style="position:absolute;left:${v.b.x}px;top:${v.b.y}px;width:${v.b.width}px;height:${v.b.height}px" src="data:image/png;base64,${v.png}">`)
    .join('')
  const shots = await app.evaluate(
    async ({ BrowserWindow }, [html, w, h]) => {
      const win = new BrowserWindow({ width: w, height: h, show: false, useContentSize: true, webPreferences: { offscreen: true } })
      await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
      await new Promise((r) => setTimeout(r, 500))
      const img = await win.webContents.capturePage()
      win.destroy()
      // JPEG: a third smaller than PNG here, and the site ships exactly one image.
      return { jpg: img.toJPEG(86).toString('base64') }
    },
    [`<body style="margin:0;background:#08080a;width:${W}px;height:${H}px;overflow:hidden">${layers}</body>`, W, H]
  )
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'app.jpg'), Buffer.from(shots.jpg, 'base64'))
  console.log(`opened: ${opened}`)
  console.log(`wrote site/public/img/app.jpg (${Math.round((shots.jpg.length * 3) / 4 / 1024)} KB), ${W}×${H}`)
} finally {
  await app.close().catch(() => {})
  rmSync(profile, { recursive: true, force: true })
}
