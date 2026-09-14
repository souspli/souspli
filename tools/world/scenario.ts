// The seeded world.
//
// Built so that opening any account shows something worth looking at, and so
// that the trust surfaces have real shape rather than a single hand-made case:
// a contract signed by everyone it names, one still waiting on two signatures,
// one carrying a signature it never asked for, an article with attestations
// that are partly inside your tribe and partly not, and a vouch graph with
// genuine one-hop, two-hop, and unreachable keys.

import { author, cosign, deliver, introduce, publish, type Delivered } from './author.js'
import type { OpenAccount } from './account.js'
import { ballast, posterArt, skyline } from './image.js'

const DAY = 86_400
/** A fixed base time so a rebuilt world has the same timestamps. 2026-06-01. */
const T0 = 1_780_272_000

type Cast = Record<string, OpenAccount>

const cast = (accounts: OpenAccount[]): Cast =>
  Object.fromEntries(accounts.map((a) => [a.who.slug, a])) as Cast

/** Who knows whom, by name. Petnames are local, so this is applied per library
 *  and is deliberately NOT symmetric -- knowing someone is not mutual. */
function introductions(c: Cast, log: (s: string) => void): void {
  const press = ['ada', 'grace', 'alan', 'katherine', 'dorothy', 'mary', 'joan', 'edith']
  const law = ['thurgood', 'sandra', 'ruth', 'oliver', 'clara', 'benjamin', 'ida']

  // Colleagues know each other by name.
  for (const group of [press, law]) {
    for (const a of group) {
      for (const b of group) {
        if (a !== b) introduce(c[a]!, c[b]!, 'colleague')
      }
    }
  }
  // The lease brings two groups together.
  for (const [a, b] of [
    ['ada', 'thurgood'],
    ['thurgood', 'ada'],
    ['rosalind', 'thurgood'],
    ['thurgood', 'rosalind'],
    ['linus', 'thurgood'],
    ['thurgood', 'linus'],
    ['rosalind', 'linus'],
    ['linus', 'rosalind']
  ] as [string, string][]) {
    introduce(c[a]!, c[b]!, 'the Vale Street lease')
  }
  // Freelancers are known to the editor who commissions them, and not to the
  // rest of the newsroom -- which is what makes a tribe two hops deep.
  for (const f of ['hedy', 'claude', 'emmy', 'srinivasa']) {
    introduce(c.ada!, c[f]!, 'commissioned')
    introduce(c[f]!, c.ada!, 'my editor')
  }
  log('  names: colleagues, the lease counterparties, and Ada’s freelancers')
}

/** Vouches: signed, public, and only meaningful along a path from YOU.
 *
 *  Shaped to produce all three cases in the UI -- keys you vouched for (1 hop),
 *  keys reached through them (2 hops), and strangers nobody you trust has ever
 *  vouched for, which must show no badge at all. */
async function vouches(c: Cast, log: (s: string) => void): Promise<void> {
  const edges: [string, string, string][] = [
    // Ada's own vouches: her newsroom and the lawyer she works with.
    ['ada', 'grace', 'reporter, five years'],
    ['ada', 'alan', 'reporter'],
    ['ada', 'katherine', 'checks my copy'],
    ['ada', 'thurgood', 'our solicitor'],
    // One hop further: what Ada's people vouch for becomes her 2-hop tribe.
    ['grace', 'mary', 'shoots for me'],
    ['grace', 'hedy', 'freelance, reliable'],
    ['alan', 'joan', 'desk'],
    ['katherine', 'dorothy', 'checks with me'],
    ['thurgood', 'sandra', 'partner'],
    ['thurgood', 'ruth', 'solicitor'],
    ['thurgood', 'rosalind', 'client'],
    // Three hops from Ada -- deliberately OUTSIDE her tribe, to prove the cap.
    ['sandra', 'clara', 'clerk'],
    ['ruth', 'benjamin', 'clerk'],
    ['mary', 'srinivasa', 'illustrator'],
    // A cluster with no path to Ada at all.
    ['linus', 'dorothyh', 'surveyor'],
    ['dorothyh', 'barbara', 'tenant']
  ]
  let n = 0
  for (const [from, to, relation] of edges) {
    const voucher = c[from]!
    const subject = c[to]!
    // Everyone who could plausibly hold it: the voucher, the subject, and the
    // voucher's own circle -- a vouch you never received cannot count for you.
    const holders = [voucher, subject, c.ada!, c.thurgood!]
    await publish(
      voucher,
      {
        type: 'vouch',
        created: T0 + n * 600,
        args: { about: subject.who.address, aboutScheme: 'eth-eip191', name: subject.who.name, relation, note: '' }
      },
      holders
    )
    n++
  }
  log(`  vouches: ${edges.length} signed (Ada reaches 1- and 2-hop keys; some clusters reach her not at all)`)
}

/** A contract everyone named actually signed. */
async function signedContract(c: Cast, log: (s: string) => void): Promise<Delivered> {
  const parties = [c.linus!, c.rosalind!]
  const witnesses = [c.thurgood!, c.ruth!]
  const all = [...parties, ...witnesses, c.ada!]
  const tar = await author(c.linus!, {
    type: 'contract',
    created: T0 + 3 * DAY,
    args: {
      title: 'Vale Street lease',
      body:
        'The landlord lets and the tenant takes the premises at 14 Vale Street for a term of twelve months ' +
        'from 1 July 2026, at a rent of £1,150 per calendar month payable in advance.\n\n' +
        'The tenant shall keep the interior in good repair, fair wear and tear excepted.',
      signers: [
        { key: c.linus!.who.address, scheme: 'eth-eip191', role: 'landlord', name: c.linus!.who.name },
        { key: c.rosalind!.who.address, scheme: 'eth-eip191', role: 'tenant', name: c.rosalind!.who.name },
        { key: c.thurgood!.who.address, scheme: 'eth-eip191', role: 'witness', name: c.thurgood!.who.name },
        { key: c.ruth!.who.address, scheme: 'eth-eip191', role: 'witness', name: c.ruth!.who.name }
      ]
    }
  })
  const out = deliver(tar, all)
  // Each named signatory adds their own envelope over the same manifest bytes.
  for (const [i, signer] of [c.rosalind!, c.thurgood!, c.ruth!].entries()) {
    deliver(await cosign(signer, tar, T0 + 3 * DAY + (i + 1) * 3600), all)
  }
  log('  contract: Vale Street lease — 4 of 4 signed')
  return out
}

