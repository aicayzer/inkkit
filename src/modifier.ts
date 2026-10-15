// Mod is Command on Apple platforms and Control elsewhere. This is the test
// ProseMirror's keymap uses for `Mod-` bindings, so a link click and a
// shortcut always agree on which key Mod is.
export const mac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

export const modHeld = (event: MouseEvent | KeyboardEvent): boolean =>
  mac ? event.metaKey : event.ctrlKey

/**
 * Marks the root while Mod is held with the pointer over it, so the stylesheet
 * can show the link cursor. Keys are read on the window, because focus may be
 * in a host control while the pointer is over the editor. Returns a function
 * that removes the listeners and the mark.
 */
export function trackLinkModifier(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView
  let over = false
  const mark = (held: boolean) =>
    root.classList.toggle('inkkit-link-modifier', over && held)
  const pointer = (event: PointerEvent) => {
    over = true
    mark(modHeld(event))
  }
  const leave = () => {
    over = false
    mark(false)
  }
  const key = (event: KeyboardEvent) => mark(modHeld(event))
  // A key released while the window is in the background never arrives.
  const blur = () => mark(false)
  root.addEventListener('pointerover', pointer)
  root.addEventListener('pointermove', pointer)
  root.addEventListener('pointerleave', leave)
  view?.addEventListener('keydown', key, true)
  view?.addEventListener('keyup', key, true)
  view?.addEventListener('blur', blur)
  return () => {
    root.removeEventListener('pointerover', pointer)
    root.removeEventListener('pointermove', pointer)
    root.removeEventListener('pointerleave', leave)
    view?.removeEventListener('keydown', key, true)
    view?.removeEventListener('keyup', key, true)
    view?.removeEventListener('blur', blur)
    root.classList.remove('inkkit-link-modifier')
  }
}
