import { vi } from 'vitest'

// Composition and DOM-observer timers must run before negative assertions.
// Only timers created by the operation belong to this controlled interval.
// Drain their nested callbacks too; an endlessly rescheduled timer must fail.
export async function withInputTimers(operation: () => void | Promise<void>) {
  vi.useFakeTimers()
  try {
    await operation()
    await vi.runAllTimersAsync()
  } finally {
    vi.useRealTimers()
  }
}

// Let the current promise chain finish, including continuations it adds.
export const nextTask = () =>
  new Promise<void>((resolve) => setTimeout(resolve))
