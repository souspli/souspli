# Passport proof fixtures

Real zero-knowledge proofs made from **synthetic** passports: made-up people under made-up state
certificates, generated with zkPassport's own passport generator. Nothing here comes from a real
passport. `a`, `b` and `c` are three different passports; each directory holds its `export.json`
(the reader app's format), its certificate in `trust/`, the `pins.json` a verifier needs for it,
and proof packages.

Made with `zk/fixture.sh` from the NFC ID tools, for values fixed by the tests:

| Package | Bound to | Scope |
|---|---|---|
| `a/alice.json` | key 32×`01` | `souspli:test` |
| `a/alice-2.json`, `alice-2-age.json`, `alice-2-bind.json` | key 32×`01` | `souspli:test`, as single-proof packages (two claims, one, none) |
| `a/group-*.json` | keys 32×`01`, `02`, `03` | the group in `test/shell/gated-group.ts` |
| `*/ballot-*.json` | keys 32×`01`, `02`, `03`, and the one-time key of identity 32×`07` | the ballot in `test/shell/ballot-fixture.ts` |

If that group or ballot changes, its hash changes and these must be made again
(`pnpm tsx test/shell/ballot-fixture.ts` prints the ballot's values).

Names ending in `-2` are single-proof packages (format 2, about 20 KB), with their pins in
`a/pins-2.json`. The rest are six separate proofs (format 1, about 100 KB), which the app still
accepts and these tests still cover.
