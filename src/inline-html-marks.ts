import { remarkCtx } from '@milkdown/kit/core'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $command, $inputRule, $markSchema, $remark } from '@milkdown/kit/utils'
import type { Html, Nodes, Parent, PhrasingContent, Root } from 'mdast'
import type { Handle } from 'mdast-util-to-markdown'
import type { Processor } from 'unified'

/** The mdast node types for the marks that Markdown writes as HTML tags. */
export type HTMLMarkType = 'underline' | 'superscript' | 'subscript'

interface HTMLMark extends Parent {
  type: HTMLMarkType
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    underline: HTMLMark & { type: 'underline' }
    superscript: HTMLMark & { type: 'superscript' }
    subscript: HTMLMark & { type: 'subscript' }
  }
  interface RootContentMap {
    underline: HTMLMark & { type: 'underline' }
    superscript: HTMLMark & { type: 'superscript' }
    subscript: HTMLMark & { type: 'subscript' }
  }
}

const tagOf: Record<HTMLMarkType, string> = {
  underline: 'u',
  superscript: 'sup',
  subscript: 'sub',
}
const typeOf: Record<string, HTMLMarkType> = {
  u: 'underline',
  sup: 'superscript',
  sub: 'subscript',
}

export const htmlMarkTypes: ReadonlySet<string> = new Set(Object.keys(tagOf))

// The editor cannot hold the same mark twice over one character, and a
// superscript cannot also be a subscript.
const group = (type: HTMLMarkType) =>
  type === 'underline' ? 'underline' : 'script'

// Inline content that can hold the tags as phrasing HTML. HTML elsewhere is
// an HTML block, which is never paired.
const phrasingParents = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'emphasis',
  'strong',
  'delete',
  'highlight',
  'link',
  'linkReference',
  ...htmlMarkTypes,
])

const opening = /^<(u|sup|sub)>$/
const closing = /^<\/(u|sup|sub)>$/

// Whether the content holds text that is not whitespace, or a node such as an
// image, so the mark has something to cover once spaces move out of it.
function holdsContent(nodes: readonly PhrasingContent[]): boolean {
  return nodes.some((node) =>
    node.type === 'text' || node.type === 'inlineCode'
      ? /\S/.test(node.value)
      : 'children' in node
        ? holdsContent(node.children as PhrasingContent[])
        : node.type !== 'break' && node.type !== 'html',
  )
}

/**
 * The children with each exact `<u>`, `<sup>` and `<sub>` tag pair made a
 * mark node, or undefined when a tag in them cannot pair: a tag without its
 * partner, tags that cross, a pair with nothing inside, or one inside a mark
 * of its own group. Those keep every tag as HTML, so the block stays literal.
 */
function paired(
  children: readonly PhrasingContent[],
  open: ReadonlySet<string>,
): PhrasingContent[] | undefined {
  const result: PhrasingContent[] = []
  const stack: Array<{ type: HTMLMarkType; at: number; tag: Html }> = []
  let tags = false
  for (const child of children) {
    if (child.type !== 'html') {
      result.push(child)
      continue
    }
    const start = opening.exec(child.value)?.[1]
    const end = start ? undefined : closing.exec(child.value)?.[1]
    if (start) {
      tags = true
      const type = typeOf[start]!
      if (
        open.has(group(type)) ||
        stack.some((entry) => group(entry.type) === group(type))
      )
        return undefined
      stack.push({ type, at: result.length, tag: child })
      result.push(child)
      continue
    }
    if (!end) {
      result.push(child)
      continue
    }
    tags = true
    const top = stack.pop()
    if (!top || top.type !== typeOf[end]) return undefined
    const inside = result.splice(top.at)
    inside.shift()
    if (!holdsContent(inside)) return undefined
    const startPoint = top.tag.position?.start
    const endPoint = child.position?.end
    result.push({
      type: top.type,
      children: inside,
      ...(startPoint && endPoint
        ? { position: { start: startPoint, end: endPoint } }
        : {}),
    } as PhrasingContent)
  }
  if (stack.length) return undefined
  return tags ? result : [...children]
}

/**
 * Pairs the HTML tags that write underline, superscript and subscript into
 * their own nodes, as the reader builds the tree. Every reader of the
 * dialect, including preservation's, then sees the same marks, and the
 * literal check finds HTML only where a tag stays unpaired.
 */
export function pairHTMLMarks(tree: Root): undefined {
  const visit = (node: Nodes, open: ReadonlySet<string>) => {
    if (!('children' in node)) return
    if (phrasingParents.has(node.type)) {
      const children = paired(node.children as PhrasingContent[], open)
      if (children) (node as Parent).children = children
    }
    for (const child of node.children) {
      const inner = htmlMarkTypes.has(child.type)
        ? new Set([...open, group(child.type as HTMLMarkType)])
        : open
      visit(child, inner)
    }
  }
  visit(tree, new Set())
  return undefined
}

