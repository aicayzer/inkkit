export interface Diagnostic {
  code: string | null
  message: string
}
export function diagnostic(error: unknown): Diagnostic {
  return {
    code: error instanceof Error && 'code' in error ? String(error.code) : null,
    message: error instanceof Error ? error.message : String(error),
  }
}
export interface OperationRecord {
  sequence: number
  name: string
  args: Record<string, unknown>
  generation: number
  status: 'pending' | 'success' | 'error' | 'cancelled'
  result?: unknown
  error?: Diagnostic
}
export function serialise(value: unknown): unknown {
  if (value instanceof Error) return diagnostic(value)
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return {
      $binary: 'base64',
      data: btoa(binary),
      byteLength: bytes.byteLength,
    }
  }
  if (Array.isArray(value)) return value.map(serialise)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serialise(entry)]),
    )
  return value ?? null
}
