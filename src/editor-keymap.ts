import type { EditorView } from '@milkdown/kit/prose/view'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { sinkListItem } from '@milkdown/kit/prose/schema-list'
import {
  Plugin,
  PluginKey,
  type Command,
  type EditorState,
} from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { goToNextCell } from '@milkdown/kit/prose/tables'
import { blockMove } from './block-move'
import { liftItem } from './editor-input'
import { tableCommands } from './tables'
import {
  InkKitError,
  type BlockMoveDirection,
  type TableCommand,
} from './types'
import type {
  CommandState,
  FormatCommand,
  Keymap,
  ShortcutName,
} from './editor'

interface KeymapActions {
  ready(): boolean
  writable(): boolean
  literalSurface(): boolean
  composing(): boolean
  pending(): boolean
  commandState(): CommandState
  run<T>(operation: () => T, fallback: T): T
  undo(): boolean
  redo(): boolean
  openLink(state: EditorState): boolean
  format(command: Exclude<FormatCommand, 'link'>): boolean
  moveBlock(direction: BlockMoveDirection): boolean
  table(command: TableCommand): boolean
}

export function tableShortcut(command: TableCommand): ShortcutName {
  return `table${command[0]!.toUpperCase()}${command.slice(1)}` as ShortcutName
}

type KeyHandler = (view: EditorView, event: KeyboardEvent) => boolean

interface EditorKeyBindings {
  readOnlyKeys: KeyHandler
  keys: KeyHandler
  readingKeys: KeyHandler
  indentKeys: KeyHandler
  literalKeys: KeyHandler
}

export function createEditorKeymap(
  keymap: Keymap,
  formatShortcuts: readonly Exclude<FormatCommand, 'link'>[],
  actions: KeymapActions,
): EditorKeyBindings {
  const configuredKeys: Keymap = {
    undo: ['Mod-z'],
    redo: ['Mod-y', 'Shift-Mod-z'],
    moveBlockUp: ['Alt-ArrowUp'],
    moveBlockDown: ['Alt-ArrowDown'],
    tableExit: ['Mod-Enter', 'Enter'],
    indent: ['Tab'],
    outdent: ['Shift-Tab'],
    ...keymap,
  }
  const bindings: Record<string, Command> = {}
  // Consuming unbound history keys prevents the browser's separate undo stack
  // from changing source/TXT outside the shared document history.
  const historyBindings: Record<string, Command> = Object.fromEntries(
    ['Mod-z', 'Mod-y', 'Shift-Mod-z'].map((key) => [key, () => true]),
  )
  for (const name of ['undo', 'redo'] as const) {
    for (const key of configuredKeys[name] ?? []) {
      historyBindings[key] = () => {
        if (!actions.ready() || !actions.commandState().commands[name])
          return true
        return actions.run(() => actions[name](), true)
      }
    }
  }
  Object.assign(bindings, historyBindings)
  const openLink: Command = (state) => actions.openLink(state)
  for (const key of keymap.openLink ?? []) bindings[key] = openLink
  for (const name of formatShortcuts) {
    for (const key of keymap[name] ?? []) {
      bindings[key] = () => {
        if (!actions.ready() || !actions.commandState().commands.format[name])
          return true
        actions.run(() => actions.format(name), false)
        return true
      }
    }
  }
  const moves: Record<string, Command> = {}
  for (const [name, direction] of [
    ['moveBlockUp', 'up'],
    ['moveBlockDown', 'down'],
  ] as const) {
    for (const key of configuredKeys[name] ?? []) {
      moves[key] = bindings[key] = (state) => {
        // In a table, and when nothing can be edited, the key goes on to the
        // table's own bindings and the web view, which moves the caret.
        if (!actions.ready() || !actions.writable() || actions.literalSurface())
          return false
        const move = blockMove(state, direction)
        if (!move) return false
        if (move === 'move' && !actions.composing() && !actions.pending())
          actions.run(() => actions.moveBlock(direction), false)
        return true
      }
    }
  }
  // Not in `readOnlyKeys`: with nothing to edit, these keys do nothing and are not consumed, so
  // Tab still moves focus.
  const indents: Record<string, Command> = {}
  const sink: Command = (state, dispatch) =>
    sinkListItem(state.schema.nodes.list_item!)(state, dispatch)
  for (const [name, command] of [
    ['indent', sink],
    ['outdent', liftItem],
  ] as const) {
    for (const key of configuredKeys[name] ?? [])
      indents[key] = (state, dispatch, view) =>
        actions.ready() && actions.writable() && !actions.literalSurface()
          ? command(state, dispatch, view)
          : false
  }
  for (const command of tableCommands) {
    for (const key of configuredKeys[tableShortcut(command)] ?? [])
      bindings[key] = (state, dispatch, view) => {
        if (!actions.ready() || !actions.commandState().commands.table[command])
          return moves[key]?.(state, dispatch, view) ?? false
        return actions.run(() => actions.table(command), true)
      }
  }
  const readOnlyKeys = keydownHandler(
    Object.fromEntries(
      Object.keys(bindings)
        // A block move key is a caret key while nothing can be edited.
        .filter((key) => !moves[key])
        .map((key) => [
          key,
          bindings[key] === openLink
            ? openLink
            : () => {
                throw new InkKitError('read-only', 'The editor is read-only')
              },
        ]),
    ),
  )
  const keys = keydownHandler(bindings)
  const readingKeys = keydownHandler(
    Object.fromEntries(
      Object.entries(bindings).filter(([, handler]) => handler === openLink),
    ),
  )
  const indentKeys = keydownHandler(indents)
  const literalKeys = keydownHandler(historyBindings)
  return {
    readOnlyKeys,
    keys,
    readingKeys,
    indentKeys,
    literalKeys,
  }
}

