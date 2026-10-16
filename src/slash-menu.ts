import type { Ctx } from '@milkdown/kit/ctx'
import { parserCtx } from '@milkdown/kit/core'
import { Fragment, Slice } from '@milkdown/kit/prose/model'
import {
  Selection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { closeHistory } from '@milkdown/kit/prose/history'
import { createTable } from '@milkdown/kit/preset/gfm'
import { convertTextblocks } from './block-conversion'
import type {
  EditorLabels,
  SlashCommandName,
  SlashCommand,
  SlashMenuOptions,
} from './types'
import {
  expectArray,
  expectOneOf,
  expectString,
  invalidArgument,
  optionalBoolean,
  optionalRecord,
} from './errors'
import type { SuggestionRow, SuggestionSession } from './suggestions'

export const slashCommands = [
  'heading1',
  'heading2',
  'heading3',
  'bulletList',
  'orderedList',
  'taskList',
  'quote',
  'codeBlock',
  'table',
  'callout',
  'divider',
  'diagram',
] as const
export function slashMenuOptions(value: unknown): SlashMenuOptions | undefined {
  const record = optionalRecord(value, 'options.slashMenu', [
    'enabled',
    'commands',
    'customCommands',
  ])
  if (!record) return undefined
  const enabled = optionalBoolean(record.enabled, 'slashMenu.enabled')
  const commands =
    record.commands == null
      ? undefined
      : expectArray(record.commands, 'slashMenu.commands').map((v) =>
          expectOneOf(v, slashCommands, 'slashMenu.commands'),
        )
  const customCommands =
    record.customCommands == null
      ? undefined
      : expectArray(record.customCommands, 'slashMenu.customCommands').map(
          (value) => {
            const entry = optionalRecord(value, 'slash command', [
              'name',
              'keywords',
              'action',
            ])
            if (!entry || typeof entry.action !== 'function')
              throw invalidArgument('A slash command needs an action')
            const name = expectString(entry.name, 'slash command.name')
            if (!name.trim())
              throw invalidArgument('A slash command needs a name')
            const keywords =
              entry.keywords == null
                ? undefined
                : expectArray(entry.keywords, 'slash command.keywords').map(
                    (v) => expectString(v, 'keyword'),
                  )
            return {
              name,
              keywords,
              action: entry.action as SlashCommand['action'],
            }
          },
        )
  return { enabled, commands, customCommands }
}
const aliases = [
  'h1 title',
  'h2 subtitle',
  'h3',
  'bullet ul',
  'number ol',
  'task todo',
  'blockquote',
  'code fence',
  'grid',
  'note tip warning',
  'line rule hr',
  'mermaid chart',
]
const glyphs = [
  'H1',
  'H2',
  'H3',
  '•',
  '1.',
  '☑',
  '❯',
  '</>',
  '▦',
  '▣',
  '―',
  '◇',
]
const callouts = ['Note', 'Tip', 'Important', 'Warning', 'Caution'] as const
export interface SlashHost {
  options?: SlashMenuOptions
  labels: Readonly<EditorLabels>
  diagrams: boolean
  choose(
    session: SuggestionSession,
    command: SlashCommandName | SlashCommand,
    kind?: string,
  ): void
}
export function slashSession(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  host: SlashHost,
): SuggestionSession | undefined {
  if (!host.options?.enabled || text !== '/' || from !== to) return
  const { $from } = view.state.selection
  if (
    !['paragraph', 'heading'].includes($from.parent.type.name) ||
    $from.parentOffset !== $from.parent.content.size ||
    ($from.parent.content.size &&
      $from.parent.lastChild?.type.name !== 'hardbreak')
  )
    return
  for (let depth = 1; depth <= $from.depth; depth++)
    if (
      ['table', 'code_block', 'literal_markdown', 'comment_block'].includes(
        $from.node(depth).type.name,
      )
    )
      return
  const session: SuggestionSession = {
    from,
    prefix: '/',
    base: view.state,
    query: '',
    valid: (current) =>
      current.state.tr
        .delete(from, current.state.selection.from)
        .doc.eq(session.base.doc),
    update(query, show) {
      const rows: SuggestionRow[] = []
      slashCommands.forEach((command, index) => {
        if (host.options?.commands && !host.options.commands.includes(command))
          return
        if (command === 'diagram' && !host.diagrams) return
        const name =
          host.labels[
            `slash${command[0]!.toUpperCase()}${command.slice(1)}` as keyof EditorLabels
          ]
        if (
          ![name, ...aliases[index]!.split(' ')].some((word) =>
            word.toLowerCase().startsWith(query.toLowerCase()),
          )
        )
          return
        rows.push({
          name,
          glyph: glyphs[index]!,
          choose: () => {
            if (command === 'callout')
              show(
                callouts.map((kind) => ({
                  name: host.labels[`slash${kind}`],
                  glyph: '▣',
                  choose: () => host.choose(session, command, kind),
                })),
              )
            else host.choose(session, command)
          },
        })
      })
      for (const command of host.options?.customCommands ?? [])
        if (
          [command.name, ...(command.keywords ?? [])].some((word) =>
            word.toLowerCase().startsWith(query.toLowerCase()),
          )
        )
          rows.push({
            name: command.name,
            glyph: '+',
            choose: () => host.choose(session, command),
          })
      show(rows)
    },
  }
  return session
}

/** The same conversion and parser used by formatting and Markdown import, committed once. */
export function slashTransaction(
  ctx: Ctx,
  base: EditorState,
  command: SlashCommandName | { markdown: string },
  kind = 'Note',
): Transaction {
  const { $from } = base.selection
  // Empty output removes the trigger without converting its original block.
  if (typeof command !== 'string' && command.markdown === '')
    return closeHistory(
      base.tr.replaceWith($from.before(), $from.after(), $from.parent),
    )
  if ($from.parent.content.size) {
    // An empty line after Shift+Return becomes a separate block. Keep the
    // preceding text and retain the original break in the undo baseline.
    const split = base.tr.delete($from.pos - 1, $from.pos).split($from.pos - 1)
    split.setSelection(Selection.near(split.doc.resolve($from.pos + 1)))
    const commandEdit = slashTransaction(ctx, base.apply(split), command, kind)
    for (const step of commandEdit.steps) split.step(step)
    split.setSelection(
      Selection.fromJSON(split.doc, commandEdit.selection.toJSON()),
    )
    return closeHistory(split)
  }
  const tr = closeHistory(base.tr)
  const pos = $from.before(),
    end = $from.after()
  const type = typeof command === 'string' ? command : 'custom'
  const heading = /^heading([123])$/.exec(type)
  if (
    heading &&
    convertTextblocks(
      ctx,
      tr,
      $from.pos,
      $from.pos,
      base.schema.nodes.heading!,
      { level: Number(heading[1]) },
    )
  )
    return tr
  if (
    (type === 'codeBlock' || type === 'diagram') &&
    convertTextblocks(
      ctx,
      tr,
      $from.pos,
      $from.pos,
      base.schema.nodes.code_block!,
      { language: type === 'diagram' ? 'mermaid' : '' },
    )
  )
    return tr
  const source: Record<string, string> = {
    heading1: '# \n',
    heading2: '## \n',
    heading3: '### \n',
    bulletList: '- \n',
    orderedList: '1. \n',
    taskList: '- [ ] placeholder\n',
    quote: '> \n',
    codeBlock: '```\n\n```\n',
    diagram: '```mermaid\n\n```\n',
    callout: `> [!${kind.toUpperCase()}]\n> \n`,
    divider: '---\n',
  }
  let nodes =
    type === 'table'
      ? Fragment.from(createTable(ctx, 3, 2))
      : ctx.get(parserCtx)(
          typeof command === 'string' ? source[type]! : command.markdown,
        ).content
  if (type === 'divider')
    nodes = nodes.append(Fragment.from(base.schema.nodes.paragraph!.create()))
  if (type === 'taskList') {
    const list = nodes.firstChild!,
      item = list.firstChild!,
      paragraph = item.firstChild!
    nodes = Fragment.from(
      list.copy(
        Fragment.from(item.copy(Fragment.from(paragraph.copy(Fragment.empty)))),
      ),
    )
  }
  // replaceRange fits a block at the current container boundary using the same
  // schema constraints as paste. It never leaves an invalid list item behind.
  const firstInItem =
    $from.node(-1).type.name === 'list_item' &&
    $from.index(-1) === 0 &&
    nodes.firstChild?.type.name !== 'paragraph'
  if (firstInItem)
    tr.replaceWith(
      pos,
      end,
      Fragment.from(base.schema.nodes.paragraph!.create()).append(nodes),
    )
  else tr.replaceRange(pos, end, new Slice(nodes, 0, 0))
  tr.setSelection(
    Selection.near(
      tr.doc.resolve(
        Math.min(pos + (firstInItem ? 3 : 1), tr.doc.content.size),
      ),
      1,
    ),
  )
  return tr
}
