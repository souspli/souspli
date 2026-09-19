// souspli.org. The pages ARE ../docs — one source of truth, readable on GitHub
// and here. This config only adds a layout, turns relative .md links into URLs,
// and mounts the landing page. No client-side JavaScript is emitted, and
// scripts/check.mjs fails the build if any ever is.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const docsRoot = path.join(repoRoot, 'docs')
const REPO_URL = 'https://github.com/souspli/souspli'

/** docs-relative source path -> site URL. `index.md` is its directory. */
function urlFor(docsRel) {
  const noExt = docsRel.replace(/\.md$/, '')
  if (noExt === 'index') return '/docs/'
  if (noExt.endsWith('/index')) return `/${noExt.slice(0, -'/index'.length)}/`
  return `/${noExt}/`
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ 'public': '/' })
  eleventyConfig.addGlobalData('layout', 'base.njk')

  // The landing page is the one page that is not a doc. It lives in site/ and
  // is mounted as a virtual template so docs/ stays free of site machinery.
  eleventyConfig.addTemplate('_landing.njk', fs.readFileSync(path.join(here, 'pages/index.njk'), 'utf8'), {
    permalink: '/index.html',
    landing: true
  })
  eleventyConfig.addGlobalData('repoUrl', REPO_URL)

  eleventyConfig.addGlobalData('eleventyComputed', {
    // The docs carry no front matter (they must read cleanly on GitHub), so
    // the title is the first H1 and the URL follows the file's place in docs/.
    title: (data) => {
      if (data.title) return data.title
      try {
        return /^#\s+(.+)$/m.exec(fs.readFileSync(data.page.inputPath, 'utf8'))?.[1] ?? 'Souspli'
      } catch {
        return 'Souspli' // a virtual template has no file to read
      }
    },
    permalink: (data) => {
      if (data.permalink) return data.permalink
      const abs = path.resolve(data.page.inputPath)
      if (!abs.startsWith(docsRoot + path.sep)) return undefined
      return urlFor(path.relative(docsRoot, abs).split(path.sep).join('/')) + 'index.html'
    },
    section: (data) => {
      const abs = path.resolve(data.page.inputPath)
      if (!abs.startsWith(docsRoot + path.sep)) return ''
      const first = path.relative(docsRoot, abs).split(path.sep)[0]
      return first.endsWith('.md') ? '' : first
    },
    sourcePath: (data) => path.relative(repoRoot, path.resolve(data.page.inputPath)).split(path.sep).join('/')
  })

  // Relative links in the markdown point at .md files so they work on GitHub.
  // Here they become site URLs; links that leave docs/ (source files, READMEs)
  // go to the repository instead.
  eleventyConfig.addTransform('md-links', function (content) {
    if (!(this.page.outputPath || '').endsWith('.html')) return content
    const srcAbs = path.resolve(this.page.inputPath)
    return content.replace(/href="([^"]+)"/g, (whole, href) => {
      if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return whole
      const [rel, hash = ''] = href.split('#')
      const target = path.resolve(path.dirname(srcAbs), rel)
      const frag = hash ? `#${hash}` : ''
      if (target.startsWith(docsRoot + path.sep) && target.endsWith('.md')) {
        return `href="${urlFor(path.relative(docsRoot, target).split(path.sep).join('/'))}${frag}"`
      }
      const fromRepo = path.relative(repoRoot, target).split(path.sep).join('/')
      return `href="${REPO_URL}/blob/master/${fromRepo}${frag}"`
    })
  })

  // Wide tables and code scroll inside themselves, never the page.
  eleventyConfig.addTransform('table-wrap', function (content) {
    if (!(this.page.outputPath || '').endsWith('.html')) return content
    return content.replace(/<table>/g, '<div class="scroll"><table>').replace(/<\/table>/g, '</table></div>')
  })

  return {
    dir: { input: '../docs', includes: '../site/_includes', output: '_dist' },
    markdownTemplateEngine: false,
    htmlTemplateEngine: false
  }
}