interface KeyPlugins {
  writable(): boolean
  reading: KeyHandler
  keys: KeyHandler
  footnote(target: 'definition' | 'reference'): boolean
}

// Handlers read the current bindings; changing the keymap does not replace plugins.
export function createKeymapPlugin(runtime: KeyPlugins) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('appKeymap'),
        props: {
          // ProseMirror skips its editable keydown handler on read-only views.
          handleDOMEvents: {
            keydown: (view, event) => {
              if (!runtime.writable() && runtime.reading(view, event)) {
                event.preventDefault()
                return true
              }
              return false
            },
          },
          handleKeyDown: (view, event) => {
            if (event.altKey && event.key === 'Enter')
              return runtime.footnote(
                event.shiftKey ? 'reference' : 'definition',
              )
            return runtime.keys(view, event)
          },
        },
      }),
  )
}

// Milkdown's table-creation Tab binding must run before list indentation.
export function createIndentPlugin(handler: KeyHandler) {
  return new Plugin({
    key: new PluginKey('listIndent'),
    props: { handleKeyDown: handler },
  })
}

interface NativeKeyRouting {
  literal(): boolean
  writable(): boolean
  view(): EditorView
  readOnly: KeyHandler
  literalKeys: KeyHandler
  source(event: KeyboardEvent): boolean
  footnote(target: 'definition' | 'reference'): boolean
  refuseMutation(): void
}

export function routeNativeKey(
  event: KeyboardEvent,
  runtime: NativeKeyRouting,
): boolean {
  const { key, metaKey, ctrlKey, altKey, shiftKey } = event
  if (!runtime.literal() && altKey && key === 'Enter')
    return runtime.footnote(shiftKey ? 'reference' : 'definition')
  if (
    !runtime.writable() &&
    !runtime.literal() &&
    key === 'Tab' &&
    !metaKey &&
    !ctrlKey &&
    !altKey
  ) {
    const view = runtime.view()
    return goToNextCell(shiftKey ? -1 : 1)(view.state, view.dispatch)
  }
  if (!runtime.writable()) {
    if (!runtime.literal() && runtime.readOnly(runtime.view(), event))
      return true
    if (['Enter', 'Tab', 'Backspace', 'Delete'].includes(key))
      runtime.refuseMutation()
    if (runtime.literal()) runtime.readOnly(runtime.view(), event)
  }
  if (runtime.literal()) {
    if (runtime.literalKeys(runtime.view(), event)) return true
    return runtime.source(event)
  }
  const view = runtime.view()
  return Boolean(
    view.someProp('handleKeyDown', (handler) => handler(view, event)),
  )
}
