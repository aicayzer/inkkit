/** Rounds a distance away from zero, to a whole number of pixels. */
export const scrollOutward = (distance: number) =>
  distance > 0 ? Math.ceil(distance) : Math.floor(distance)

/**
 * Scrolls an element by a distance and returns what it did not scroll. A
 * scroll position is a whole number of pixels in some engines, so a fraction
 * is rounded away from zero: rounded to nothing, a reveal would leave the last
 * fraction of the target outside the element.
 */
export function scrollWholePixels(
  element: HTMLElement,
  vertical: number,
  horizontal: number,
  padding = { top: 0, bottom: 0 },
): { vertical: number; horizontal: number } {
  const top = element.scrollTop,
    left = element.scrollLeft
  const target = top + scrollOutward(vertical)
  const last = element.scrollHeight - element.clientHeight
  // Only padding is left beyond the target, so show it: a reveal that stops
  // at the first or last line would otherwise hide that padding.
  element.scrollTop =
    vertical < 0 && target <= padding.top
      ? 0
      : vertical > 0 && last > 0 && target >= last - padding.bottom
        ? last
        : target
  element.scrollLeft += scrollOutward(horizontal)
  const remaining = (distance: number, moved: number) =>
    distance > 0 ? Math.max(0, distance - moved) : Math.min(0, distance - moved)
  return {
    vertical: remaining(vertical, element.scrollTop - top),
    horizontal: remaining(horizontal, element.scrollLeft - left),
  }
}
