import { InkKitError } from './types'

export class PreservationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PreservationError'
  }
}

// Only explicit refusals can select another preservation path. Diagnostic
// wrappers may contain arbitrary failures and must not make them retryable.
export class PreservationRefusal extends PreservationError {
  constructor(
    readonly reason: 'matching-budget' | 'source-location' | 'reopen-mismatch',
    message: string,
  ) {
    super(message)
  }
}

export class MarkdownParseRefusal extends InkKitError {
  constructor() {
    super(
      'preservation',
      'The Markdown cannot be shown without losing part of it',
    )
  }
}

export function isPreservationRefusal(
  error: unknown,
): error is PreservationRefusal | MarkdownParseRefusal {
  return (
    error instanceof PreservationRefusal ||
    error instanceof MarkdownParseRefusal
  )
}
