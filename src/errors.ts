import { InkKitError, type EditorErrorCode } from './types'

/**
 * `error` as an `InkKitError`. One that is already coded passes through unchanged; anything else
 * takes `code` and keeps the original as `cause`.
 */
export function coded(
  error: unknown,
  code: EditorErrorCode = 'internal',
  message?: string,
): InkKitError {
  if (error instanceof InkKitError) return error
  return new InkKitError(
    code,
    message ?? (error instanceof Error ? error.message : String(error)),
    { cause: error },
  )
}

// Argument checks for facade methods. Each returns the checked value or throws `invalid-argument`
// before the method changes anything. `null` counts as omitted wherever a value is optional,
// because WebKit bridges send JSON `null` for a missing value.

export function invalidArgument(message: string): InkKitError {
  return new InkKitError('invalid-argument', message)
}

export function isOmitted(value: unknown): value is null | undefined {
  return value === undefined || value === null
}

export function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw invalidArgument(`${name} must be text`)
  return value
}

export function optionalString(
  value: unknown,
  name: string,
): string | undefined {
  return isOmitted(value) ? undefined : expectString(value, name)
}

export function expectBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean')
    throw invalidArgument(`${name} must be true or false`)
  return value
}

export function optionalBoolean(
  value: unknown,
  name: string,
): boolean | undefined {
  return isOmitted(value) ? undefined : expectBoolean(value, name)
}

/** A finite number, optionally within `min` and `max` inclusive. */
export function expectNumber(
  value: unknown,
  name: string,
  { min = -Infinity, max = Infinity } = {},
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw invalidArgument(`${name} must be a finite number${range(min, max)}`)
  return value
}

/** A safe integer, optionally within `min` and `max` inclusive. */
export function expectInteger(
  value: unknown,
  name: string,
  { min = -Infinity, max = Infinity } = {},
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    throw invalidArgument(`${name} must be an integer${range(min, max)}`)
  return value as number
}

function range(min: number, max: number): string {
  if (min > -Infinity && max < Infinity) return ` from ${min} to ${max}`
  if (min > -Infinity) return ` of at least ${min}`
  if (max < Infinity) return ` of at most ${max}`
  return ''
}

export function expectGeneration(value: unknown, name = 'generation'): number {
  return expectInteger(value, name)
}

/** An expected generation; omitted means the current one. */
export function optionalGeneration(
  value: unknown,
  name = 'expectedGeneration',
): number | undefined {
  return isOmitted(value) ? undefined : expectGeneration(value, name)
}

export function expectOneOf<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (!allowed.includes(value as T))
    throw invalidArgument(
      `${name} must be one of ${allowed.map((item) => `'${item}'`).join(', ')}`,
    )
  return value as T
}

/**
 * A plain object. With `keys`, any other key whose value is not omitted is refused, so a misspelt
 * or unsupported option fails instead of being ignored.
 */
export function expectRecord(
  value: unknown,
  name: string,
  keys?: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalidArgument(`${name} must be an object`)
  const record = value as Record<string, unknown>
  if (keys)
    for (const key of Object.keys(record))
      if (!keys.includes(key) && !isOmitted(record[key]))
        throw invalidArgument(`${name} has no option '${key}'`)
  return record
}

export function optionalRecord(
  value: unknown,
  name: string,
  keys?: readonly string[],
): Record<string, unknown> | undefined {
  return isOmitted(value) ? undefined : expectRecord(value, name, keys)
}

export function expectArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidArgument(`${name} must be an array`)
  return value
}