function handler(type: HTMLMarkType): Handle {
  const tag = tagOf[type]
  const handle: Handle & { peek?: Handle } = (node, _parent, state, info) => {
    const exit = state.enter('phrasing')
    const tracker = state.createTracker(info)
    let value = tracker.move(`<${tag}>`)
    value += tracker.move(
      state.containerPhrasing(node as HTMLMark, {
        ...tracker.current(),
        before: '>',
        after: '<',
      }),
    )
    value += tracker.move(`</${tag}>`)
    exit()
    return value
  }
  handle.peek = () => '<'
  return handle
}

function remarkHTMLMarks(this: Processor) {
  const data = this.data() as Record<string, unknown[] | undefined>
  ;(data.fromMarkdownExtensions ??= []).push({ transforms: [pairHTMLMarks] })
  ;(data.toMarkdownExtensions ??= []).push({
    handlers: {
      underline: handler('underline'),
      superscript: handler('superscript'),
      subscript: handler('subscript'),
    },
  })
}

const remarkHTMLMarksPlugin = $remark('inkkitHTMLMarks', () => remarkHTMLMarks)

function markSchema(type: HTMLMarkType, name: string) {
  const tag = tagOf[type]
  return $markSchema(name, () => ({
    // Outside the other marks, which read the same either way round.
    priority: 40,
    ...(type === 'underline' ? {} : { excludes: 'superscript subscript' }),
    parseDOM: [
      {
        tag,
        // A footnote reference is also drawn as `sup`.
        getAttrs: (dom: HTMLElement) =>
          dom.hasAttribute('data-inkkit-footnote-reference') ? false : null,
      },
    ],
    toDOM: () => [tag, 0],
    parseMarkdown: {
      match: (node) => node.type === type,
      runner(state, node, markType) {
        state.openMark(markType)
        state.next(node.children)
        state.closeMark(markType)
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === name,
      runner(state, mark, node) {
        if (node.isText && /^\s*$/.test(node.text ?? '')) return
        state.withMark(mark, type)
      },
    },
  }))
}

export const underlineSchema = markSchema('underline', 'underline')
export const superscriptSchema = markSchema('superscript', 'superscript')
export const subscriptSchema = markSchema('subscript', 'subscript')

export const toggleUnderlineCommand = $command(
  'ToggleUnderline',
  (ctx) => () => toggleMark(underlineSchema.type(ctx)),
)
export const toggleSuperscriptCommand = $command(
  'ToggleSuperscript',
  (ctx) => () => toggleMark(superscriptSchema.type(ctx)),
)
export const toggleSubscriptCommand = $command(
  'ToggleSubscript',
  (ctx) => () => toggleMark(subscriptSchema.type(ctx)),
)

// Typing the closing tag formats the text since the opening one, when the
// dialect reads the typed source as exactly that pair.
function tagInputRule(type: HTMLMarkType, schema: typeof underlineSchema) {
  const tag = tagOf[type]
  return $inputRule((ctx) => {
    const pattern = new RegExp(`<${tag}>([^<\\n]+)</${tag}>$`)
    return new InputRule(pattern, (state, match, start, end) => {
      const markType = schema.type(ctx)
      const $from = state.selection.$from
      // An existing mark of this group, or code, would not reopen as the
      // tags typed.
      if (
        $from
          .marks()
          .some((mark) => mark.type.spec.code || mark.type.excludes(markType))
      )
        return null
      const parentStart = $from.start()
      const prefix = $from.parent.textBetween(0, start - parentStart)
      const source = prefix + match[0]
      const tree = ctx.get(remarkCtx).parse(source) as Root
      let valid = false
      const walk = (node: Nodes) => {
        if (
          node.type === type &&
          node.position?.start.offset === prefix.length &&
          node.position.end.offset === source.length
        )
          valid = true
        if ('children' in node) node.children.forEach(walk)
      }
      walk(tree)
      if (!valid) return null
      // The document holds the typed text up to the final `>`, which the
      // rule takes in place of inserting it.
      const textStart = start + tag.length + 2
      const textEnd = textStart + match[1]!.length
      return state.tr
        .delete(textEnd, end)
        .delete(start, textStart)
        .addMark(start, start + match[1]!.length, markType.create())
        .removeStoredMark(markType)
    })
  })
}

export const htmlMarks = [
  remarkHTMLMarksPlugin,
  underlineSchema,
  superscriptSchema,
  subscriptSchema,
  toggleUnderlineCommand,
  toggleSuperscriptCommand,
  toggleSubscriptCommand,
  tagInputRule('underline', underlineSchema),
  tagInputRule('superscript', superscriptSchema),
  tagInputRule('subscript', subscriptSchema),
].flat()
