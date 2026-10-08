import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { $remark } from '@milkdown/kit/utils'
import type { Root, Nodes, Code } from 'mdast'
import { defaultHandlers, type Options } from 'mdast-util-to-markdown'
import type { Ctx } from '@milkdown/kit/ctx'
import { remarkCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'

interface Fence {
  marker: string
  info: string
  close: string
  trailing: string
  ending: string
}

function readFence(value: unknown): Fence | null {
  if (typeof value !== 'object' || value == null) return null
  const fence = value as Fence
  return typeof fence.marker === 'string' &&
    /^(?:`{3,}|~{3,})$/.test(fence.marker) &&
    fence.marker.length <= 30000 &&
    typeof fence.info === 'string' &&
    !/[\r\n]/.test(fence.info) &&
    typeof fence.close === 'string' &&
    (!fence.close ||
      new RegExp(`^${fence.marker[0]}{${fence.marker.length},}$`).test(
        fence.close,
      )) &&
    typeof fence.trailing === 'string' &&
    /^[ \t]*$/.test(fence.trailing) &&
    ['\n', '\r\n'].includes(fence.ending)
    ? fence
    : null
}

export const remarkCodeFences = $remark(
  'codeFences',
  () => () => (tree: Root, file: { value: unknown }) => {
    const source = String(file.value).replace(/^\uFEFF/, '')
    const visit = (node: Nodes) => {
      if (node.type === 'code') {
        const raw = source.slice(
          node.position?.start.offset,
          node.position?.end.offset,
        )
        const opening = /^(`{3,}|~{3,})([^\r\n]*)(\r?\n)/.exec(raw)
        if (opening) {
          const close = /(?:^|\n)[ \t>]*(`{3,}|~{3,})([ \t]*)\r?$/.exec(raw)
          const matching =
            close &&
            close[1]![0] === opening[1]![0] &&
            close[1]!.length >= opening[1]!.length
          node.data = {
            ...node.data,
            inkkitFence: {
              marker: opening[1],
              info: opening[2],
              close: matching ? close[1] : '',
              trailing: matching ? close[2] : '',
              ending: opening[3],
            },
          }
        }
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  },
)

export const preservingCodeBlocks = codeBlockSchema.extendSchema(
  (base) => (ctx) => {
    const schema = base(ctx)
    return {
      ...schema,
      attrs: { ...schema.attrs, authoredFence: { default: null } },
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full' as const,
          getAttrs: (dom: HTMLElement) => {
            let authoredFence: Fence | null = null
            try {
              authoredFence = readFence(
                JSON.parse(dom.getAttribute('data-inkkit-fence') ?? 'null'),
              )
            } catch {
              /* Ordinary code stays usable without provenance. */
            }
            return { language: dom.dataset.language ?? '', authoredFence }
          },
        },
      ],
      toDOM: (node) => [
        'pre',
        {
          'data-language': node.attrs.language,
          ...(node.attrs.authoredFence
            ? { 'data-inkkit-fence': JSON.stringify(node.attrs.authoredFence) }
            : {}),
        },
        ['code', 0],
      ],
      parseMarkdown: {
        match: (node) => node.type === 'code',
        runner: (state, node, type) => {
          state.openNode(type, {
            language: node.lang ?? '',
            authoredFence: readFence(
              (node.data as { inkkitFence?: unknown } | undefined)?.inkkitFence,
            ),
          })
          if (node.value)
            state.addText(String(node.value).replace(/\r\n?/g, '\n'))
          state.closeNode()
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === 'code_block',
        runner: (state, node) => {
          state.addNode('code', undefined, node.textContent, {
            lang: node.attrs.language,
            data: { inkkitFence: node.attrs.authoredFence },
          })
        },
      },
    }
  },
)

export const fencedCodeHandler: NonNullable<Options['handlers']>['code'] = (
  node: Code,
  parent,
  state,
  info,
) => {
  const fence = readFence(
    (node.data as { inkkitFence?: unknown } | undefined)?.inkkitFence,
  )
  if (!fence) return defaultHandlers.code!(node, parent, state, info)
  const character = fence.marker[0]!
  let length = fence.marker.length
  const body = node.value.replace(/\r\n?/g, '\n')
  for (const line of body.split('\n')) {
    const run = new RegExp(`^ {0,3}(${character}+)[ \\t]*$`).exec(line)
    if (run) length = Math.max(length, run[1]!.length + 1)
  }
  const close = fence.close
    ? character.repeat(Math.max(length, fence.close.length)) + fence.trailing
    : ''
  return (
    character.repeat(length) +
    fence.info +
    fence.ending +
    body.replaceAll('\n', fence.ending) +
    (close ? (body ? fence.ending : '') + close : '')
  )
}

export function restoreCodeEndings(
  ctx: Ctx,
  doc: ProseNode,
  markdown: string,
): string {
  const endings: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'code_block')
      endings.push(readFence(node.attrs.authoredFence)?.ending ?? '\n')
  })
  const patches: Array<{ from: number; to: number; text: string }> = []
  let index = 0
  const visit = (node: Nodes) => {
    if (node.type === 'code') {
      const ending = endings[index++]
      const from = node.position?.start.offset,
        to = node.position?.end.offset
      if (ending === '\r\n' && from != null && to != null)
        patches.push({
          from,
          to,
          text: markdown
            .slice(from, to)
            .replace(/\r\n?/g, '\n')
            .replaceAll('\n', ending),
        })
    }
    if ('children' in node) node.children.forEach(visit)
  }
  const processor = ctx.get(remarkCtx)
  visit(
    processor.runSync(processor.parse(markdown), { value: markdown }) as Root,
  )
  for (const patch of patches.reverse())
    markdown =
      markdown.slice(0, patch.from) + patch.text + markdown.slice(patch.to)
  return markdown
}

export function finalCodeEnding(doc: ProseNode): string | undefined {
  let last = doc.lastChild
  while (last) {
    if (last.type.name === 'code_block')
      return readFence(last.attrs.authoredFence)?.ending
    last = last.lastChild
  }
  return undefined
}
