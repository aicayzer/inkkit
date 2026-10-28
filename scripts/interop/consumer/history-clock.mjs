// Only Date.now is controlled: native input, rendering and async work keep real time.
export async function withHistoryClock(enabled, run) {
  if (!enabled)
    return run(() => {
      throw Error('historyBoundary requires historyClock: true')
    })
  const original = Object.getOwnPropertyDescriptor(Date, 'now')
  let now = 1_800_000_000_000
  Object.defineProperty(Date, 'now', { ...original, value: () => now })
  try {
    return await run(() => {
      const before = now
      now += 1_000
      return { before, after: now }
    })
  } finally {
    Object.defineProperty(Date, 'now', original)
  }
}
