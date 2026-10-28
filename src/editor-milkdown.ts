import {
  Editor,
  defaultValueCtx,
  editorStateOptionsCtx,
  schemaCtx,
  prosePluginsCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import {
  EditorState,
  type Plugin,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { SearchQuery, setSearchState } from 'prosemirror-search'
import { terminalSelection } from './editor-selection'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose, type $UserKeymap } from '@milkdown/kit/utils'
import {
  blockquoteKeymap,
  bulletListKeymap,
  codeBlockKeymap,
  emphasisKeymap,
  headingKeymap,
  inlineCodeKeymap,
  listItemKeymap,
  orderedListKeymap,
  paragraphKeymap,
  strongKeymap,
} from '@milkdown/kit/preset/commonmark'
import { strikethroughKeymap, tableKeymap } from '@milkdown/kit/preset/gfm'
import { history, historyKeymap } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { authoredSourcesCtx, type AuthoredSources } from './block-conversion'
import { smartPunctuationCtx } from './smart-punctuation'
import { linkSchemesCtx } from './link-safety'
import { labelsCtx, defaultLabels } from './labels'
import { codeControlCtx, codeControlsPlugin } from './code-controls'
import { tableControlCtx, tableBlock } from './table-block'
import { createDialect, stringifyOptions } from './dialect'
import { tablePlugins } from './tables'
import { cursor } from './cursor'
import { visibleClipboard } from './clipboard'
import { highlightKeymap } from './inline-highlight'
import { taskListPlugin } from './tasks'
import { literalEnter, literalReread } from './literal-edits'
import { codeCopyPlugin, placeholderPlugin } from './decorations'
import { diagramsAvailable, mermaidPreview } from './mermaid'
import { selectionPlugin } from './selection'
import { search } from './search'
import { wikiLinkView } from './wiki-view'
import { imageView } from './images'
import {
  undoTypedRule,
  quoteBackspace,
  calloutEnter,
  listItemBackspace,
  nestedItemEnter,
  rejoinLists,
  movedListItems,
  textInputPolicy,
} from './editor-input'
import type { EditorOptions } from './editor'
import type { DocumentContext } from './types'

interface MilkdownRuntime {
  plugins: {
    indent: Plugin
    paste: MilkdownPlugin
    suggestions: MilkdownPlugin
    keymap: MilkdownPlugin
    change: MilkdownPlugin
    historyInput: MilkdownPlugin
    policy: MilkdownPlugin
  }
  authoredSources: AuthoredSources
  smartPunctuation(): boolean
  linkSchemes: ReadonlySet<string>
  mutate(operation: () => boolean): boolean
  dispatchTransaction(view: EditorView, transaction: Transaction): void
  revealSelection(): void
  visibleRect: Parameters<typeof codeControlsPlugin>[0]
  capture(): { context: DocumentContext; isCurrent(): boolean }
  active(): boolean
  canMutate(): boolean
  report(error: unknown): void
  copy?(text: string): void
}

/** Assemble plugins in their input and transaction precedence order. The facade owns mutation guards. */
export async function createMilkdownEditor(
  root: HTMLElement,
  options: EditorOptions,
  runtime: MilkdownRuntime,
): Promise<Editor> {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(authoredSourcesCtx.key, (doc, positions) =>
        runtime.authoredSources(doc, positions),
      )
      ctx.set(smartPunctuationCtx.key, () => runtime.smartPunctuation())
      ctx.set(linkSchemesCtx.key, runtime.linkSchemes)
      ctx.update(labelsCtx.key, () => ({
        ...defaultLabels,
        ...options.labels,
      }))
      ctx.set(codeControlCtx.key, (operation) => runtime.mutate(operation))
      ctx.set(tableControlCtx.key, (operation) => runtime.mutate(operation))
      ctx.set(defaultValueCtx, '')
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
      ctx.update(editorStateOptionsCtx, (override) => (options) => {
        const next = override(options)
        return {
          ...next,
          plugins: [...(next.plugins ?? []), runtime.plugins.indent],
        }
      })
      // The preset binds Tab, Shift-Tab, Mod-[ and Mod-] to list indentation. The keymap's
      // `indent` and `outdent` bind it instead.
      ctx.update(listItemKeymap.key, (keys) => ({
        ...keys,
        SinkListItem: { shortcuts: [] },
        LiftListItem: { shortcuts: [] },
      }))
      // Formatting keys are the app's to set, through setKeymap; the presets' own go.
      const unbind = <K extends string>(
        keymap: $UserKeymap<string, K>,
        keep: K[] = [],
      ) =>
        ctx.update(keymap.key, (keys) => {
          const cleared = { ...keys }
          for (const name of Object.keys(cleared) as K[]) {
            if (!keep.includes(name)) cleared[name] = { shortcuts: [] }
          }
          return cleared
        })
      unbind(tableKeymap, ['NextCell', 'PrevCell'])
      unbind(historyKeymap)
      unbind(strongKeymap)
      unbind(emphasisKeymap)
      unbind(inlineCodeKeymap)
      unbind(strikethroughKeymap)
      unbind(highlightKeymap)
      unbind(headingKeymap, ['DowngradeHeading'])
      unbind(paragraphKeymap)
      unbind(blockquoteKeymap)
      unbind(codeBlockKeymap)
      unbind(bulletListKeymap)
      unbind(orderedListKeymap)
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        dispatchTransaction: function (this: EditorView, tr) {
          runtime.dispatchTransaction(this, tr)
        },
        handleScrollToSelection: () => {
          runtime.revealSelection()
          return true
        },
      }))
    })
    .use(labelsCtx)
    .use(linkSchemesCtx)
    .use(runtime.plugins.paste)
    .use(visibleClipboard)
    .use(runtime.plugins.suggestions)
    .use(runtime.plugins.keymap)
    .use(
      createDialect(
        Boolean(options.images || options.files),
        Boolean(options.wikiLinks),
        Boolean(options.files),
      ),
    )
    .use(codeControlCtx)
    .use(codeControlsPlugin(() => runtime.visibleRect()))
    .use(tablePlugins)
    .use(tableBlock)
    .use(runtime.plugins.change)
    .use(runtime.plugins.historyInput)
    .use(history)
    .use(clipboard)
    .use(cursor)
    .use(taskListPlugin((operation) => runtime.mutate(operation)))
    .use(undoTypedRule)
    .use(quoteBackspace)
    .use(calloutEnter)
    .use(literalEnter)
    .use(literalReread)
    .use(listItemBackspace)
    .use(nestedItemEnter)
    .use(rejoinLists)
    .use(movedListItems)
    .use(textInputPolicy)
    .use(runtime.copy ? codeCopyPlugin((text) => runtime.copy?.(text)) : [])
    .use(placeholderPlugin)
    .use(
      options.rendering?.codeHighlighting === false
        ? []
        : (await import('./highlight.js')).highlightPlugin,
    )
    .use(
      options.rendering?.diagramPreview === false || !diagramsAvailable()
        ? []
        : mermaidPreview((error) => runtime.report(error)),
    )
    .use(selectionPlugin)
    .use($prose(() => search()))
    .use(runtime.plugins.policy)
    .use(
      options.wikiLinks
        ? wikiLinkView(options.wikiLinks, {
            capture: () => runtime.capture(),
            active: () => runtime.active(),
            labels: { ...defaultLabels, ...options.labels },
            error: (error) => runtime.report(error),
          })
        : [],
    )
    .use(
      options.images || options.files
        ? imageView(
            options.images,
            {
              capture: () => runtime.capture(),
              active: () => runtime.active(),
              labels: { ...defaultLabels, ...options.labels },
              error: (error) => runtime.report(error),
            },
            options.files,
            runtime.canMutate,
          )
        : [],
    )
    .create()
}

export function createDocumentState(ctx: Ctx, doc: ProseNode): EditorState {
  return EditorState.create(
    ctx.get(editorStateOptionsCtx)({
      schema: ctx.get(schemaCtx),
      doc,
      plugins: ctx.get(prosePluginsCtx),
    }),
  )
}

export function initialDocumentSelection(state: EditorState): Transaction {
  const end = terminalSelection(state.doc)
  return setSearchState(
    state.tr.setSelection(end),
    new SearchQuery({ search: '' }),
  )
}
