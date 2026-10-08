import { $node, $prose, $remark } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Nodes, Parent, Root, RootContent } from 'mdast'
import type { Processor } from 'unified'
import { defaultHandlers, type Handle } from 'mdast-util-to-markdown'

interface Callout extends Parent {
  type: 'inkkitCallout'
  kind: string
  marker: string
  fold: string
  title: string
  titleSource: string
  children: RootContent[]
}
declare module 'mdast' {
  interface BlockContentMap {
    inkkitCallout: Callout
  }
  interface RootContentMap {
    inkkitCallout: Callout
  }
}

const kinds = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])

const calloutHandler: Handle = (untyped, parent, state, info) => {
  const node = untyped as Callout
  const body = defaultHandlers.blockquote(
    { type: 'blockquote', children: node.children as never },
    parent,
    state,
    info,
  )
  const title = node.titleSource ?? node.title
  return `> ${node.marker}${node.fold}${title ? ` ${title}` : ''}\n${body}`
}

function remarkCallouts(this: Processor) {
  const data = this.data() as Record<string, unknown[] | undefined>
  ;(data.toMarkdownExtensions ??= []).push({
    handlers: { inkkitCallout: calloutHandler },
  })
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value).replace(/^\uFEFF/, '')
    const visit = (node: Nodes): Nodes => {
      if (node.type === 'blockquote') {
        const start = node.position?.start.offset,
          end = node.position?.end.offset
        const raw = start == null || end == null ? '' : source.slice(start, end)
        const header = /^>[ \t]*([\s\S]*?)(?:\r?\n|$)/.exec(raw)?.[1] ?? ''
        if (header.startsWith('[!')) {
          const match = /^(\[!([A-Za-z]+)\])([+-]?)(?:[ \t]+([^\r\n]*))?$/.exec(
            header,
          )
          const first = node.children[0]
          // A bounded header occupies one unformatted line; other variants stay source.
          if (
            !match ||
            !kinds.has(match[2]!.toUpperCase()) ||
            /^[+-](?:[ \t]|[+-])/.test(match[4] ?? '') ||
            first?.type !== 'paragraph' ||
            first.children[0]?.type !== 'text'
          )
            return {
              type: 'inkkitLiteral',
              value: raw,
              position: node.position,
            }
          const text = first.children[0]
          const lineEnd = text.value.indexOf('\n')
          if (lineEnd < 0 && first.children.length > 1)
            return {
              type: 'inkkitLiteral',
              value: raw,
              position: node.position,
            }
          const children = [...node.children]
          if (lineEnd >= 0) {
            const remaining = text.value.slice(lineEnd + 1)
            const firstStart = text.position?.start.offset
            const token =
              firstStart == null
                ? ''
                : source.slice(firstStart, text.position?.end.offset)
            const boundary = /\r?\n[ \t]*>[ \t]?/.exec(token)
            const bodyStart =
              firstStart == null || !boundary
                ? undefined
                : firstStart + boundary.index + boundary[0].length
            const point =
              bodyStart == null
                ? undefined
                : {
                    line: source.slice(0, bodyStart).split('\n').length,
                    column: bodyStart - source.lastIndexOf('\n', bodyStart - 1),
                    offset: bodyStart,
                  }
            children[0] = {
              ...first,
              children: [
                ...(remaining
                  ? [
                      {
                        ...text,
                        value: remaining,
                        position:
                          point && text.position
                            ? { start: point, end: text.position.end }
                            : undefined,
                      },
                    ]
                  : []),
                ...first.children.slice(1),
              ],
            }
          } else children.shift()
          if (!children.length)
            children.push({ type: 'paragraph', children: [] })
          return {
            type: 'inkkitCallout',
            kind: match[2]!.toUpperCase(),
            marker: match[1]!,
            fold: match[3]!,
            title: text.value
              .split(/\r?\n/)[0]!
              .replace(/^\[![A-Za-z]+\][+-]?[ \t]*/, '')
              .trimEnd(),
            titleSource: match[4]?.trimEnd() ?? '',
            children: children.map(visit) as RootContent[],
            position: node.position,
          }
        }
      }
      if ('children' in node) node.children = node.children.map(visit) as never
      return node
    }
    tree.children = tree.children.map(visit) as RootContent[]
  }
}

export const remarkCalloutsPlugin = $remark(
  'inkkitCallouts',
  () => remarkCallouts,
)

