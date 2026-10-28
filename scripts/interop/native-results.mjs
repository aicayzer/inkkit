export function validateNative(result, expected) {
  const failures = []
  const steps =
    result?.steps?.filter((step) => step.operation === 'nativeInput') ?? []
  if (steps.length !== expected.length)
    failures.push(
      `Expected ${expected.length} native input steps, got ${steps.length}`,
    )
  for (const [index, requirement] of expected.entries()) {
    const input = steps[index]?.result
    if (!input?.keyWindow || !input?.active)
      failures.push(
        `Native input ${index}: key window or active editor missing`,
      )
    const keys =
      input?.events?.filter((event) => event.type === 'keydown') ?? []
    if (keys.length !== (requirement.count ?? 1))
      failures.push(
        `Native input ${index}: expected ${requirement.count ?? 1} keydowns, got ${keys.length}`,
      )
    if (
      !keys.every(
        (event) =>
          event.trusted === true &&
          event.key === requirement.key &&
          (requirement.collapsed === undefined ||
            event.collapsed === requirement.collapsed) &&
          (requirement.selection === undefined ||
            event.selection === requirement.selection),
      )
    )
      failures.push(
        `Native input ${index}: expected trusted ${JSON.stringify(requirement.key)} with the required selection`,
      )
    if (
      requirement.beforeinput &&
      !input?.events?.some(
        (event) =>
          event.type === 'beforeinput' &&
          event.inputType === requirement.beforeinput &&
          event.trusted === true &&
          event.collapsed === true,
      )
    )
      failures.push(
        `Native input ${index}: trusted collapsed ${requirement.beforeinput} beforeinput missing`,
      )
  }
  return failures
}
