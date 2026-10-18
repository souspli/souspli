// ── The community forum, as a page ───────────────────────────────────────────
//
// A Hacker News-shaped view of the one community forum: a ranked front page,
// newest, an item page with nested comments, and a submit form. It takes the
// whole window below the omnibar, and while it is up the cage views are
// hidden (shell.overlay), so everything here is trusted chrome.
//
// What crosses in from letters is text only: titles and bodies arrive already
// sanitized by main (title.ts) and are set with textContent, never markup.
// Names are the author's own choice and are shown as such, with the key one
// hover away. A post's link is opened by main, from the post, never from a URL
// held here.

export interface ForumRow {
  envelopeHash: string
  type: string
  title: string | null
  url: string | null
  domain: string | null
  text: string | null
  points: number
  voted: boolean
  authorKey: string
  name: string | null
  isMe: boolean
  firstSeen: number
  comments?: number
  verdict: { verdict: string; byName?: string; by?: string; why?: string } | null
  parent?: string
  depth?: number
}

interface ForumStateOut {
  joined?: string | null
  forumName?: string | null
  name?: string | null
  error?: string
}

export interface ForumApi {
  forumState(): Promise<Record<string, unknown>>
  forumJoin(name: string): Promise<Record<string, unknown>>
  forumFront(sort: 'top' | 'new'): Promise<Record<string, unknown>>
  forumItem(envelopeHash: string): Promise<Record<string, unknown>>
  forumSubmit(input: Record<string, unknown>): Promise<Record<string, unknown>>
  forumOpenLink(envelopeHash: string): Promise<boolean>
  vote(envelopeHash: string, dir: 1 | -1 | 0): Promise<Record<string, unknown>>
  overlay(delta: number): void
}

export interface ForumDeps {
  shell: ForumApi
  /** Hide the rest of the layout while the page is up, and bring it back. */
  setVisible(on: boolean): void
  /** Open a letter in the sealed view (leaves the forum page). */
  openLetter(envelopeHash: string): void
  notify(msg: string, tone: 'success' | 'danger' | 'neutral'): void
  shortKey(key: string): string
  fullKey(key: string): string
  /** First run waits on the join card: called once it is settled, with
   *  whether the person joined (false: they chose Not now). */
  onJoinSettled?(joined: boolean): void
}

type Route = { page: 'top' } | { page: 'new' } | { page: 'item'; hash: string } | { page: 'submit' }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** "3 hours ago", the way HN says it. */
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000))
  const unit = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'} ago`
  if (s < 60) return 'just now'
  if (s < 3600) return unit(Math.floor(s / 60), 'minute')
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour')
  if (s < 86400 * 30) return unit(Math.floor(s / 86400), 'day')
  if (s < 86400 * 365) return unit(Math.floor(s / (86400 * 30)), 'month')
  return unit(Math.floor(s / (86400 * 365)), 'year')
}

