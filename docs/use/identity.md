# Identity and keys

Your identity in Souspli is a cryptographic key on your machine. There is no
account, no password reset, and nobody to ask if you lose it.

**File → Account & Keys…** shows everything on this page.

## What you have

- An **address** — an Ethereum-style address (`0x…`). This is who your letters are
  "signed by". Letters are signed with the same `personal_sign` scheme wallets use.
- A **Nostr public key**, derived deterministically from the same secret. It signs
  your relay posts, and it is the key sealed letters are encrypted to. Every letter
  you publish declares it, under your signature — which is how anyone learns a key
  to encrypt to you without a directory, and how readers confirm that a relay post
  really came from the letter's author.

One secret, two public faces. Anyone can link the two; that is intended.

## How the key is stored

The top bar carries a badge telling you the truth about this machine:

| Badge | Meaning |
|---|---|
| **⚠ alpha** | The key file is encrypted with your operating system's keychain (macOS Keychain, Windows DPAPI, a Linux secret service). |
| **⚠ software keys · alpha** | No OS keychain was available. The key file is obfuscated, not protected: anyone who can read your files can recover it. |

Either way the plaintext key is never written to disk, and no part of Souspli that
handles incoming content ever sees it: hostile bundles are decoded in a separate
process that holds no keys.

There is **no hardware-wallet support yet**.

## Back it up

**Reveal private key…** shows the raw key as 64 hex characters. Write it down or put
it in a password manager. That is, today, the only way to back up a key that is
already in use.

If you would rather have a recovery phrase, generate the identity that way from the
start:

- **Generate new identity** creates a fresh 12-word phrase and shows it **once**.
  Souspli does not store the phrase — only the key derived from it — so if you do
  not write it down then, it cannot be shown again.
- The phrase uses the same standard and derivation path as MetaMask and most
  Ethereum wallets, so the same words give the same address there.

## Bring your own

- **Seed phrase** → **Derive accounts** lists the first accounts for a 12- or
  24-word phrase; pick one and **Use selected account**.
- **Import key** takes a raw 64-hex private key.

## Replacing your identity is drastic

Souspli holds one identity at a time. Replacing it:

- makes anything sealed to your old Nostr key **permanently unopenable** by the new
  one;
- leaves letters you already wrote signed by your old address — correctly — so they
  no longer read as "you";
- keeps a timestamped backup of the old encrypted key file beside the new one
  (`identity.key.enc.bak-<time>`), which is the only way back.

The app spells this out and asks before doing it. Restart Souspli afterwards.

## If your key is stolen

There is no revocation yet. Every letter the thief signs will verify as yours, and
every past letter still verifies. Key rotation is an [open problem on the
roadmap](../next/roadmap.md), and the main reason the first-run notice tells you not
to use this identity for anything valuable.
