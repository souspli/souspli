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
        headline: 'Harbour Yard redevelopment approved after two-year inquiry',
        standfirst: 'Councillors voted seven to four in favour, ending the longest planning inquiry in the borough’s history.',
        byline: c.grace!.who.name,
        publisher: 'Meridian Press',
        published: '2026-06-09',
        location: 'Harbour Yard',
        body: [
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
    headline: 'The Harbour Yard figures do not add up',
    standfirst:
      'The developer’s own filings put the affordable-housing count 38 homes below what the committee was told.',
    byline: c.katherine!.who.name,
    publisher: 'Meridian Press',
    published: '2026-06-12',
    body: [
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
    headline: 'Ten tools every newsroom desk needs',
    standfirst: 'Number four is a notebook.',
    byline: c.mary!.who.name,
    body: [
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
      headline: 'The crane goes in October',
      standfirst: 'Photographing Harbour Yard before the listed crane comes down.',
      byline: c.alan!.who.name,
      published: '2026-06-12',
      body: [
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
    headline: 'BUY GOLD NOW — LIMITED WINDOW',
    standfirst: '',
    body: [{ kind: 'paragraph', text: 'Click here. Act fast. This will not be repeated.' }]
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
          headline: 'Service charge statement is nine weeks late',
          standfirst: 'The lease says twenty-eight days after year end. It is now sixty-three.',
          byline: c.sandra!.who.name,
          inGroup: tenants,
          body: [
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
      headline: 'Harbour Yard: the full plate set',
      standfirst: 'Forty exposures from the last week of the crane, at print resolution.',
      byline: c.alan!.who.name,
      inGroup: wire,
      body: [
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
      args: { name: a.who.name, subtitle: a.who.role }
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
        body: 'The print slot has been brought forward an hour. Filed copy after 16:00 will hold to the next edition.'
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
  await invoice(c, log)
  await everyday(c, log)
}
