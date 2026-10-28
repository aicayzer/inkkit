import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Suggestions, type SuggestionSession } from './suggestions'
import { slashSession, slashTransaction } from './slash-menu'
import { wikiSession, wikiSuggestionTransaction } from './wiki-suggestions'
import { coded, invalidArgument } from './errors'
import type {
  DocumentContext,
  EditorLabels,
  SlashMenuOptions,
  SlashCommandName,
  SlashCommand,
  WikiLinkAdapter,
} from './types'

interface SuggestionProviders {
  root: HTMLElement
  labels(): EditorLabels
  slashMenu(): SlashMenuOptions | undefined
  wikiLinks(): WikiLinkAdapter | undefined
  diagrams(): boolean
  active(): boolean
  context(): DocumentContext
  chooseSlash(
    session: SuggestionSession,
    command: SlashCommandName | SlashCommand,
    kind?: string,
  ): void
  chooseWiki(session: SuggestionSession, name: string): void
  report(error: unknown): void
}

export function createEditorSuggestions(
  runtime: SuggestionProviders,
): Suggestions {
  const suggestions = new Suggestions({
    root: runtime.root,
    labels: runtime.labels(),
    active: () => runtime.active(),
    start: (view, from, to, text) =>
      slashSession(view, from, to, text, {
        options: runtime.slashMenu(),
        labels: runtime.labels(),
        diagrams: runtime.diagrams(),
        choose: (session, command, kind) =>
          runtime.chooseSlash(session, command, kind),
      }) ??
      wikiSession(view, from, to, text, {
        adapter: runtime.wikiLinks(),
        context: () => runtime.context(),
        choose: (session, name) => runtime.chooseWiki(session, name),
        error: (error) => {
          suggestions.close()
          runtime.report(error)
        },
      }),
  })
  return suggestions
}

export function insertWikiSuggestion(
  view: EditorView,
  session: SuggestionSession,
  name: string,
): void {
  view.dispatch(wikiSuggestionTransaction(view, session, name))
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
}

export function insertSlashSuggestion(
  ctx: Ctx,
  base: EditorState,
  value: SlashCommandName | { markdown: string },
  kind: string | undefined,
  withBase: (operation: () => void) => void,
): void {
  const view = ctx.get(editorViewCtx)
  const tr = slashTransaction(ctx, base, value, kind)
  withBase(() => view.dispatch(tr.scrollIntoView()))
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
}

interface HostSlashAction {
  context(): DocumentContext
  destroyed(): boolean
  commit(markdown: string): void
  report(error: unknown): void
}

export function runSlashAction(
  command: SlashCommand,
  runtime: HostSlashAction,
): void {
  // Only the host action's throws or rejections belong to its failure handler.
  // Inkkit's own insertion reports through the facade commit boundary.
  const onHostError = (error: unknown) => {
    if (!runtime.destroyed())
      runtime.report(coded(error, 'slash-command-failed'))
  }
  const insert = (markdown: string | undefined) => {
    if (runtime.destroyed()) return
    if (markdown === undefined) return
    if (typeof markdown !== 'string') {
      runtime.report(
        invalidArgument('A slash command must return Markdown text'),
      )
      return
    }
    runtime.commit(markdown)
  }
  let result: ReturnType<SlashCommand['action']>
  try {
    result = command.action(runtime.context())
  } catch (error) {
    onHostError(error)
    return
  }
  if (result instanceof Promise) result.then(insert, onHostError)
  else insert(result)
}