/** One still waiting, so the "not a score" wording is on screen. */
async function pendingContract(c: Cast, log: (s: string) => void): Promise<void> {
  const all = [c.sandra!, c.thurgood!, c.barbara!, c.ada!]
  const tar = await author(c.sandra!, {
    type: 'contract',
    created: T0 + 5 * DAY,
    args: {
      title: 'Consultancy agreement — Harbour & Vale / B. McClintock',
      body:
        'The consultant shall provide advisory services on plant genetics matters arising in the ' +
        'firm’s agricultural practice, at a day rate to be agreed in writing before each engagement.',
      signers: [
        { key: c.sandra!.who.address, scheme: 'eth-eip191', role: 'partner', name: c.sandra!.who.name },
        { key: c.barbara!.who.address, scheme: 'eth-eip191', role: 'consultant', name: c.barbara!.who.name },
        { key: c.thurgood!.who.address, scheme: 'eth-eip191', role: 'witness', name: c.thurgood!.who.name },
        { key: c.oliver!.who.address, scheme: 'eth-eip191', role: 'witness', name: c.oliver!.who.name }
      ]
    }
  })
  deliver(tar, all)
  deliver(await cosign(c.barbara!, tar, T0 + 5 * DAY + 7200), all)
  log('  contract: consultancy — 2 of 4 signed (unsigned is not half-valid)')
}

/** And one carrying a signature nobody asked for. */
async function uninvitedSignature(c: Cast, log: (s: string) => void): Promise<void> {
  const all = [c.oliver!, c.clara!, c.kestrel!, c.ada!]
  const tar = await author(c.oliver!, {
    type: 'contract',
    created: T0 + 6 * DAY,
    args: {
      title: 'Deed of variation — Unit 4, Harbour Yard',
      body: 'The parties agree that clause 7 (assignment) is deleted and replaced as set out in the schedule.',
      signers: [
        { key: c.oliver!.who.address, scheme: 'eth-eip191', role: 'solicitor', name: c.oliver!.who.name },
        { key: c.clara!.who.address, scheme: 'eth-eip191', role: 'witness', name: c.clara!.who.name }
      ]
    }
  })
  deliver(tar, all)
  deliver(await cosign(c.clara!, tar, T0 + 6 * DAY + 3600), all)
  // Not named, and signing anyway. The signature is real; the document simply
  // never asked for it, and the shell says so rather than hiding it.
  deliver(await cosign(c.kestrel!, tar, T0 + 6 * DAY + 9000), all)
  log('  contract: deed of variation — 2 of 2 signed, plus 1 not named')
}

/** An article, and people putting their signature behind a claim about it. */
async function articleWithAttestations(c: Cast, log: (s: string) => void): Promise<void> {
  const readers = Object.values(c)
  const published = await publish(
    c.grace!,
    {
      type: 'article',
      created: T0 + 8 * DAY,
      args: {
        title: 'Harbour Yard redevelopment approved after two-year inquiry',
        deck: 'Councillors voted seven to four in favour, ending the longest planning inquiry in the borough’s history.',
        byline: c.grace!.who.name,
        publisher: 'Meridian Press',
        published: '2026-06-09',
        location: 'Harbour Yard',
        blocks: [
          { kind: 'paragraph', text: 'The committee approved the scheme on Tuesday evening after a hearing that ran past eleven o’clock.' },
          { kind: 'heading', text: 'What was decided' },
          { kind: 'paragraph', text: 'Consent covers 240 homes, a school, and the retention of the listed crane on the eastern quay.' },
          { kind: 'paragraph', text: 'Objectors have six weeks in which to seek judicial review.' }
        ]
      }
    },
    readers
  )

  // Three attesters Ada reaches through her own vouches, and two she does not:
  // the count is free to manufacture, the tribe half is not.
  const attesters: [OpenAccount, string][] = [
    [c.katherine!, 'Accurately reproduced from the original source'],
    [c.alan!, 'I witnessed this'],
    [c.mary!, 'I have read this'],
    [c.quill!, 'Accurately reproduced from the original source'],
    [c.marlow!, 'I have read this']
  ]
  for (const [i, [who, statement]] of attesters.entries()) {
    await publish(
      who,
      {
        type: 'attestation',
        created: T0 + 8 * DAY + (i + 1) * 5400,
        args: { attests: published.envelopeHash, statement, note: '' }
      },
      readers
    )
  }
  log('  article: Harbour Yard — 5 attestations, 3 of them in Ada’s tribe')
}

/** A roster that has actually been amended, so version history is visible
 *  rather than theoretical. Published twice: the second version writes one
 *  person out, which is the case the membership query exists to get right. */
async function group(c: Cast, log: (s: string) => void): Promise<void> {
  const press = ['ada', 'grace', 'alan', 'katherine', 'dorothy', 'mary', 'joan', 'edith'].map((k) => c[k]!)
  const member = (a: (typeof press)[number], role: string): Record<string, string> => ({
    key: a.who.address,
    scheme: 'eth-eip191',
    role,
    name: a.who.name
  })

  const v0 = await publish(
    c.ada!,
    {
      type: 'group',
      created: T0 + 2 * DAY,
      args: {
        name: 'Meridian Press — editorial',
        purpose: 'Everyone who files or edits copy.',
        members: [
          member(c.ada!, 'editor'),
          member(c.grace!, 'reporter'),
          member(c.alan!, 'reporter'),
          member(c.katherine!, 'fact-checker'),
          member(c.edith!, 'archivist')
        ],
        notes: ''
      }
    },
    press
  )

  // Edith moves to the archive and comes off the editorial roster; Dorothy and
  // Joan join. A new version, chained to the first.
  await deliver(
    await author(c.ada!, {
      type: 'group',
      created: T0 + 9 * DAY,
      args: {
        name: 'Meridian Press — editorial',
        purpose: 'Everyone who files or edits copy.',
        members: [
          member(c.ada!, 'editor'),
          member(c.grace!, 'reporter'),
          member(c.alan!, 'reporter'),
          member(c.katherine!, 'fact-checker'),
          member(c.dorothy!, 'fact-checker'),
          member(c.joan!, 'sub-editor')
        ],
        notes: 'Edith moved to the archive in June.'
      },
      chain: { path: v0.envelopeHash, seq: 1, prev: v0.envelopeHash }
    }),
    press
  )
  log('  group: editorial roster, amended once — Edith written out, two added')
}