export function createForumPage(deps: ForumDeps): { root: HTMLElement; open(route?: Route): Promise<void>; close(): void; refresh(): void; isOpen(): boolean } {
  const { shell } = deps
  const root = el('section', 'hn-page')
  root.setAttribute('data-testid', 'forum-page')
  root.hidden = true
  const bar = el('div', 'hn-bar')
  const body = el('div', 'hn-body')
  root.append(bar, body)

  let route: Route = { page: 'top' }
  let open = false
  let state: ForumStateOut = {}
  let stale = false

  const link = (text: string, onClick: () => void, testid?: string): HTMLAnchorElement => {
    const a = el('a', 'hn-link', text)
    a.href = '#'
    if (testid) a.setAttribute('data-testid', testid)
    a.addEventListener('click', (e) => {
      e.preventDefault()
      onClick()
    })
    return a
  }

  const who = (r: ForumRow): HTMLElement => {
    const span = el('span', r.name ? 'hn-user' : 'hn-user hn-user--key', r.name ?? deps.shortKey(r.authorKey))
    span.title = `${r.name ? 'A name they chose for themselves, not verified.\n' : ''}${deps.fullKey(r.authorKey)}`
    if (r.isMe) span.classList.add('hn-user--me')
    return span
  }

  const go = (next: Route): void => {
    route = next
    void render()
  }

  function renderBar(): void {
    bar.replaceChildren()
    const brand = el('span', 'hn-brand', state.forumName || 'Forum')
    brand.addEventListener('click', () => go({ page: 'top' }))
    bar.append(brand)
    if (state.joined) {
      const nav = el('span', 'hn-nav')
      nav.append(
        link('new', () => go({ page: 'new' }), 'forum-nav-new'),
        document.createTextNode(' | '),
        link('submit', () => go({ page: 'submit' }), 'forum-nav-submit')
      )
      bar.append(nav)
    }
    bar.append(el('span', 'hn-spacer'))
    if (stale) bar.append(link('↻ new activity', () => { stale = false; void render() }, 'forum-stale'))
    if (state.name) bar.append(el('span', 'hn-me', state.name))
  }

  // ── Pages ──────────────────────────────────────────────────────────────────

  function joinPage(): HTMLElement {
    const box = el('div', 'hn-join')
    box.setAttribute('data-testid', 'forum-join-card')
    const name = el('input', 'hn-input')
    name.placeholder = 'a name people will see'
    name.maxLength = 32
    name.setAttribute('data-testid', 'forum-join-name')
    const btn = el('button', 'hn-button', `Join ${state.forumName || 'the forum'}`)
    btn.setAttribute('data-testid', 'forum-join-go')
    const err = el('div', 'hn-error')
    const submit = async (): Promise<void> => {
      if (!name.value.trim()) {
        err.textContent = 'Choose a name first.'
        return
      }
      btn.disabled = true
      const r = await shell.forumJoin(name.value)
      btn.disabled = false
      if (typeof r.error === 'string') {
        err.textContent = r.error
        return
      }
      state = r as ForumStateOut
      go({ page: 'top' })
      deps.onJoinSettled?.(true)
    }
    btn.addEventListener('click', () => void submit())
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit()
    })
    box.append(
      el('h2', undefined, `Join ${state.forumName || 'the community forum'}`),
      el('p', undefined, 'Post, comment and upvote with everyone else using Souspli.'),
      el('label', 'hn-label', 'Your name'),
      name,
      el(
        'p',
        'hn-cost',
        'Joining connects to the project’s relay, which learns your IP address. Your name, posts, comments and upvotes are public, signed by your key, and cannot be unsaid. After this, posting and voting go out without asking again.'
      ),
      btn,
      link('Not now', () => deps.onJoinSettled?.(false), 'forum-join-later'),
      err
    )
    setTimeout(() => name.focus(), 0)
    return box
  }

  function voteArrow(r: ForumRow, after: () => void): HTMLElement {
    const cell = el('span', 'hn-vote')
    if (r.isMe || r.voted) return cell // HN: nothing to press on your own, or once pressed
    const up = el('a', 'hn-arrow', '▲')
    up.href = '#'
    up.title = 'upvote'
    up.setAttribute('data-testid', 'forum-upvote')
    up.addEventListener('click', async (e) => {
      e.preventDefault()
      const res = await shell.vote(r.envelopeHash, 1)
      if (typeof res.error === 'string') deps.notify(res.error, 'danger')
      after()
    })
    cell.append(up)
    return cell
  }

  function subtext(r: ForumRow, now: number, opts: { comments: boolean }): HTMLElement {
    const sub = el('div', 'hn-sub')
    sub.append(
      el('span', 'hn-points', `${r.points} point${r.points === 1 ? '' : 's'}`),
      document.createTextNode(' by '),
      who(r),
      document.createTextNode(` ${ago(r.firstSeen, now)}`)
    )
    if (r.voted) {
      sub.append(
        document.createTextNode(' | '),
        link('unvote', async () => {
          const res = await shell.vote(r.envelopeHash, 0)
          if (typeof res.error === 'string') deps.notify(res.error, 'danger')
          void render()
        }, 'forum-unvote')
      )
    }
    if (opts.comments) {
      const n = r.comments ?? 0
      sub.append(document.createTextNode(' | '), link(n === 0 ? 'discuss' : `${n} comment${n === 1 ? '' : 's'}`, () => go({ page: 'item', hash: r.envelopeHash }), 'forum-comments'))
    }
    sub.append(document.createTextNode(' | '), link('letter', () => deps.openLetter(r.envelopeHash), 'forum-open-letter'))
    return sub
  }

  function titleLine(r: ForumRow): HTMLElement {
    const line = el('span', 'hn-titleline')
    const t = link(r.title || '(untitled)', () => {
      if (r.url) void shell.forumOpenLink(r.envelopeHash)
      else go({ page: 'item', hash: r.envelopeHash })
    }, 'forum-title')
    if (r.url) t.title = r.url
    line.append(t)
    if (r.domain) line.append(el('span', 'hn-domain', ` (${r.domain})`))
    if (r.type !== 'post' && r.type !== 'comment') line.append(el('span', 'hn-type', ` [${r.type}]`))
    return line
  }

  /** A moderator's hide folds the row, with who and why, one click from shown. */
  function folded(r: ForumRow, show: () => void): HTMLElement | null {
    if (r.verdict?.verdict !== 'hide') return null
    const f = el('div', 'hn-folded')
    f.append(
      document.createTextNode(`[hidden by ${r.verdict.byName || 'a moderator'}${r.verdict.why ? `: ${r.verdict.why}` : ''}] `),
      link('show', show)
    )
    return f
  }

  async function listPage(sort: 'top' | 'new'): Promise<HTMLElement> {
    const res = (await shell.forumFront(sort)) as { rows?: ForumRow[]; now?: number; error?: string }
    const list = el('ol', 'hn-list')
    list.setAttribute('data-testid', 'forum-list')
    const now = res.now ?? Date.now()
    const rows = res.rows ?? []
    if (rows.length === 0) {
      const empty = el('div', 'hn-empty')
      empty.append(document.createTextNode('Nothing here yet. '), link('Be the first to post.', () => go({ page: 'submit' })))
      return empty
    }
    rows.forEach((r, i) => {
      const li = el('li', 'hn-row')
      li.setAttribute('data-testid', 'forum-row')
      li.dataset.hash = r.envelopeHash
      const paint = (forceShow = false): void => {
        li.replaceChildren(el('span', 'hn-rank', `${i + 1}.`))
        const hidden = forceShow ? null : folded(r, () => paint(true))
        if (hidden) {
          li.append(hidden)
          return
        }
        const main = el('div', 'hn-main')
        main.append(titleLine(r), subtext(r, now, { comments: true }))
        li.append(voteArrow(r, () => void render()), main)
      }
      paint()
      list.append(li)
    })
    return list
  }

  function replyBox(replyTo: string, label: string, onDone: () => void, testid: string): HTMLElement {
    const box = el('div', 'hn-reply')
    const ta = el('textarea', 'hn-textarea')
    ta.setAttribute('data-testid', `${testid}-text`)
    const btn = el('button', 'hn-button', label)
    btn.setAttribute('data-testid', `${testid}-go`)
    btn.addEventListener('click', async () => {
      if (!ta.value.trim()) return
      btn.disabled = true
      const r = await shell.forumSubmit({ kind: 'comment', replyTo, body: ta.value })
      btn.disabled = false
      if (typeof r.error === 'string') {
        deps.notify(r.error, 'danger')
        return
      }
      ta.value = ''
      onDone()
    })
    box.append(ta, btn)
    return box
  }

  async function itemPage(hash: string): Promise<HTMLElement> {
    const res = (await shell.forumItem(hash)) as { story?: ForumRow; comments?: ForumRow[]; now?: number; error?: string }
    const page = el('div', 'hn-item')
    if (!res.story) {
      page.append(el('div', 'hn-empty', res.error ?? 'Not found.'))
      return page
    }
    const now = res.now ?? Date.now()
    const s = res.story
    const head = el('div', 'hn-row hn-story')
    head.setAttribute('data-testid', 'forum-story')
    const main = el('div', 'hn-main')
    main.append(titleLine(s), subtext(s, now, { comments: false }))
    head.append(voteArrow(s, () => void render()), main)
    page.append(head)
    if (s.text) {
      const t = el('div', 'hn-text', s.text)
      t.setAttribute('data-testid', 'forum-story-text')
      page.append(t)
    }
    page.append(replyBox(s.envelopeHash, 'add comment', () => void render(), 'forum-comment'))

    // Nested comments, in thread order, each indented by its depth. [–]
    // collapses a comment and everything under it.
    const tree = el('div', 'hn-comments')
    tree.setAttribute('data-testid', 'forum-thread')
    const comments = res.comments ?? []
    const childrenOf = new Map<string, ForumRow[]>()
    for (const c of comments) {
      const list = childrenOf.get(c.parent ?? '') ?? []
      list.push(c)
      childrenOf.set(c.parent ?? '', list)
    }
    const draw = (parent: string, into: HTMLElement): void => {
      for (const c of childrenOf.get(parent) ?? []) {
        const wrap = el('div', 'hn-comment')
        wrap.setAttribute('data-testid', 'forum-comment')
        wrap.dataset.hash = c.envelopeHash
        wrap.style.marginLeft = `${Math.min((c.depth ?? 1) - 1, 10) * 24}px`
        const head2 = el('div', 'hn-chead')
        const kids = el('div', 'hn-kids')
        const toggle = el('a', 'hn-toggle', '[–]')
        toggle.href = '#'
        const content = el('div', 'hn-ccontent')
        toggle.addEventListener('click', (e) => {
          e.preventDefault()
          const shut = !content.hidden
          content.hidden = shut
          kids.hidden = shut
          toggle.textContent = shut ? `[+${countUnder(c.envelopeHash) + 1}]` : '[–]'
        })
        head2.append(voteArrow(c, () => void render()), who(c), document.createTextNode(` ${ago(c.firstSeen, now)} `))
        if (c.voted) head2.append(link('unvote', async () => { await shell.vote(c.envelopeHash, 0); void render() }, 'forum-unvote'), document.createTextNode(' '))
        head2.append(toggle)
        const hidden = folded(c, () => {
          hidden?.remove()
          content.hidden = false
        })
        const text = el('div', 'hn-text', c.text ?? '')
        text.setAttribute('data-testid', 'forum-comment-body')
        const actions = el('div', 'hn-actions')
        let open = false
        actions.append(link('reply', () => {
          if (open) return
          open = true
          actions.append(replyBox(c.envelopeHash, 'reply', () => void render(), 'forum-reply'))
        }, 'forum-reply-open'))
        content.append(text, actions)
        if (hidden) content.hidden = true
        wrap.append(head2, ...(hidden ? [hidden] : []), content)
        into.append(wrap, kids)
        draw(c.envelopeHash, kids)
      }
    }
    const countUnder = (h: string): number => (childrenOf.get(h) ?? []).reduce((n, k) => n + 1 + countUnder(k.envelopeHash), 0)
    draw(s.envelopeHash, tree)
    page.append(tree)
    return page
  }

  function submitPage(): HTMLElement {
    const form = el('div', 'hn-submit')
    form.setAttribute('data-testid', 'forum-submit')
    const title = el('input', 'hn-input')
    title.maxLength = 80
    title.setAttribute('data-testid', 'forum-submit-title')
    const url = el('input', 'hn-input')
    url.placeholder = 'https://…'
    url.setAttribute('data-testid', 'forum-submit-url')
    const text = el('textarea', 'hn-textarea')
    text.setAttribute('data-testid', 'forum-submit-text')
    const btn = el('button', 'hn-button', 'submit')
    btn.setAttribute('data-testid', 'forum-submit-go')
    const err = el('div', 'hn-error')
    btn.addEventListener('click', async () => {
      btn.disabled = true
      const r = await shell.forumSubmit({ kind: 'post', title: title.value, url: url.value, text: text.value })
      btn.disabled = false
      if (typeof r.error === 'string') {
        err.textContent = r.error
        return
      }
      go({ page: 'new' })
    })
    form.append(
      el('label', 'hn-label', 'title'), title,
      el('label', 'hn-label', 'url'), url,
      el('label', 'hn-label', 'text'), text,
      el('p', 'hn-cost', 'Leave url blank to start a discussion. Your post is signed by you and public.'),
      btn, err
    )
    setTimeout(() => title.focus(), 0)
    return form
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  const typing = (): boolean =>
    [...root.querySelectorAll('textarea, input')].some((f) => (f as HTMLInputElement).value.trim() !== '')

  let rendering = 0
  /** `background`: a live update nobody asked for. It may not replace a page
   *  someone has started typing into -- checked again just before the swap,
   *  because typing can start while the new page is still being fetched. */
  async function render(opts: { background?: boolean } = {}): Promise<void> {
    const mine = ++rendering
    if (!opts.background) stale = false
    state = (await shell.forumState()) as ForumStateOut
    let content: HTMLElement
    if (!state.joined) content = joinPage()
    else if (route.page === 'item') content = await itemPage(route.hash)
    else if (route.page === 'submit') content = submitPage()
    else content = await listPage(route.page)
    if (mine !== rendering) return // a newer render started while this one awaited
    if (opts.background && typing()) {
      stale = true
      renderBar()
      return
    }
    stale = false
    renderBar()
    body.replaceChildren(content)
    root.dataset.page = state.joined ? route.page : 'join'
    body.scrollTop = route.page === 'item' ? body.scrollTop : 0
  }

  /** Live updates repaint, unless someone is mid-sentence: then the bar says
   *  there is news and waits to be asked. */
  let pending: ReturnType<typeof setTimeout> | null = null
  function refresh(): void {
    if (!open) return
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = null
      if (typing()) {
        stale = true
        renderBar()
      } else void render({ background: true })
    }, 400)
  }

  return {
    root,
    async open(next?: Route) {
      if (next) route = next
      if (!open) {
        open = true
        root.hidden = false
        deps.setVisible(true)
        shell.overlay(1)
      }
      await render()
    },
    close() {
      if (!open) return
      open = false
      root.hidden = true
      deps.setVisible(false)
      shell.overlay(-1)
    },
    refresh,
    isOpen: () => open
  }
}
