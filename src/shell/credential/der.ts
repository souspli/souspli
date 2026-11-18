// ── A minimal, strict DER reader ─────────────────────────────────────────────
//
// Just enough ASN.1 to walk a passport's security object and its certificates.
// It reads hostile bytes, so it is deliberately small: definite lengths only,
// every length checked against the bytes actually present, and a cap on how
// many nodes one parse may produce. It never interprets what it reads.

export interface DerNode {
  /** The identifier octet (single-byte tags only; that is all 9303 uses here). */
  tag: number
  /** The contents, without the header. */
  value: Uint8Array
  /** The whole element, header included. */
  raw: Uint8Array
}

export class DerError extends Error {}

const MAX_NODES = 4096

/** Read the one element starting at `offset`. */
export function readDer(buf: Uint8Array, offset = 0): DerNode & { end: number } {
  if (offset + 2 > buf.length) throw new DerError('truncated element')
  const tag = buf[offset]!
  if ((tag & 0x1f) === 0x1f) throw new DerError('multi-byte tags are not supported')
  let i = offset + 1
  let len = buf[i++]!
  if (len === 0x80) throw new DerError('indefinite length')
  if (len & 0x80) {
    const n = len & 0x7f
    if (n > 4 || i + n > buf.length) throw new DerError('bad length')
    len = 0
    for (let k = 0; k < n; k++) len = len * 256 + buf[i++]!
  }
  const end = i + len
  if (end > buf.length) throw new DerError('element runs past the end')
  return { tag, value: buf.subarray(i, end), raw: buf.subarray(offset, end), end }
}

/** Read exactly one element and insist nothing follows it. */
export function readOne(buf: Uint8Array): DerNode {
  const n = readDer(buf)
  if (n.end !== buf.length) throw new DerError('trailing bytes after element')
  return n
}

/** The elements inside a constructed element (or any byte range holding a run of elements). */
export function children(value: Uint8Array): DerNode[] {
  const out: DerNode[] = []
  let off = 0
  while (off < value.length) {
    if (out.length >= MAX_NODES) throw new DerError('too many elements')
    const n = readDer(value, off)
    out.push(n)
    off = n.end
  }
  return out
}

/** Children of `node`, which must carry `tag`. */
export function seq(node: DerNode | undefined, tag = 0x30): DerNode[] {
  if (!node || node.tag !== tag) throw new DerError(`expected tag 0x${tag.toString(16)}`)
  return children(node.value)
}

export function oid(node: DerNode | undefined): string {
  if (!node || node.tag !== 0x06 || node.value.length === 0) throw new DerError('expected an object identifier')
  const v = node.value
  const parts: number[] = [Math.floor(v[0]! / 40), v[0]! % 40]
  let acc = 0
  for (let i = 1; i < v.length; i++) {
    acc = acc * 128 + (v[i]! & 0x7f)
    if (acc > Number.MAX_SAFE_INTEGER) throw new DerError('object identifier too large')
    if (!(v[i]! & 0x80)) {
      parts.push(acc)
      acc = 0
    }
  }
  return parts.join('.')
}

/** A small non-negative INTEGER. */
export function int(node: DerNode | undefined): number {
  if (!node || node.tag !== 0x02 || node.value.length === 0 || node.value.length > 6) throw new DerError('expected a small integer')
  if (node.value[0]! & 0x80) throw new DerError('negative integer')
  let n = 0
  for (const b of node.value) n = n * 256 + b
  return n
}

export function octets(node: DerNode | undefined): Uint8Array {
  if (!node || node.tag !== 0x04) throw new DerError('expected an octet string')
  return node.value
}