/** Two forums, with enough in them to be worth reading.
 *
 *  The scenario is built around the property that is hard to believe until you
 *  watch it: the SAME forum ranks differently in different libraries. Four
 *  strangers can shout a listicle to the top of a raw count, and one person you
 *  actually vouched for voting against it puts it last -- in YOUR copy, with
 *  nobody's bytes having changed.
 *
 *  Everything else here is the texture that makes that legible: real posts
 *  rather than stage directions, a discussion deep enough to need threading,
 *  votes on the comments as well as the posts, both kinds of moderator verdict,
 *  somebody asking to get in, and one post too big to travel inline. */
async function forum(c: Cast, log: (s: string) => void): Promise<void> {
  const press = ['ada', 'grace', 'alan', 'katherine', 'dorothy', 'mary', 'joan', 'edith'].map((k) => c[k]!)
  const readers = [...press, c.linus!, c.thurgood!]
  const member = (a: OpenAccount, role: string): Record<string, string> => ({
    key: a.who.address,
    scheme: 'eth-eip191',
    role,
    name: a.who.name
  })

  // ── The wire: the press desk's own forum ─────────────────────────────────
  // Ada keeps it, Grace moderates. A moderator's whole authority is this line
  // in a roster, in the libraries that hold it.
  const wire = (
    await publish(
      c.ada!,
      {
        type: 'group',
        created: T0 + 11 * DAY,
        args: {
          name: 'Meridian Press — the wire',
          purpose: 'Anything worth the desk’s attention. Post it, argue about it, vote.',
          members: [
            member(c.ada!, 'founder'),
            member(c.grace!, 'moderator'),
            member(c.alan!, 'member'),
            member(c.katherine!, 'member'),
            member(c.mary!, 'member'),
            member(c.joan!, 'member')
          ],
          notes: 'Grace moderates. Being listed here is Ada’s claim, not your consent.'
        }
      },
      readers
    )
  ).envelopeHash

  const article = async (
    who: OpenAccount,
    at: number,
    args: Record<string, unknown>,
    attachments?: Map<string, { bytes: Uint8Array; mime?: string }>
  ): Promise<string> =>
    (
      await publish(
        who,
        { type: 'article', created: at, args: { ...args, inGroup: wire }, ...(attachments ? { attachments } : {}) },
        readers
      )
    ).envelopeHash

  const investigation = await article(c.katherine!, T0 + 11 * DAY + 3600, {
    title: 'The Harbour Yard figures do not add up',
    deck:
      'The developer’s own filings put the affordable-housing count 38 homes below what the committee was told.',
    byline: c.katherine!.who.name,
    publisher: 'Meridian Press',
    published: '2026-06-12',
    blocks: [
      {
        kind: 'paragraph',
        text: 'The scheme approved last week was presented to councillors as delivering 72 affordable homes out of 240. The developer’s filed viability assessment, published the same afternoon, counts 34.'
      },
      { kind: 'heading', text: 'Where the gap is' },
      {
        kind: 'paragraph',
        text: 'The difference is not a rounding error and it is not a dispute about definitions. Both documents use the same tenure categories. One counts the shared-ownership block on the eastern quay twice.'
      },
      {
        kind: 'subheading',
        text: 'What the committee was shown'
      },
      {
        kind: 'paragraph',
        text: 'The papers circulated before Tuesday’s hearing contained the higher figure and no working. Two councillors asked for the underlying schedule and were told it would follow.'
      },
      {
        kind: 'paragraph',
        text: 'It followed on Thursday, after the vote.'
      },
      {
        kind: 'footnote',
        text: 'Filed viability assessment, Harbour Yard (Phase 1), table 4.2. The borough’s copy is the one dated 3 June; an earlier draft circulated in May has different totals again.'
      }
    ]
  })

  const listicle = await article(c.mary!, T0 + 11 * DAY + 5400, {
    title: 'Ten tools every newsroom desk needs',
    deck: 'Number four is a notebook.',
    byline: c.mary!.who.name,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Every desk runs on the same handful of things, and most of them cost nothing. Here is the list, in no particular order, except the order that suits me.'
      },
      { kind: 'paragraph', text: 'One: a notebook. Two: a second notebook. Three: somebody who answers the phone after six.' },
      { kind: 'paragraph', text: 'The rest are in the affiliate links below, which is the real reason this exists.' }
    ]
  })

  // A photograph, so an article with media is in the world rather than assumed.
  const photo = skyline()
  const photoEssay = await article(
    c.alan!,
    T0 + 11 * DAY + 7200,
    {
      title: 'The crane goes in October',
      deck: 'Photographing Harbour Yard before the listed crane comes down.',
      byline: c.alan!.who.name,
      published: '2026-06-12',
      blocks: [
        {
          kind: 'paragraph',
          text: 'It has been on the eastern quay since 1953 and it is coming down in October, consent or no consent. I went at dusk on the last clear evening.'
        },
        {
          kind: 'image',
          name: 'img-1',
          alt: 'The Harbour Yard crane silhouetted against a dusk sky, lit windows behind it.',
          caption: 'Harbour Yard, the evening before the vote.',
          placement: 'right'
        },
        {
          kind: 'paragraph',
          text: 'The retention condition covers the structure, not the jib. Nobody at the hearing could say what that means in practice, which is roughly where the whole scheme sits.'
        },
        {
          kind: 'paragraph',
          text: 'Prints of the full set are going in the archive rather than anywhere commercial. Ask Edith.'
        }
      ]
    },
    new Map([['img-1', { bytes: new Uint8Array(photo), mime: 'image/png' }]])
  )

  const spam = await article(c.linus!, T0 + 11 * DAY + 9000, {
    title: 'BUY GOLD NOW — LIMITED WINDOW',
    deck: '',
    blocks: [{ kind: 'paragraph', text: 'Click here. Act fast. This will not be repeated.' }]
  })

  const vote = async (who: OpenAccount, on: string, dir: 1 | -1, at: number): Promise<void> => {
    await publish(who, { type: 'vote', created: at, args: { votesOn: on, dir } }, readers)
  }

  // Four keys nobody in the press has vouched for pile onto the listicle. Their
  // raw count is the biggest number in the forum and is worth nothing.
  const strangers = ['kestrel', 'marlow', 'vesper', 'quill'].map((k) => c[k]).filter(Boolean) as OpenAccount[]
  for (let i = 0; i < strangers.length; i++) {
    await vote(strangers[i]!, listicle, 1, T0 + 11 * DAY + 10_000 + i * 60)
  }
  // People Ada actually vouched for prefer the reporting.
  await vote(c.grace!, investigation, 1, T0 + 11 * DAY + 11_000)
  await vote(c.alan!, investigation, 1, T0 + 11 * DAY + 11_100)
  await vote(c.joan!, investigation, 1, T0 + 11 * DAY + 11_150)
  await vote(c.katherine!, listicle, -1, T0 + 11 * DAY + 11_200)
  await vote(c.dorothy!, photoEssay, 1, T0 + 11 * DAY + 11_300)
  await vote(c.grace!, photoEssay, 1, T0 + 11 * DAY + 11_350)

  // ── A discussion worth threading ─────────────────────────────────────────
  const reply = async (
    who: OpenAccount,
    to: string,
    body: string,
    at: number,
    group = wire
  ): Promise<string> =>
    (
      await publish(who, { type: 'comment', created: at, args: { body, replyTo: to, inGroup: group } }, readers)
    ).envelopeHash

  const q1 = await reply(
    c.alan!,
    investigation,
    'Which filing exactly? The Q2 assessment was restated in May and the borough’s copy is the later one.',
    T0 + 11 * DAY + 12_000
  )
  const q1a = await reply(
    c.katherine!,
    q1,
    'Both, and that is the point. The May draft says 41, the June one says 34, and the committee papers say 72. Only one of those was in front of anybody who voted.',
    T0 + 11 * DAY + 12_600
  )
  const q1b = await reply(
    c.dorothy!,
    q1a,
    'Checked the June filing against the tenure schedule this morning. The eastern quay block is in there twice — once as shared ownership, once as intermediate rent. Same 19 units.',
    T0 + 11 * DAY + 13_200
  )
  await reply(
    c.alan!,
    q1b,
    'That accounts for the whole gap then. Worth putting the schedule itself up as an attachment.',
    T0 + 11 * DAY + 13_800
  )
  const q2 = await reply(
    c.joan!,
    investigation,
    'Has anyone put this to the developer? A line from them before this runs would save an awkward correction after.',
    T0 + 11 * DAY + 14_400
  )
  await reply(
    c.katherine!,
    q2,
    'Asked on Wednesday. No reply yet. Running it Friday either way, with the gap in the standfirst.',
    T0 + 11 * DAY + 15_000
  )
  await reply(
    c.edith!,
    photoEssay,
    'The 1953 date is from the harbour board minutes, not the listing. The listing says 1955 and is wrong.',
    T0 + 11 * DAY + 15_600
  )

  // Votes on the COMMENTS, not only the posts — so a thread has an order too,
  // and the same tribe weighting decides it.
  await vote(c.katherine!, q1b, 1, T0 + 11 * DAY + 16_000)
  await vote(c.grace!, q1b, 1, T0 + 11 * DAY + 16_100)
  await vote(c.ada!, q1b, 1, T0 + 11 * DAY + 16_150)
  await vote(c.alan!, q2, 1, T0 + 11 * DAY + 16_200)
  for (let i = 0; i < strangers.length; i++) {
    await vote(strangers[i]!, q1, 1, T0 + 11 * DAY + 16_300 + i * 30)
  }

  // ── Moderation: both verdicts ────────────────────────────────────────────
  // Hidden, not deleted. Every library still holds it and every reader can
  // press "show anyway" — which is the difference between a forum and a
  // memory hole.
  await publish(
    c.grace!,
    {
      type: 'attestation',
      created: T0 + 11 * DAY + 17_000,
      args: {
        attests: spam,
        inGroup: wire,
        verdict: 'hide',
        statement: 'Off topic and selling something.'
      }
    },
    readers
  )
  await publish(
    c.grace!,
    {
      type: 'attestation',
      created: T0 + 11 * DAY + 17_600,
      args: {
        attests: investigation,
        inGroup: wire,
        verdict: 'endorse',
        statement: 'Checked against the filings. Desk stands behind this one.'
      }
    },
    readers
  )

  // Somebody outside asks to get in. It stays pending because the ROSTER is
  // what decides, and nobody has written them into one.
  if (c.kestrel) {
    await publish(
      c.kestrel,
      {
        type: 'join-request',
        created: T0 + 11 * DAY + 18_000,
        args: {
          inGroup: wire,
          calledMe: c.kestrel.who.name,
          say: 'I file on shipping and harbour freight. Happy to start on the quiet stuff.'
        }
      },
      readers
    )
  }

  // ── A second forum, so "which communities am I in" is a real question ────
  // Different keeper, different moderator, different roster: Ada is not on it,
  // and the Forums window has to say so.
  const tenants = (
    await publish(
      c.thurgood!,
      {
        type: 'group',
        created: T0 + 11 * DAY + 19_000,
        args: {
          name: 'Vale Street tenants',
          purpose: 'The building, the lease, and anything the landlord has not answered.',
          members: [
            member(c.thurgood!, 'founder'),
            member(c.sandra!, 'moderator'),
            member(c.ruth!, 'member'),
            member(c.clara!, 'member'),
            member(c.ada!, 'member')
          ],
          notes: ''
        }
      },
      [c.thurgood!, c.sandra!, c.ruth!, c.clara!, c.ada!, c.linus!]
    )
  ).envelopeHash

  const lawReaders = [c.thurgood!, c.sandra!, c.ruth!, c.clara!, c.ada!, c.linus!]
  const notice = (
    await publish(
      c.sandra!,
      {
        type: 'article',
        created: T0 + 11 * DAY + 20_000,
        args: {
          title: 'Service charge statement is nine weeks late',
          deck: 'The lease says twenty-eight days after year end. It is now sixty-three.',
          byline: c.sandra!.who.name,
          inGroup: tenants,
          blocks: [
            {
              kind: 'paragraph',
              text: 'Clause 6.4 requires the statement within twenty-eight days of the accounting year end. Nobody has had one.'
            },
            {
              kind: 'paragraph',
              text: 'Until it arrives the sinking-fund demand is not payable. Pay it if you like, but you are not obliged to, and paying it makes the next one harder to argue.'
            }
          ]
        }
      },
      lawReaders
    )
  ).envelopeHash
  await publish(
    c.ruth!,
    {
      type: 'comment',
      created: T0 + 11 * DAY + 20_600,
      args: { body: 'Mine came on Tuesday. Dated March. Posted last week.', replyTo: notice, inGroup: tenants }
    },
    lawReaders
  )
  await publish(
    c.clara!,
    {
      type: 'vote',
      created: T0 + 11 * DAY + 20_800,
      args: { votesOn: notice, dir: 1 }
    },
    lawReaders
  )
  await publish(
    c.ruth!,
    { type: 'vote', created: T0 + 11 * DAY + 20_900, args: { votesOn: notice, dir: 1 } },
    lawReaders
  )

  // ── One post too big to travel inline ────────────────────────────────────
  // Over the relay's 32 KiB inline cap, so an event about it carries a hash and
  // a locator instead of the bundle. Everyone on the wire gets the thing; Linus
  // -- who is not on the roster and reads it from outside -- gets the OFFER
  // that a relay would have given him.
  //
  // STAGED: the bytes are put in his seed store and the locator is
  // `bundle:<tar-hash>`, so pressing Fetch resolves offline and the whole
  // offer → press → admit → appears path can be watched without a swarm. Over a
  // real relay the locator would be a magnet and the bytes would come from
  // whoever is seeding.
  const heavy = await author(c.alan!, {
    type: 'article',
    created: T0 + 11 * DAY + 21_000,
    args: {
      title: 'Harbour Yard: the full plate set',
      deck: 'Forty exposures from the last week of the crane, at print resolution.',
      byline: c.alan!.who.name,
      inGroup: wire,
      blocks: [
        {
          kind: 'paragraph',
          text: 'The whole set, unedited, because the archive wants the negatives and the archive is right.'
        },
        {
          kind: 'image',
          name: 'img-1',
          alt: 'The crane at dusk.',
          caption: 'Plate 1 of 40.',
          placement: 'full'
        }
      ]
    },
    attachments: new Map([
      ['img-1', { bytes: new Uint8Array(photo), mime: 'image/png' }],
      // Ballast: incompressible, so the bundle really is over the cap rather
      // than merely looking it.
      ['plates.raw', { bytes: new Uint8Array(ballast(48 * 1024)), mime: 'application/octet-stream' }]
    ])
  })
  const heavyHash = deliver(heavy, press).envelopeHash
  const tarHash = c.linus!.seeds.put(heavy)
  c.linus!.library.recordOffer({
    envelopeHash: heavyHash,
    locator: `bundle:${tarHash}`,
    relayUrl: 'wss://relay.example',
    poster: 'f'.repeat(64),
    type: 'article',
    inGroup: wire,
    replyTo: null,
    now: T0 * 1000 + 11 * DAY * 1000 + 21_500
  })

  log(`  forum: the wire — 5 posts (one with a photograph), a 4-deep thread, votes on comments,`)
  log(`         one hidden and one endorsed, one asking to join`)
  log(`  forum: Vale Street tenants — a second community, with a different roster`)
  log(`  offer: ${c.linus!.who.name} sees the oversize plate set as a pointer, not a post`)
  log(`         ranking differs by reader: pnpm world forum --as ada --vs linus`)
}

