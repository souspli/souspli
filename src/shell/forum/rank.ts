// ── Ranking a forum the way a link aggregator does ───────────────────────────
//
// Pure on purpose (no sqlite, no Electron) so it is unit-tested directly.
//
// Points are raw upvotes. They are free to manufacture -- a thousand keys
// cost nothing -- and this view says so in the docs rather than pretending
// otherwise: spam resistance is a later problem, and the tribe-weighted
// ranking in the older forum view is still there for anyone who wants it.

/** When a post can be said to have appeared, in ms.
 *
 *  `created` is the author's claim (whole seconds) and `receivedAt` is when it
 *  reached this machine (ms). The earlier of the two: an author who dates a
 *  post into the future does not get to sit on the front page forever, and a
 *  post fetched long after it was written is not "new" just because it
 *  arrived now -- the first sync after joining receives months at once. */
export function firstSeen(createdSec: number, receivedAtMs: number): number {
  const claimed = createdSec > 0 ? createdSec * 1000 : Infinity
  return Math.min(claimed, receivedAtMs)
}

/** Hacker News's gravity: points over age, so a post rises with votes and
 *  sinks with time. Age in hours, offset by 2 so a brand-new post with one
 *  vote does not beat everything. */
export function hotness(points: number, ageMs: number): number {
  const hours = Math.max(0, ageMs) / 3_600_000
  return points / Math.pow(hours + 2, 1.8)
}

export interface Rankable {
  points: number
  firstSeen: number
}

/** `top`: by hotness, newer first on a tie. `new`: newest first. */
export function rank<T extends Rankable>(rows: T[], sort: 'top' | 'new', now: number): T[] {
  const out = [...rows]
  if (sort === 'new') return out.sort((a, b) => b.firstSeen - a.firstSeen)
  return out.sort((a, b) => {
    const d = hotness(b.points, now - b.firstSeen) - hotness(a.points, now - a.firstSeen)
    return d !== 0 ? d : b.firstSeen - a.firstSeen
  })
}
