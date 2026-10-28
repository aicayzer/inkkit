export const scenarios = Object.fromEntries(
  ['block', 'inline'].map((variant) => [
    'native-image-drag-' + variant,
    {
      hostKind: 'image-drag',
      timeout: 25_000,
      fixture: { variant },
      validate: validateImageDrag,
    },
  ]),
)

export function validateImageDrag(result, fixture) {
  const failures = []
  const name = fixture.variant
  try {
    if (result.error) throw Error(result.error)
    if (
      !result.events?.some(
        (event) => event.type === 'dragstart' && event.trusted === true,
      )
    )
      failures.push('No trusted dragstart')
    if (
      !result.events?.some(
        (event) => event.type === 'dragend' && event.trusted === true,
      )
    )
      failures.push('No trusted dragend')
    if (!result.destination?.length)
      failures.push('No AppKit destination callback')
    const displayURL = result.before?.displayURL
    if (!displayURL?.startsWith('data:image/'))
      failures.push('Missing private display URL fixture')
    for (const capture of result.destination ?? []) {
      if (capture.phase !== 'draggingEntered')
        failures.push('Unexpected destination phase')
      if (!capture.html || !capture.text)
        failures.push('Empty destination HTML or text')
      if (
        !capture.text.includes('Drag label') ||
        !capture.html.includes('Drag label')
      )
        failures.push('Readable image label missing')
      for (const value of [capture.html, capture.text]) {
        if (value.includes('private-authored-image.png'))
          failures.push('Authored image reference leaked')
        if (displayURL && value.includes(displayURL))
          failures.push('DOM display URL leaked')
        if (/data:image\//i.test(value)) failures.push('Image bytes leaked')
      }
    }
    const before = result.before?.snapshot
    const after = result.after?.snapshot
    const expectedSource =
      name === 'block'
        ? '![Drag label](private-authored-image.png)\n'
        : 'Before ![Drag label](private-authored-image.png) after.\n'
    if (before?.text !== expectedSource || !Number.isInteger(before?.revision))
      failures.push('Missing authored source or revision fixture')
    if (
      !after ||
      before.text !== after.text ||
      before.revision !== after.revision
    )
      failures.push('Unaccepted drag changed source or revision')
    if (result.after?.diagnostics?.length || result.after?.error)
      failures.push('Editor reported an error')
    if (result.acceptedDrop !== false)
      failures.push('Drop acceptance was not refused')
  } catch (error) {
    failures.push(error.message)
  }
  return failures
}
