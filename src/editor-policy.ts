import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { TextInputPreferences } from './editor'
import { modHeld } from './modifier'

interface SurfacePolicy {
  writable(): boolean
  literal(): boolean
}

export function applyInputPolicy(
  view: EditorView,
  element: HTMLTextAreaElement,
  preferences: TextInputPreferences,
  label: string,
  runtime: SurfacePolicy,
): void {
  const attributes =
    typeof view.props.attributes === 'function'
      ? view.props.attributes(view.state)
      : view.props.attributes
  const inputAttributes = { ...attributes }
  delete inputAttributes['aria-readonly']
  if (!runtime.writable()) inputAttributes['aria-readonly'] = 'true'
  view.setProps({
    editable: () => runtime.writable() && !runtime.literal(),
    attributes: {
      ...inputAttributes,
      role: 'textbox',
      tabindex: '0',
      'aria-multiline': 'true',
      'aria-label': label,
    },
  })
  element.readOnly = !runtime.writable()
  for (const surface of [view.dom, element]) {
    for (const name of [
      'spellcheck',
      'autocorrect',
      'autocapitalize',
    ] as const) {
      const value = preferences[name]
      if (value == null) surface.removeAttribute(name)
      else
        surface.setAttribute(
          name,
          name === 'autocorrect' ? (value ? 'on' : 'off') : String(value),
        )
    }
  }
}

interface InputPolicy extends SurfacePolicy {
  loading(): boolean
  syncing(): boolean
  publish(): void
}

export function createInputPolicyPlugin(runtime: InputPolicy) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('inkkitInputPolicy'),
        filterTransaction: (tr) =>
          runtime.loading() ||
          runtime.writable() ||
          // Source that was typed while the editor was writable.
          runtime.syncing() ||
          (!tr.docChanged && !tr.storedMarksSet),
        props: {
          editable: () => runtime.writable() && !runtime.literal(),
          // ProseMirror selects the clicked node when Mod is held; a click that opens a link must not.
          handleClick: (_view, _pos, event) =>
            modHeld(event) &&
            !!(event.target as HTMLElement).closest(
              'a[href], .inkkit-wiki-link',
            ),
          handleDOMEvents: {
            compositionstart: () => {
              queueMicrotask(() => runtime.publish())
              return false
            },
            compositionend: () => {
              queueMicrotask(() => runtime.publish())
              return false
            },
            beforeinput: (_view, event) => {
              if (runtime.writable()) return false
              event.preventDefault()
              return true
            },
            drop: (_view, event) => {
              if (runtime.writable()) return false
              event.preventDefault()
              return true
            },
          },
        },
        view: () => ({ update: () => runtime.publish() }),
      }),
  )
}

interface HistoryInput {
  writable(): boolean
  available(command: 'undo' | 'redo'): boolean
  run(command: 'undo' | 'redo'): void
}

// Native Undo and touch gestures must use the same history path as public calls.
export function createHistoryInputPlugin(runtime: HistoryInput) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('inkkitHistoryInput'),
        props: {
          handleDOMEvents: {
            beforeinput: (_view, event) => {
              if (!runtime.writable()) return false
              const name =
                event.inputType === 'historyUndo'
                  ? 'undo'
                  : event.inputType === 'historyRedo'
                    ? 'redo'
                    : undefined
              if (!name) return false
              event.preventDefault()
              if (runtime.available(name)) runtime.run(name)
              return true
            },
          },
        },
      }),
  )
}

export function createChangePlugin(
  changed: (view: EditorView, previous: EditorState) => void,
) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('documentChanges'),
        view: () => ({ update: changed }),
      }),
  )
}
