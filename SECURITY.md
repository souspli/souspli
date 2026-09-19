# Security policy

Souspli's whole claim is that untrusted content cannot hurt its reader. Reports that
it can are the most valuable contribution anyone can make.

## Reporting

**Please do not open a public issue.** Use either:

- GitHub's private reporting: **Security → Report a vulnerability** on
  [github.com/souspli/souspli](https://github.com/souspli/souspli/security/advisories/new); or
- email **security@souspli.org**.

Include what you did, what happened, the platform and version, and — best of all — a
`.thing` file or a hostile page that demonstrates it. You will get an acknowledgement
within a few days. Please give us reasonable time to fix an issue before publishing.

There is no bug bounty yet. You will be credited unless you would rather not be.

## What we most want to hear about

- **Container escapes:** any network egress, persistence, navigation, window, file
  or Node/Electron access from a letter's code; anything a letter learns about its
  reader beyond locale and colour scheme.
- **Header spoofing:** a letter drawing over, resizing or imitating the trusted
  header convincingly.
- **Admission bypass:** anything stored or rendered that is not validly signed and
  hash-complete; forged authorship; crashing or wedging the client with a bundle, a
  relay event or a transfer.
- **Key exposure:** the private key, or a sealed letter's plaintext, reaching disk,
  logs, a renderer or the network.
- **Unasked network activity:** anything fetched, posted or announced without an
  explicit act by the person.
- **Format flaws:** signature malleability, canonicalisation ambiguities, anything
  that lets two implementations disagree about whether bytes are valid.

The [threat model](docs/how/architecture/security.md) says what is claimed and what
is explicitly out of scope; known weaknesses are listed there and need no report.

## Supported versions

Alpha: only the latest release and `master`.