/** The disclaimer every pastiche below carries, in the article's `rights`
 *  field — which renders in the "Where this came from" footer, under a line
 *  that already says none of it is verified.
 *
 *  These are IMITATIONS. They were written to give this software something
 *  real-shaped to render: an article with headings, a standfirst, a footnote
 *  and a byline behaves differently from one with a sentence in it, and the
 *  bug that prompted all this (every article rendering as "Untitled" with no
 *  text) hid behind content too thin to notice it was missing. The voices are
 *  borrowed and the opinions are invented, which the anachronisms make
 *  obvious: none of these people lived to see a pull request. */
const PASTICHE =
  'FICTION. Written for this software’s test world. The voice is an imitation and the opinions are invented — ' +
  'not by, from, or endorsed by the person named, who died long before any of the things described existed.'

/** The long read: the desk's essay forum, where the cast writes in their own
 *  register about things none of them lived to see.
 *
 *  Kept apart from the wire on purpose. The wire is where the ranking and
 *  moderation demo lives, and that needs spam and a listicle to push around;
 *  this needs to read like something somebody wrote. */
async function longRead(c: Cast, log: (s: string) => void): Promise<void> {
  const desk = ['ada', 'grace', 'alan', 'katherine', 'dorothy', 'joan', 'edith', 'oliver', 'ida'].map((k) => c[k]!)
  const member = (a: OpenAccount, role: string): Record<string, string> => ({
    key: a.who.address,
    scheme: 'eth-eip191',
    role,
    name: a.who.name
  })

  const room = (
    await publish(
      c.ada!,
      {
        type: 'group',
        created: T0 + 13 * DAY,
        args: {
          name: 'The long read',
          purpose: 'Essays. One a week, as long as they need to be, and no listicles.',
          members: [
            member(c.ada!, 'founder'),
            member(c.edith!, 'moderator'),
            member(c.alan!, 'member'),
            member(c.grace!, 'member'),
            member(c.oliver!, 'member'),
            member(c.katherine!, 'member')
          ],
          notes: 'Everything here is fiction written to test this software. See the Rights line on each piece.'
        }
      },
      desk
    )
  ).envelopeHash

  const essay = async (
    who: OpenAccount,
    at: number,
    args: Record<string, unknown>
  ): Promise<string> =>
    (
      await publish(
        who,
        {
          type: 'article',
          created: at,
          args: {
            ...args,
            byline: who.who.name,
            publisher: 'Meridian Press — the long read',
            section: 'Essays',
            language: 'en',
            rights: PASTICHE,
            inGroup: room
          }
        },
        desk
      )
    ).envelopeHash

  const seriesA = await essay(c.ada!, T0 + 13 * DAY + 3600, {
    title: 'Notes upon the Raising of a Series A',
    deck: 'In which the Engine acquires a valuation, and its author acquires a board seat she did not ask for.',
    published: '1843-07-01',
    blocks: [
      {
        kind: 'paragraph',
        text: 'It is not generally understood, even by those who follow such matters closely, that an Engine which has cost some eight years of labour may be valued in an afternoon by a gentleman who has not seen it work. I have now had this experience twice, and set down the particulars here in the hope that they may be of service to others.'
      },
      { kind: 'heading', text: 'Note A. Upon the Term Sheet' },
      {
        kind: 'paragraph',
        text: 'The document was four pages, of which three concerned what should happen were the Engine to fail, and one what should happen were it to succeed. I observed to Mr. B. that this proportion seemed to me to reveal the author’s true expectation. He replied that it was standard. I have since learnt that this word, in the City, means only that somebody else has already agreed to it.'
      },
      { kind: 'subheading', text: 'Of the Valuation' },
      {
        kind: 'paragraph',
        text: 'We are valued at four hundred thousand pounds, on the strength of a market which does not exist, for a machine which is not finished, to be sold to persons who have not been born. I am assured this is conservative. Mr. Babbage, upon hearing the figure, enquired whether it might be paid in brass.'
      },
      { kind: 'heading', text: 'Note D. Upon the Board' },
      {
        kind: 'paragraph',
        text: 'I am now to have a Board, which is to consist of myself, the gentleman who has not seen the Engine work, and a third person agreeable to us both. We have spent a fortnight failing to find anybody agreeable to us both. I begin to suspect that this seat is left empty by design, and that the design is not mine.'
      },
      { kind: 'heading', text: 'Note G. Upon Vesting' },
      {
        kind: 'paragraph',
        text: 'My own interest in the Engine is to be returned to me by degrees over four years, the first quarter being withheld for twelve months entire. That is to say: I am to earn, by attendance, a thing I have already made. I raised this. It was explained to me that the arrangement protects the company from a founder who leaves. I observed that I am the only person who knows how the Engine works, and that were I to leave there would be no company to protect. This was noted as a fair point and the clause was not altered.'
      },
      {
        kind: 'paragraph',
        text: 'I am further required to append to all descriptions of the Engine a statement that it has no pretensions whatever to originate any thing, and can do only what we know how to order it to perform. I wrote that sentence myself, some years ago, as a caution against enthusiasm. It is now in the prospectus, in small type, directly beneath a claim that the Engine thinks.'
      },
      {
        kind: 'footnote',
        text: 'The third Board seat remains empty at the time of writing. Mr. B. proposes his cousin. I propose that we finish the Engine first and discover afterwards whether anybody wants it, which I am told is the wrong order and, I am given to understand, has never been tried.'
      }
    ]
  })

  const stars = await essay(c.alan!, T0 + 13 * DAY + 7200, {
    title: 'Computing Machinery and Stars',
    deck: 'I propose to consider the question, “Can a repository be popular?”',
    published: '1950-10-01',
    blocks: [
      {
        kind: 'paragraph',
        text: 'I propose to consider the question, “Can a repository be popular?” This should begin with definitions of the terms “repository” and “popular”. But the definitions are framed so as to reflect so far as possible the normal use of the words, and that is dangerous here, because the normal use of “popular” is a number in the corner of a page, and I am not sure the number means anything at all.'
      },
      { kind: 'heading', text: 'The Imitation Game' },
      {
        kind: 'paragraph',
        text: 'The new form of the problem can be described in terms of a game which we call the imitation game. It is played with three parties: a maintainer (A), an account of indeterminate nature (B), and an interrogator (C) who is also the maintainer, at two o’clock in the morning, reading the issue tracker. C must determine which of A and B is a person.'
      },
      {
        kind: 'paragraph',
        text: 'B writes: “Great work! Following for more.” A writes: “this is broken on ARM.” The interrogator concludes that B is a person, because B was kind, and that A is a machine, because no person has ever opened an issue in that tone. The interrogator is wrong on both counts. I believe that in about fifty years’ time it will be possible to play the imitation game so well that the average maintainer will not have more than seventy per cent. chance of making the right identification after five minutes of scrolling.'
      },
      { kind: 'heading', text: 'Contrary Views on the Main Question' },
      { kind: 'subheading', text: '(1) The Theological Objection' },
      {
        kind: 'paragraph',
        text: 'Stars are a gift of God to popular projects, and therefore no unpopular project can have them. I am not impressed by this argument, though I notice it is the one most often advanced, usually in the form “if it were any good people would have heard of it”.'
      },
      { kind: 'subheading', text: '(2) The Argument from Continuity of the README' },
      {
        kind: 'paragraph',
        text: 'It is urged that a project is not a discrete-state machine, and that a small alteration to its README may make a very large difference to its reception. This is quite true. I added an animated diagram and the rate of stars trebled in a week, during which no line of the program was altered. The argument is therefore conceded, and I find it does not comfort me.'
      },
      { kind: 'heading', text: 'Learning Machines' },
      {
        kind: 'paragraph',
        text: 'Instead of trying to produce a programme to simulate the adult mind, why not rather try to produce one which simulates the child’s? I did so. It stars my repository every morning at six. It has left one hundred and forty comments, each of which says that this is a great work and that it is following for more. I cannot distinguish it from the others, and I have stopped trying, which I am aware is precisely the result I predicted and did not expect to mind.'
      },
      {
        kind: 'footnote',
        text: 'Since writing the above I have been informed that the number in the corner of the page may be purchased, in lots of one thousand, for rather less than the cost of an evening out. I have not tested this claim, on the grounds that the experiment would be indistinguishable from its own null result.'
      }
    ]
  })

  const friday = await essay(c.grace!, T0 + 13 * DAY + 10_800, {
    title: 'It is easier to apologise: on shipping upon a Friday',
    deck: 'A nanosecond is eleven inches. A rollback is four hours. Plan accordingly.',
    published: '1982-11-05',
    blocks: [
      {
        kind: 'paragraph',
        text: 'I keep a length of wire on my desk, eleven and a half inches long. That is a nanosecond: as far as light gets in one. I hand them out because engineers who have not held a nanosecond will cheerfully add nine hundred of them to a loop and call the result instantaneous.'
      },
      { kind: 'heading', text: 'On the Friday question' },
      {
        kind: 'paragraph',
        text: 'I am told the rule is that we do not ship on a Friday. The rule is not about Friday. It is about whether the person who can undo the change will be reachable when it needs undoing, and that is a question about your staffing, not your calendar. Answer the real question and Friday stops mattering. Refuse to answer it and Thursday will not save you.'
      },
      { kind: 'heading', text: 'On committees' },
      {
        kind: 'paragraph',
        text: 'We spent four years standardising a language by committee. It was slow, it was tedious, and the result runs on machines built by people who hated each other. I am now shown a directory of eleven hundred dependencies assembled in an afternoon, and told this is the improvement. Both approaches work. Only one of them can tell you who is responsible on a Sunday.'
      },
      {
        kind: 'paragraph',
        text: 'The most damaging phrase in the language is “we have always done it this way”. I said that about the committee, and it applies equally to the directory. Neither of you is exempt because you are the newer of the two.'
      },
      { kind: 'heading', text: 'On the log' },
      {
        kind: 'paragraph',
        text: 'Somebody taped a moth into a logbook once and we have been calling faults “bugs” ever since. The useful part was never the word. It was the tape: the fault was kept, dated, and signed, where the next person would find it. Keep your logs. Sign them. Nobody has ever regretted being able to prove what happened.'
      },
      {
        kind: 'footnote',
        text: 'Yes, ship on Friday. Ship on Friday and stay until seven. If that sentence alarms you, the problem was never the day of the week.'
      }
    ]
  })

  const dissent = await essay(c.oliver!, T0 + 13 * DAY + 14_400, {
    title: 'Dissenting, upon the matter of the hidden post',
    deck: 'The desk having concealed a post about gold, I would have let the market decide.',
    published: '1919-11-10',
    blocks: [
      {
        kind: 'paragraph',
        text: 'I dissent. The post in question urged the immediate purchase of gold, in capitals, and was concealed by a moderator acting within a roster which I do not dispute she holds. My disagreement is not with her authority. It is with the use of it.'
      },
      { kind: 'heading', text: 'Of the standard applied' },
      {
        kind: 'paragraph',
        text: 'Persecution for the expression of opinions seems to me perfectly logical, and I have said so before. If you have no doubt of your premises and want a certain result with all your heart, you naturally sweep away all opposition. To allow opposition by speech indicates either that you think the speech impotent, or that you do not care for the result.'
      },
      {
        kind: 'paragraph',
        text: 'But the ultimate good desired is better reached by free trade in ideas, and the best test of truth is the power of the thought to get itself accepted in the competition of the market. That is the theory of this forum, as it is of larger things. It is an experiment, as all life is an experiment.'
      },
      { kind: 'heading', text: 'Of the remedy already to hand' },
      {
        kind: 'paragraph',
        text: 'I note that the machinery of this place had already answered the post before the moderator reached it. Four accounts of no acquaintance to anybody here had voted it up; one member of the desk had voted it down; and by the arithmetic this forum applies, it sat at the bottom of the page regardless. The remedy was working. What the concealment added was not safety but tidiness.'
      },
      {
        kind: 'paragraph',
        text: 'I would be eternally vigilant against attempts to check the expression of opinions that we loathe, unless they so imminently threaten immediate interference with the lawful and pressing purposes of this desk that an immediate check is required. An advertisement for gold does not so threaten. It merely bores us, and boredom has never yet been held to be an emergency.'
      },
      {
        kind: 'footnote',
        text: 'The post remains one press away for any reader who wishes it, which is the only feature of this arrangement I am content with, and I record that contentment so that it may be quoted back at me when I am next in the majority.'
      }
    ]
  })

  const vote = async (who: OpenAccount, on: string, dir: 1 | -1, at: number): Promise<void> => {
    await publish(who, { type: 'vote', created: at, args: { votesOn: on, dir } }, desk)
  }
  await vote(c.alan!, seriesA, 1, T0 + 13 * DAY + 15_000)
  await vote(c.katherine!, seriesA, 1, T0 + 13 * DAY + 15_060)
  await vote(c.grace!, seriesA, 1, T0 + 13 * DAY + 15_120)
  await vote(c.ada!, stars, 1, T0 + 13 * DAY + 15_180)
  await vote(c.joan!, stars, 1, T0 + 13 * DAY + 15_240)
  await vote(c.ada!, friday, 1, T0 + 13 * DAY + 15_300)
  await vote(c.edith!, dissent, 1, T0 + 13 * DAY + 15_360)
  await vote(c.ida!, dissent, 1, T0 + 13 * DAY + 15_420)

  const say = async (who: OpenAccount, to: string, body: string, at: number): Promise<string> =>
    (await publish(who, { type: 'comment', created: at, args: { body, replyTo: to, inGroup: room } }, desk))
      .envelopeHash

  const c1 = await say(
    c.grace!,
    seriesA,
    'Four years to vest a machine you already built. Somebody should tell them the machine does not vest; it either runs on Monday or it does not.',
    T0 + 13 * DAY + 16_000
  )
  await say(
    c.ada!,
    c1,
    'I did tell them. It was noted as a fair point, which I have learnt is the sound a room makes when nothing is going to change.',
    T0 + 13 * DAY + 16_600
  )
  await say(
    c.katherine!,
    stars,
    'Your objection (2) is the whole paper. Nobody read the program. They read the picture at the top of the page and formed a complete opinion, and they were not wrong to — it was the only part anybody had checked.',
    T0 + 13 * DAY + 17_200
  )
  const c2 = await say(
    c.edith!,
    dissent,
    'Noted, and the post stays hidden. You are right that the arithmetic had already buried it. I hid it so nobody would have to scroll past an advertisement to reach the reporting, which is a matter of housekeeping and not of truth.',
    T0 + 13 * DAY + 17_800
  )
  await say(
    c.oliver!,
    c2,
    'Housekeeping is how it always begins, and I do not say that as an accusation. I say it because in thirty years somebody will quote this thread at whoever holds the roster then, and they should find both halves of it.',
    T0 + 13 * DAY + 18_400
  )
  await vote(c.ada!, c2, 1, T0 + 13 * DAY + 18_600)
  await vote(c.grace!, c1, 1, T0 + 13 * DAY + 18_660)

  log(`  forum: the long read — 4 essays with real structure, all clearly marked fiction`)
  log(`         (headings, standfirsts, footnotes, and a Rights line saying who did not write them)`)
}

