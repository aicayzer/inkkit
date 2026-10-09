export function normalizeTableAlignment(
  element: HTMLElement,
): 'left' | 'center' | 'right' | null {
  const alignment = (
    element.style.textAlign ||
    element.getAttribute('align') ||
    ''
  )
    .trim()
    .toLowerCase()
  if (alignment === 'left' || alignment === 'center' || alignment === 'right')
    return alignment
  if (alignment !== 'start' && alignment !== 'end') return null
  let direction: 'ltr' | 'rtl' = 'ltr'
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    const value = (current.style.direction || current.getAttribute('dir') || '')
      .trim()
      .toLowerCase()
    if (value === 'ltr' || value === 'rtl') {
      direction = value
      break
    }
    if (value === 'auto') {
      const first = [...(current.textContent ?? '')].find((character) =>
        /\p{Letter}/u.test(character),
      )
      if (first) {
        direction =
          /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1edff}\u{1e900}-\u{1e95f}]/u.test(
            first,
          )
            ? 'rtl'
            : 'ltr'
        break
      }
    }
  }
  return alignment === 'start'
    ? direction === 'rtl'
      ? 'right'
      : 'left'
    : direction === 'rtl'
      ? 'left'
      : 'right'
}
