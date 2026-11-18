import articleHtml from '../../../samples/article.html?raw'
import cardHtml from '../../../samples/card.html?raw'
import commentHtml from '../../../samples/comment.html?raw'
import contractHtml from '../../../samples/contract.html?raw'
import attestationHtml from '../../../samples/attestation.html?raw'
import ballotHtml from '../../../samples/ballot.html?raw'
import ballotCloseHtml from '../../../samples/ballot-close.html?raw'
import ballotVoteHtml from '../../../samples/ballot-vote.html?raw'
import groupHtml from '../../../samples/group.html?raw'
import inviteHtml from '../../../samples/invite.html?raw'
import joinRequestHtml from '../../../samples/join-request.html?raw'
import invoiceHtml from '../../../samples/invoice.html?raw'
import memoHtml from '../../../samples/memo.html?raw'
import passportHtml from '../../../samples/passport.html?raw'
import passportProofHtml from '../../../samples/passport-proof.html?raw'
import nametagHtml from '../../../samples/nametag.html?raw'
import posterHtml from '../../../samples/poster.html?raw'
import postHtml from '../../../samples/post.html?raw'
import todoHtml from '../../../samples/todo.html?raw'
import voteHtml from '../../../samples/vote.html?raw'
import vouchHtml from '../../../samples/vouch.html?raw'

// ── Built-in starter programs ────────────────────────────────────────────────
// The sample programs, shipped INSIDE the app so "New → Nametag" works on a
// fresh install with nothing in the library yet.
//
// They are inlined at BUILD time via vite's `?raw`, which means: no runtime
// file reads, no packaging rules to keep in sync (electron-builder already
// ships out/**), and dev / built / asar are literally the same code path.
// samples/*.html stays the single source of truth — the unit test asserts
// these strings still byte-match the files on disk, so a starter can never
// silently drift from the sample everyone else reads.

export interface Starter {
  /** Stable menu key: `starter:<name>`. */
  key: string
  /** The manifest type a new instance is created with. */
  type: string
  label: string
  description: string
  html: string
}

export const STARTERS: readonly Starter[] = [
  {
    key: 'starter:nametag',
    type: 'nametag',
    label: 'Name tag',
    description: 'A name, in big letters.',
    html: nametagHtml
  },
  {
    key: 'starter:card',
    type: 'card',
    label: 'Contact card',
    description: 'Name, role, and how to reach you.',
    html: cardHtml
  },
  {
    key: 'starter:memo',
    type: 'memo',
    label: 'Memo',
    description: 'To, from, subject, message.',
    html: memoHtml
  },
  {
    key: 'starter:invite',
    type: 'invite',
    label: 'Invitation',
    description: 'An event, with the date shown in the reader’s locale.',
    html: inviteHtml
  },
  {
    key: 'starter:group',
    type: 'group',
    label: 'Group',
    description: 'A roster of people, amended by publishing a new version.',
    html: groupHtml
  },
  {
    key: 'starter:invoice',
    type: 'invoice',
    label: 'Invoice',
    description: 'A demand for payment: parties, line items, tax, and what is due.',
    html: invoiceHtml
  },
  {
    key: 'starter:todo',
    type: 'todo',
    label: 'To-do list',
    description: 'A list of things to check off.',
    html: todoHtml
  },
  {
    key: 'starter:article',
    type: 'article',
    label: 'News article',
    description: 'Headings, images text wraps around, footnotes.',
    html: articleHtml
  },
  {
    key: 'starter:post',
    type: 'post',
    label: 'Forum post',
    description: 'A title, and a link or some text. Small enough to travel whole.',
    html: postHtml
  },
  {
    key: 'starter:comment',
    type: 'comment',
    label: 'Comment',
    description: 'Say something about another letter.',
    html: commentHtml
  },
  {
    key: 'starter:attestation',
    type: 'attestation',
    label: 'Attestation',
    description: 'Put your signature behind a statement about another letter.',
    html: attestationHtml
  },
  {
    key: 'starter:contract',
    type: 'contract',
    label: 'Contract',
    description: 'A document several people sign — parties, witnesses, and their signatures.',
    html: contractHtml
  },
  {
    key: 'starter:vote',
    type: 'vote',
    label: 'Vote',
    description: 'One key, for or against one letter. Usually cast with ▲ ▼ rather than made here.',
    html: voteHtml
  },
  {
    key: 'starter:join-request',
    type: 'join-request',
    label: 'Request to join',
    description: 'Ask a group’s keeper to put you on the roster. Asking is not joining.',
    html: joinRequestHtml
  },
  {
    key: 'starter:passport',
    type: 'passport',
    label: 'Passport',
    description: 'A passport chip reading, checked by Souspli. Shows the holder’s full details: send it privately.',
    html: passportHtml
  },
  {
    key: 'starter:passport-proof',
    type: 'passport-proof',
    label: 'Passport proof',
    description: 'Proves facts from a passport, such as “over 18” or “a citizen of Canada”, without showing the passport.',
    html: passportProofHtml
  },
  {
    key: 'starter:ballot',
    type: 'ballot',
    label: 'Secret ballot',
    description: 'A question put to everyone whose passport meets a rule. One passport, one vote, no names; named witnesses close it.',
    html: ballotHtml
  },
  {
    key: 'starter:ballot-vote',
    type: 'ballot-vote',
    label: 'Ballot vote',
    description: 'One vote in a secret ballot. Cast from the ballot’s header, under a one-time key.',
    html: ballotVoteHtml
  },
  {
    key: 'starter:ballot-close',
    type: 'ballot-close',
    label: 'Ballot closing',
    description: 'A witness’s list of the votes it held when a ballot closed. Made from the ballot’s header.',
    html: ballotCloseHtml
  },
  {
    key: 'starter:vouch',
    type: 'vouch',
    label: 'Vouch',
    description: 'Say that you know someone’s key, and what you call them.',
    html: vouchHtml
  },
  {
    key: 'starter:poster',
    type: 'poster',
    label: 'Poster',
    description: 'A picture with a title and caption.',
    html: posterHtml
  }
]

export function starterBytes(s: Starter): Uint8Array {
  return new TextEncoder().encode(s.html)
}

export function starterByKey(key: string): Starter | null {
  return STARTERS.find((s) => s.key === key) ?? null
}