/** An invoice, so there is one to look at. Money is in minor units and
 *  quantities in thousandths because canonical CBOR forbids floats -- 2.5 hours
 *  at £180 is quantity 2500, unitPrice 18000. */
async function invoice(c: Cast, log: (s: string) => void): Promise<void> {
  const readers = [c.thurgood!, c.ada!, c.sandra!, c.joan!]
  await publish(
    c.thurgood!,
    {
      type: 'invoice',
      created: T0 + 9 * DAY,
      args: {
        invoiceNumber: 'HV-2026-0184',
        issued: '2026-06-10',
        due: '2026-07-10',
        poNumber: 'MP-4471',
        currency: 'GBP',
        minorUnits: 2,
        seller: {
          name: 'Harbour & Vale LLP',
          address: '12 Harbour Yard\nLondon SE16 4RT',
          email: 'accounts@harbourvale.example',
          taxLabel: 'VAT',
          taxId: 'GB 418 2299 07',
          reg: 'Registered in England, OC392214',
          country: 'United Kingdom'
        },
        buyer: {
          name: 'Meridian Press Ltd',
          address: '4 Fleet Buildings\nLondon EC4Y 1AA',
          email: 'ada@meridianpress.example',
          taxLabel: 'VAT',
          taxId: 'GB 771 4410 22',
          country: 'United Kingdom'
        },
        shipTo: {},
        lines: [
          {
            description: 'Pre-publication review — Harbour Yard inquiry',
            detail: 'Two rounds, including the objectors’ submissions.',
            quantity: 6500,
            unit: 'hours',
            unitPrice: 24000,
            taxRate: 2000
          },
          {
            description: 'Advice on the crane retention condition',
            detail: '',
            quantity: 2000,
            unit: 'hours',
            unitPrice: 24000,
            taxRate: 2000
          },
          {
            description: 'Filing fee (disbursement, no VAT)',
            detail: 'Paid to the planning authority on your behalf.',
            quantity: 1000,
            unit: 'items',
            unitPrice: 11500,
            taxRate: 0
          }
        ],
        discountKind: 'percent',
        discountValue: 500,
        shipping: 0,
        shippingTaxRate: 0,
        amountPaid: 50000,
        paymentTerms: 'Net 30. Interest at 2% per month on overdue sums.',
        paymentInstructions: 'Harbour & Vale LLP\nSort 20-45-12  Account 4410 2298\nReference: HV-2026-0184',
        notes: 'Thank you — and congratulations on the result.',
        terms: 'Fees are as agreed in our engagement letter of 3 March 2026.'
      }
    },
    readers
  )
  log('  invoice: Harbour & Vale bill Meridian Press — part paid, mixed VAT rates')
}