export const calloutSchema = $node('inkkit_callout', () => ({
  group: 'block',
  content: 'block+',
  defining: true,
  attrs: {
    kind: { default: 'NOTE' },
    marker: { default: '[!NOTE]' },
    fold: { default: '' },
    title: { default: '' },
    titleSource: { default: null },
  },
  parseDOM: [
    {
      tag: 'blockquote[data-inkkit-callout]',
      priority: 100,
      contentElement: '.inkkit-callout-body',
      getAttrs: (dom) => {
        const kind = (
          dom.getAttribute('data-inkkit-callout') ?? ''
        ).toUpperCase()
        const marker = dom.getAttribute('data-inkkit-marker') ?? `[!${kind}]`
        const fold = dom.getAttribute('data-inkkit-fold') ?? ''
        if (
          !kinds.has(kind) ||
          !/^\[![A-Za-z]+\]$/.test(marker) ||
          marker.slice(2, -1).toUpperCase() !== kind ||
          !['', '+', '-'].includes(fold)
        )
          return false
        return {
          kind,
          marker,
          fold,
          title:
            dom.getAttribute('data-inkkit-title') === ''
              ? ''
              : (dom.querySelector('.inkkit-callout-title')?.textContent ?? ''),
          titleSource: dom.getAttribute('data-inkkit-title'),
        }
      },
    },
  ],
  toDOM: (node) => [
    'blockquote',
    {
      class: 'inkkit-callout',
      'data-inkkit-callout': node.attrs.kind,
      'data-inkkit-marker': node.attrs.marker,
      'data-inkkit-fold': node.attrs.fold,
      'data-inkkit-title': node.attrs.titleSource ?? node.attrs.title,
    },
    [
      'strong',
      { class: 'inkkit-callout-title' },
      node.attrs.title ||
        String(node.attrs.kind)
          .toLowerCase()
          .replace(/^./, (letter) => letter.toUpperCase()),
    ],
    ['div', { class: 'inkkit-callout-body' }, 0],
  ],
  parseMarkdown: {
    match: (node) => node.type === 'inkkitCallout',
    runner(state, node, type) {
      state.openNode(type, {
        kind: node.kind,
        marker: node.marker,
        fold: node.fold,
        title: node.title,
        titleSource: node.titleSource,
      })
      state.next(node.children)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'inkkit_callout',
    runner(state, node) {
      state.openNode('inkkitCallout', undefined, { ...node.attrs })
      state.next(node.content)
      state.closeNode()
    },
  },
}))

export const calloutView = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitCalloutView'),
      props: {
        nodeViews: {
          inkkit_callout(node) {
            const dom = document.createElement('blockquote')
            dom.className = 'inkkit-callout'
            dom.setAttribute('data-inkkit-callout', String(node.attrs.kind))
            const header = document.createElement('div')
            header.className = 'inkkit-callout-header'
            header.contentEditable = 'false'
            const title = document.createElement('strong')
            title.className = 'inkkit-callout-title'
            const contentDOM = document.createElement('div')
            contentDOM.className = 'inkkit-callout-body'
            let folded = node.attrs.fold === '-'
            const button = document.createElement('button')
            button.type = 'button'
            button.setAttribute('data-inkkit-callout-toggle', '')
            const render = () => {
              title.textContent =
                node.attrs.title ||
                String(node.attrs.kind)
                  .toLowerCase()
                  .replace(/^./, (letter) => letter.toUpperCase())
              dom.setAttribute('data-inkkit-folded', String(folded))
              button.hidden = !node.attrs.fold
              button.setAttribute('aria-expanded', String(!folded))
              button.setAttribute(
                'aria-label',
                `${folded ? 'Expand' : 'Collapse'} ${title.textContent}`,
              )
              button.textContent = folded ? 'Expand' : 'Collapse'
            }
            const toggle = () => {
              folded = !folded
              render()
            }
            button.addEventListener('click', toggle)
            button.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                toggle()
              }
            })
            header.append(title, button)
            dom.append(header, contentDOM)
            render()
            return {
              dom,
              contentDOM,
              update(next) {
                if (next.type !== node.type) return false
                if (next.attrs.fold !== node.attrs.fold)
                  folded = next.attrs.fold === '-'
                node = next
                render()
                return true
              },
              stopEvent: (event) =>
                header.contains(event.target as globalThis.Node),
              ignoreMutation: (mutation) =>
                mutation.type !== 'selection' &&
                !contentDOM.contains(mutation.target),
            }
          },
        },
      },
    }),
)

export const callouts = [calloutSchema, calloutView].flat()
