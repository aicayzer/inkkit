import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { closeHistory } from '@milkdown/kit/prose/history'
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view'
import { $ctx, $prose } from '@milkdown/kit/utils'
import { editorLabels } from './labels'
import { codeLanguages } from './code-languages'
import { languageFence } from './code-fences'

export const codeControlCtx = $ctx<
  (operation: () => boolean) => boolean,
  'inkkitCodeControl'
>((operation) => operation(), 'inkkitCodeControl')

export function codeControlsPlugin(
  visibleRect: () => {
    top: number
    left: number
    right: number
    bottom: number
  },
) {
  return $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey('codeControls'),
        props: {
          decorations(state) {
            const widgets: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'code_block') return true
              const language = String(node.attrs.language ?? '')
              widgets.push(
                Decoration.widget(
                  pos + 1,
                  (view, getPos) => {
                    const labels = editorLabels(ctx)
                    const wrapper = document.createElement('span')
                    wrapper.className = 'inkkit-code-controls'
                    const button = document.createElement('button')
                    button.type = 'button'
                    button.tabIndex = 0
                    button.className = 'inkkit-code-language'
                    button.textContent =
                      language === 'text' || language === 'plaintext'
                        ? labels.codePlainText
                        : (codeLanguages.find(
                            ([value]) => value === language,
                          )?.[1] ??
                          (language || labels.codeAuto))
                    button.setAttribute('aria-label', labels.codeLanguage)
                    button.setAttribute('aria-haspopup', 'dialog')
                    button.setAttribute('aria-expanded', 'false')
                    const chevron = document.createElementNS(
                      'http://www.w3.org/2000/svg',
                      'svg',
                    )
                    chevron.setAttribute('viewBox', '0 0 12 12')
                    chevron.setAttribute('aria-hidden', 'true')
                    chevron.setAttribute('focusable', 'false')
                    const path = document.createElementNS(
                      'http://www.w3.org/2000/svg',
                      'path',
                    )
                    path.setAttribute('d', 'm3 4.5 3 3 3-3')
                    chevron.append(path)
                    button.append(chevron)
                    wrapper.append(button)
                    let popup: HTMLElement | undefined
                    let restore: (() => void) | undefined
                    const close = (focus = false) => {
                      popup?.remove()
                      popup = undefined
                      restore?.()
                      restore = undefined
                      button.setAttribute('aria-expanded', 'false')
                      if (focus) button.focus()
                    }
                    button.addEventListener('mousedown', (event) =>
                      event.preventDefault(),
                    )
                    button.addEventListener('click', (event) => {
                      if (popup) {
                        close()
                        return
                      }
                      const captured = view.state.doc
                      popup = document.createElement('span')
                      popup.className = 'inkkit-code-language-menu'
                      // Text inputs match :focus-visible even after a pointer
                      // opens them; keep navigation focus local to this popup.
                      popup.dataset.inkkitInputModality =
                        event.detail === 0 ? 'keyboard' : 'pointer'
                      popup.setAttribute('role', 'dialog')
                      popup.setAttribute('aria-label', labels.codeLanguage)
                      popup.contentEditable = 'false'
                      const search = document.createElement('input')
                      search.type = 'search'
                      search.placeholder = labels.codeLanguageSearch
                      search.setAttribute(
                        'aria-label',
                        labels.codeLanguageSearch,
                      )
                      const list = document.createElement('span')
                      list.className = 'inkkit-code-language-list'
                      popup.append(search, list)
                      const choices: [string, string][] = [
                        ['', labels.codeAuto],
                        ['text', labels.codePlainText],
                        ...codeLanguages,
                      ]
                      if (
                        language &&
                        !choices.some(([value]) => value === language)
                      )
                        choices.push([language, language])
                      const render = () => {
                        list.replaceChildren()
                        for (const [value, name] of choices) {
                          if (
                            !`${value} ${name}`
                              .toLowerCase()
                              .includes(search.value.toLowerCase())
                          )
                            continue
                          const option = document.createElement('button')
                          option.type = 'button'
                          option.textContent = name
                          option.setAttribute(
                            'aria-pressed',
                            String(value === language),
                          )
                          option.addEventListener('click', () => {
                            close()
                            if (view.state.doc !== captured) return
                            ctx.get(codeControlCtx.key)(() => {
                              const at = getPos()
                              if (at == null) return false
                              const position = at - 1
                              const current = view.state.doc.nodeAt(position)
                              if (current?.type.name !== 'code_block')
                                return false
                              if (value === language) {
                                view.focus()
                                return false
                              }
                              const transaction = view.state.tr.setNodeMarkup(
                                position,
                                undefined,
                                {
                                  ...current.attrs,
                                  language: value,
                                  authoredFence: languageFence(
                                    current.attrs.authoredFence,
                                    value,
                                  ),
                                },
                              )
                              view.dispatch(closeHistory(transaction))
                              view.dispatch(
                                closeHistory(view.state.tr).setMeta(
                                  'addToHistory',
                                  false,
                                ),
                              )
                              view.focus()
                              return true
                            })
                          })
                          list.append(option)
                        }
                      }
                      search.addEventListener('input', render)
                      popup.addEventListener('pointerdown', () => {
                        if (popup)
                          popup.dataset.inkkitInputModality = 'pointer'
                      })
                      popup.addEventListener('keydown', (event) => {
                        if (
                          popup &&
                          (event.key === 'Tab' ||
                            event.key.startsWith('Arrow') ||
                            event.key === 'Home' ||
                            event.key === 'End' ||
                            event.key === 'Enter')
                        )
                          popup.dataset.inkkitInputModality = 'keyboard'
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          event.stopPropagation()
                          close(true)
                        }
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          const options = [...list.querySelectorAll('button')]
                          const index = options.indexOf(
                            document.activeElement as HTMLButtonElement,
                          )
                          options[(index + 1) % options.length]?.focus()
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          const options = [...list.querySelectorAll('button')]
                          const index = options.indexOf(
                            document.activeElement as HTMLButtonElement,
                          )
                          options[
                            index < 0
                              ? options.length - 1
                              : (index - 1 + options.length) % options.length
                          ]?.focus()
                        }
                        if (event.key === 'Enter' && event.target === search) {
                          event.preventDefault()
                          list.querySelector('button')?.click()
                        }
                      })
                      wrapper.append(popup)
                      render()
                      const bounds = button.getBoundingClientRect()
                      const safe = visibleRect()
                      const left = Math.max(8, safe.left + 4)
                      const right = Math.min(
                        window.innerWidth - 8,
                        safe.right - 4,
                      )
                      const top = Math.max(8, safe.top + 4)
                      const bottom = Math.min(
                        window.innerHeight - 8,
                        safe.bottom - 4,
                      )
                      const below = Math.max(0, bottom - bounds.bottom - 4)
                      const above = Math.max(0, bounds.top - top - 4)
                      const height = Math.min(320, Math.max(below, above))
                      popup.style.width = `${Math.max(0, Math.min(220, right - left))}px`
                      popup.style.maxHeight = `${height}px`
                      popup.style.left = `${Math.max(left, Math.min(bounds.right - 220, right - 220))}px`
                      const menuHeight = Math.min(
                        height,
                        popup.getBoundingClientRect().height,
                      )
                      popup.style.top = `${Math.max(top, Math.min(below >= menuHeight ? bounds.bottom + 4 : bounds.top - menuHeight - 4, bottom - menuHeight))}px`
                      const outside = (event: Event) => {
                        if (!wrapper.contains(event.target as Node)) close()
                      }
                      const scroll = (event: Event) => {
                        if (popup?.contains(event.target as Node)) return
                        // A scroll queued before opening can arrive afterwards.
                        const current = button.getBoundingClientRect()
                        if (
                          current.top !== bounds.top ||
                          current.left !== bounds.left ||
                          current.bottom !== bounds.bottom ||
                          current.right !== bounds.right
                        )
                          close()
                      }
                      document.addEventListener('pointerdown', outside, true)
                      window.addEventListener('scroll', scroll, true)
                      restore = () => {
                        document.removeEventListener(
                          'pointerdown',
                          outside,
                          true,
                        )
                        window.removeEventListener('scroll', scroll, true)
                      }
                      button.setAttribute('aria-expanded', 'true')
                      render()
                      search.focus({ preventScroll: true })
                    })
                    ;(
                      wrapper as HTMLElement & { cleanup?: () => void }
                    ).cleanup = close
                    return wrapper
                  },
                  {
                    side: -1,
                    key: `language:${language}`,
                    ignoreSelection: true,
                    stopEvent: () => true,
                    destroy: (dom) =>
                      (
                        dom as HTMLElement & { cleanup?: () => void }
                      ).cleanup?.(),
                  },
                ),
              )
              return false
            })
            return DecorationSet.create(state.doc, widgets)
          },
        },
        view: (view: EditorView) => ({
          update(next, previous) {
            if (next.state.doc !== previous.doc || !next.editable)
              view.dom
                .querySelectorAll<HTMLElement & { cleanup?: () => void }>(
                  '.inkkit-code-controls',
                )
                .forEach((element) => element.cleanup?.())
          },
        }),
      }),
  )
}