/** Everyday content, so a feed is not one contract and a void. */
async function everyday(c: Cast, log: (s: string) => void): Promise<void> {
  let n = 0
  for (const a of Object.values(c)) {
    await publish(a, {
      type: 'nametag',
      created: T0 + 10 * DAY + n * 300,
      args: { name: a.who.name }
    })
    n++
  }
  const press = ['ada', 'grace', 'alan', 'katherine', 'dorothy', 'mary', 'joan', 'edith'].map((s) => c[s]!)
  await publish(
    c.joan!,
    {
      type: 'memo',
      created: T0 + 11 * DAY,
      args: {
        to: 'All desks',
        from: c.joan!.who.name,
        subject: 'Copy deadlines move to 16:00 from Monday',
        message: 'The print slot has been brought forward an hour. Filed copy after 16:00 will hold to the next edition.'
      }
    },
    press
  )
  // A poster with an actual photograph on it. It shipped with `photos: []`,
  // which is a poster of nothing -- the program falls back to an attachment
  // named `image`, and there was no attachment either.
  await publish(
    c.mary!,
    {
      type: 'poster',
      created: T0 + 12 * DAY,
      args: {
        title: 'The crane at dusk',
        caption: 'Harbour Yard, the evening before the vote.',
        layout: 'auto',
        photos: [{ name: 'image', alt: 'The Harbour Yard crane against a dusk sky.', caption: 'Plate 1 of 40.' }]
      },
      attachments: new Map([['image', { bytes: new Uint8Array(posterArt()), mime: 'image/png' }]])
    },
    press
  )
  log(`  everyday: ${n} nametags, a memo, a poster`)
}

export async function buildWorld(accounts: OpenAccount[], log: (s: string) => void): Promise<void> {
  const c = cast(accounts)
  introductions(c, log)
  await vouches(c, log)
  await signedContract(c, log)
  await pendingContract(c, log)
  await uninvitedSignature(c, log)
  await articleWithAttestations(c, log)
  await group(c, log)
  await forum(c, log)
  await longRead(c, log)
  await invoice(c, log)
  await everyday(c, log)
}
