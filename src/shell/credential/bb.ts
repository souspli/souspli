import type { ProofBackend } from './proof.js'

// ── Barretenberg, as the proof backend ───────────────────────────────────────
//
// zkPassport's circuits are Noir programs proved with UltraHonk; bb.js is the
// matching verifier. It is loaded lazily and only ever inside the credential
// worker: a few megabytes of WebAssembly that most sessions never need, parsing
// bytes from strangers.
//
// WebAssembly ON PURPOSE. The package also ships native binaries and prefers
// them when it finds them; a verifier has no need for the speed and every
// reason to stay inside a sandboxed, portable build.

const TARGET = { verifierTarget: 'noir-recursive' } as const

// ── The reference string, without the download ───────────────────────────────
//
// Left to itself bb.js fetches about 20 MB of curve points from Aztec's servers
// on first use and caches them in the home directory. Souspli must not: a
// letter verifies with no network, and the app calls nobody. A VERIFIER needs
// only two points of that string, so they are written out here and the fetch is
// skipped (`skipSrsInit`):
//
//   G1: the BN254 generator, (1, 2).
//   G2: [x]₂ from the Aztec Ignition ceremony -- the constant every UltraHonk
//       verifier carries (it is in Barretenberg's Solidity verifiers too).
//       bb.js checks these bytes against its own built-in hash and refuses
//       anything else, so a wrong value here fails loudly, not silently.
const SRS_G1 =
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '0000000000000000000000000000000000000000000000000000000000000002'
const SRS_G2 =
  '0118c4d5b837bcc2bc89b5b398b5974e9f5944073b32078b7e231fec938883b0' +
  '260e01b251f6f1c7e7ff4e580791dee8ea51d87a358e038b4efe30fac09383c1' +
  '22febda3c0c0632a56475b4214e5615e11e6dd3f96e6cea2854a87d4dacc5e55' +
  '04fc6369f7110fe3d25156c1bb9a72859cf2a04641f99ba4ee413c80da6a5fe4'
const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'))

function toField(v: bigint): Uint8Array {
  return new Uint8Array(Buffer.from(v.toString(16).padStart(64, '0'), 'hex'))
}

export async function openBackend(): Promise<ProofBackend & { close(): Promise<void> }> {
  const { Barretenberg, BackendType, UltraHonkVerifierBackend } = await import('@aztec-foundation/bb.js')
  const api = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1, skipSrsInit: true })
  await api.srsInitSrs({ pointsBuf: fromHex(SRS_G1), numPoints: 1, g2Point: fromHex(SRS_G2) })
  const verifier = new UltraHonkVerifierBackend(api)
  return {
    async verify(verificationKey, proof, publicInputs) {
      try {
        return await verifier.verifyProof({ proof, publicInputs, verificationKey }, TARGET)
      } catch {
        // A proof or key the backend cannot even parse is a proof that does not verify.
        return false
      }
    },
    async poseidon2(inputs) {
      const { hash } = await api.poseidon2Hash({ inputs: inputs.map(toField) })
      return BigInt('0x' + Buffer.from(hash).toString('hex'))
    },
    close: () => api.destroy()
  }
}
