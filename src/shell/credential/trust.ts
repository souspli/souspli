import csca2012 from './trust/canada/csca-canada-2012.pem?raw'
import csca2017 from './trust/canada/csca-canada-2017.pem?raw'
import csca2022 from './trust/canada/csca-canada-2022.pem?raw'
import link2012to2017 from './trust/canada/link-2012-to-2017.pem?raw'
import link2017to2022 from './trust/canada/link-2017-to-2022.pem?raw'
import type { TrustAnchor } from './passport.js'

// ── The state certificates Souspli vouches for ───────────────────────────────
//
// A passport is only as verifiable as the issuing state's signing certificate
// (CSCA) is trustworthy, and a letter must verify with no network. So the
// certificates ship inside the app, inlined at build time, and the header names
// the one a passport chained to. Where each came from and how it was checked is
// in trust/README.md. Today this is Canada only: a passport of any other state
// reads as "cannot be checked", never as verified.

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  return new Uint8Array(Buffer.from(body, 'base64'))
}

export const TRUST_ANCHORS: readonly TrustAnchor[] = [
  { name: 'Canada CSCA 2012', der: pemToDer(csca2012) },
  { name: 'Canada CSCA 2017', der: pemToDer(csca2017) },
  { name: 'Canada CSCA 2022', der: pemToDer(csca2022) },
  // A link certificate carries the next key, signed by the previous one.
  { name: 'Canada CSCA 2017', der: pemToDer(link2012to2017) },
  { name: 'Canada CSCA 2022', der: pemToDer(link2017to2022) }
]
