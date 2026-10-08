import { $node, $prose, $remark } from '@milkdown/kit/utils'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Extension as FromExtension } from 'mdast-util-from-markdown'
import type {
  Code,
  Effects,
  Extension,
  State,
  Tokenizer,
} from 'micromark-util-types'
import type { Literal, Nodes, Root } from 'mdast'
import type { Handle } from 'mdast-util-to-markdown'
import type { Processor } from 'unified'

export type CommentSyntax = 'html' | 'obsidian'
interface Comment extends Literal {
  type: 'inkkitCommentInline' | 'inkkitCommentBlock'
  syntax: CommentSyntax
  block?: boolean
}
declare module 'mdast' {
  interface PhrasingContentMap {
    inkkitCommentInline: Comment & { type: 'inkkitCommentInline' }
  }
  interface BlockContentMap {
    inkkitCommentBlock: Comment & { type: 'inkkitCommentBlock' }
  }
  interface RootContentMap {
    inkkitCommentInline: Comment & { type: 'inkkitCommentInline' }
    inkkitCommentBlock: Comment & { type: 'inkkitCommentBlock' }
  }
}
declare module 'micromark-util-types' {
  interface TokenTypeMap {
    inkkitCommentInline: 'inkkitCommentInline'
    inkkitCommentBlock: 'inkkitCommentBlock'
    inkkitCommentData: 'inkkitCommentData'
  }
}

const lineEnding = (code: Code) => code === -3 || code === -4 || code === -5
const whitespace = (code: Code) => code === 32 || code === -1 || code === -2
function commentData(effects: Effects) {
  let open = false
  return {
    consume(code: Code) {
      if (!open) {
        effects.enter('inkkitCommentData')
        open = true
      }
      effects.consume(code)
    },
    close() {
      if (open) {
        effects.exit('inkkitCommentData')
        open = false
      }
    },
  }
}
const inlineComment: Tokenizer = function (effects, ok, nok) {
  const data = commentData(effects)
  return start
  function start(code: Code): State | undefined {
    effects.enter('inkkitCommentInline')
    data.consume(code)
    return second
  }
  function second(code: Code): State | undefined {
    if (code !== 37) return nok(code)
    data.consume(code)
    return body
  }
  function body(code: Code): State | undefined {
    if (code === null) return nok(code)
    if (lineEnding(code)) {
      data.close()
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return body
    }
    data.consume(code)
    return code === 37 ? closing : body
  }
  function closing(code: Code): State | undefined {
    if (code !== 37) return body(code)
    data.consume(code)
    data.close()
    effects.exit('inkkitCommentInline')
    return ok
  }
}

// A flow construct owns blank lines and Markdown-looking text inside a block comment.
const blockComment: Tokenizer = function (effects, ok, nok) {
  const data = commentData(effects)
  return start
  function start(code: Code): State | undefined {
    effects.enter('inkkitCommentBlock')
    data.consume(code)
    return second
  }
  function second(code: Code): State | undefined {
    if (code !== 37) return nok(code)
    data.consume(code)
    return openingEnd
  }
  function openingEnd(code: Code): State | undefined {
    if (whitespace(code)) {
      data.consume(code)
      return openingEnd
    }
    if (!lineEnding(code)) return nok(code)
    data.close()
    effects.enter('lineEnding')
    effects.consume(code)
    effects.exit('lineEnding')
    return lineStart
  }
  function lineStart(code: Code): State | undefined {
    if (whitespace(code)) {
      data.consume(code)
      return lineStart
    }
    if (code === 37) {
      data.consume(code)
      return closingSecond
    }
    return body(code)
  }
  function body(code: Code): State | undefined {
    if (code === null) return nok(code)
    if (lineEnding(code)) {
      data.close()
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return lineStart
    }
    data.consume(code)
    return lineEnding(code) ? lineStart : body
  }
  function closingSecond(code: Code): State | undefined {
    if (code !== 37) return body(code)
    data.consume(code)
    return closingEnd
  }
  function closingEnd(code: Code): State | undefined {
    if (whitespace(code)) {
      data.consume(code)
      return closingEnd
    }
    if (code !== null && !lineEnding(code)) return body(code)
    data.close()
    effects.exit('inkkitCommentBlock')
    return ok(code)
  }
}
const syntax: Extension = {
  text: { 37: { name: 'inkkitCommentInline', tokenize: inlineComment } },
  flow: {
    37: { name: 'inkkitCommentBlock', tokenize: blockComment, concrete: true },
  },
}
const from: FromExtension = {
  enter: {
    inkkitCommentInline(token) {
      this.enter(
        { type: 'inkkitCommentInline', syntax: 'obsidian', value: '' },
        token,
      )
    },
    inkkitCommentBlock(token) {
      this.enter(
        { type: 'inkkitCommentBlock', syntax: 'obsidian', value: '' },
        token,
      )
    },
  },
  exit: {
    inkkitCommentInline(token) {
      const node = this.stack.at(-1) as Comment
      node.value = this.sliceSerialize(token).slice(2, -2)
      this.exit(token)
    },
    inkkitCommentBlock(token) {
      const node = this.stack.at(-1) as Comment
      node.value = this.sliceSerialize(token)
        .replace(/^%%[^\S\r\n]*\r?\n/, '')
        .replace(/(?:\r?\n)?[^\S\r\n]*%%[^\S\r\n]*$/, '')
      this.exit(token)
    },
  },
}

export function commentSource(node: ProseNode): string {
  const body = node.textContent
  return node.attrs.syntax === 'html'
    ? `<!--${body}-->`
    : node.type.name === 'comment_block' || node.attrs.block
      ? `%%\n${body}\n%%`
      : `%%${body}%%`
}
const handler: Handle = (node) => {
  const comment = node as Comment
  const value = comment.value ?? ''
  return comment.syntax === 'html'
    ? `<!--${value}-->`
    : comment.type === 'inkkitCommentBlock' || comment.block
      ? `%%\n${value}\n%%`
      : `%%${value}%%`
}

export interface CommentSpan {
  start: number
  end: number
  syntax: CommentSyntax
  value: string
  block?: boolean
}
function htmlSpans(value: string): CommentSpan[] {
  const spans: CommentSpan[] = []
  let inTag = false
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (inTag && (character === '"' || character === "'")) {
      quote = character
      continue
    }
    if (value.startsWith('<!--', index)) {
      const end = value.indexOf('-->', index + 4)
      if (end < 0) break
      spans.push({
        start: index,
        end: end + 3,
        syntax: 'html',
        value: value.slice(index + 4, end),
      })
      index = end + 2
      inTag = false
    } else if (character === '<') inTag = true
    else if (character === '>') inTag = false
  }
  return spans
}

// Parse preserved source again rather than hiding delimiter-looking strings in code or escapes.
export function literalCommentSpans(value: string): CommentSpan[] {
  const tree = fromMarkdown(value, {
    extensions: [syntax],
    mdastExtensions: [from],
  })
  const spans: CommentSpan[] = []
  const visit = (node: Nodes) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start != null && end != null) {
      if (
        node.type === 'inkkitCommentInline' ||
        node.type === 'inkkitCommentBlock'
      )
        spans.push({
          start,
          end,
          syntax: node.syntax,
          value: node.value,
          block: node.type === 'inkkitCommentBlock',
        })
      else if (node.type === 'html')
        spans.push(
          ...htmlSpans(value.slice(start, end)).map((span) => ({
            ...span,
            start: start + span.start,
            end: start + span.end,
          })),
        )
    }
    if ('children' in node) node.children.forEach(visit)
  }
  visit(tree)
  return spans.sort((left, right) => left.start - right.start)
}

function remarkComments(this: Processor) {
  const data = this.data() as Record<string, unknown[] | undefined>
  ;(data.micromarkExtensions ??= []).push(syntax)
  ;(data.fromMarkdownExtensions ??= []).push(from)
  ;(data.toMarkdownExtensions ??= []).push({
    handlers: { inkkitCommentInline: handler, inkkitCommentBlock: handler },
    unsafe: [{ character: '%', inConstruct: 'phrasing', after: '%' }],
  })
  return (tree: Root) => {
    const visit = (
      node: Nodes,
      inline: boolean,
      parentType?: string,
    ): Nodes => {
      if (parentType === 'listItem' && node.type === 'inkkitCommentBlock')
        return {
          type: 'paragraph',
          children: [{ ...node, type: 'inkkitCommentInline', block: true }],
          position: node.position,
        }
      if (node.type === 'html') {
        const spans = htmlSpans(node.value)
        if (
          spans.length === 1 &&
          spans[0]!.start === 0 &&
          spans[0]!.end === node.value.length
        )
          return parentType === 'listItem'
            ? {
                type: 'paragraph',
                children: [
                  {
                    type: 'inkkitCommentInline',
                    syntax: 'html',
                    value: spans[0]!.value,
                    position: node.position,
                  },
                ],
                position: node.position,
              }
            : {
                type: inline ? 'inkkitCommentInline' : 'inkkitCommentBlock',
                syntax: 'html',
                value: spans[0]!.value,
                position: node.position,
              }
      }
      if ('children' in node)
        node.children = node.children.map((child) =>
          visit(
            child,
            node.type === 'paragraph' ||
              node.type === 'heading' ||
              node.type === 'tableCell' ||
              node.type === 'link' ||
              node.type === 'linkReference' ||
              inline,
            node.type,
          ),
        ) as never
      if (
        node.type === 'paragraph' &&
        parentType !== 'listItem' &&
        node.children.length === 1 &&
        node.children[0]?.type === 'inkkitCommentInline'
      )
        return {
          ...node.children[0],
          type: 'inkkitCommentBlock',
          position: node.position,
        }
      return node
    }
    tree.children = tree.children.map((node) =>
      visit(node, false),
    ) as Root['children']
  }
}
export const remarkCommentsPlugin = $remark(
  'remarkComments',
  () => remarkComments,
)

function commentNode(inline: boolean) {
  const name = inline ? 'comment_inline' : 'comment_block'
  const mdastType = inline ? 'inkkitCommentInline' : 'inkkitCommentBlock'
  return $node(name, () => ({
    inline,
    group: inline ? 'inline' : 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { syntax: { default: 'html' }, block: { default: !inline } },
    parseDOM: [
      {
        tag: `${inline ? 'span' : 'div'}[data-inkkit-comment]`,
        preserveWhitespace: 'full',
        getAttrs: (dom) => ({
          syntax:
            dom.getAttribute('data-inkkit-comment') === 'obsidian'
              ? 'obsidian'
              : 'html',
        }),
      },
    ],
    toDOM: (node) => [
      inline ? 'span' : 'div',
      {
        class: `inkkit-comment inkkit-comment-${inline ? 'inline' : 'block'}`,
        'data-inkkit-comment': node.attrs.syntax,
        'aria-label': 'Author comment',
      },
      0,
    ],
    parseMarkdown: {
      match: (node) => node.type === mdastType,
      runner: (state, node, type) => {
        state.openNode(type, {
          syntax: node.syntax,
          block: inline ? Boolean(node.block) : true,
        })
        if (node.value) state.addText(String(node.value))
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === name,
      runner: (state, node) => {
        state.addNode(mdastType, undefined, node.textContent, {
          syntax: node.attrs.syntax,
          block: node.attrs.block,
        })
      },
    },
  }))
}
export const commentInline = commentNode(true)
export const commentBlock = commentNode(false)
const visibilityKey = new PluginKey<boolean>('inkkit-comments-visible')
export const commentVisibility = $prose(
  () =>
    new Plugin<boolean>({
      key: visibilityKey,
      state: {
        init: () => false,
        apply: (transaction, value) =>
          transaction.getMeta(visibilityKey) ?? value,
      },
      view(view) {
        const update = () =>
          view.dom.setAttribute(
            'data-inkkit-comments-visible',
            String(visibilityKey.getState(view.state) ?? false),
          )
        update()
        return { update }
      },
    }),
)
export function setCommentVisibility(view: EditorView, visible: boolean): void {
  if (visibilityKey.getState(view.state) === visible) return
  view.dispatch(
    view.state.tr
      .setMeta(visibilityKey, visible)
      .setMeta('addToHistory', false),
  )
}
export const comments = [commentInline, commentBlock, commentVisibility].flat()
export function isComment(node: ProseNode): boolean {
  return (
    node.type.name === 'comment_inline' || node.type.name === 'comment_block'
  )
}

// Authored reference metadata can retain comments after their visible nodes are removed.
function commentProvenance(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit)
    if (!value || typeof value !== 'object') return false
    const node = value as {
      type?: string
      value?: string
      children?: unknown[]
    }
    return (
      node.type === 'inkkitCommentInline' ||
      node.type === 'inkkitCommentBlock' ||
      (node.type === 'html' &&
        typeof node.value === 'string' &&
        htmlSpans(node.value).length > 0) ||
      Boolean(node.children?.some(visit))
    )
  }
  try {
    return visit(JSON.parse(value))
  } catch {
    return true
  }
}

export function shareableFragment(content: Fragment): Fragment {
  const filtered: ProseNode[] = []
  const labelHasComments = (label: unknown) =>
    typeof label === 'string' &&
    (label.includes('%%') || label.includes('<!--')) &&
    literalCommentSpans(label).length > 0
  content.forEach((node) => {
    if (isComment(node)) return
    if (
      node.type.name === 'reference_definition' &&
      labelHasComments(node.attrs.label)
    )
      return
    node = node.mark(
      node.marks.map((mark) => {
        if (mark.type.name !== 'link') return mark
        const clearTarget = labelHasComments(mark.attrs.label)
        if (!clearTarget && !commentProvenance(mark.attrs.referenceContent))
          return mark
        return mark.type.create({
          ...mark.attrs,
          referenceContent: null,
          ...(clearTarget
            ? { identifier: null, label: null, referenceType: null }
            : {}),
        })
      }),
    )
    if (!node.childCount) {
      filtered.push(node)
      return
    }
    const inner = shareableFragment(node.content)
    let whitespaceOnly = true,
      removedComment = false
    inner.forEach((child) => {
      if (
        !(child.isText && !child.text!.trim()) &&
        child.type.name !== 'hardbreak'
      )
        whitespaceOnly = false
    })
    node.content.descendants((child) => {
      if (isComment(child)) {
        removedComment = true
        return false
      }
    })
    const commentOnly = removedComment && whitespaceOnly
    const paragraph = () =>
      Fragment.from(node.type.schema.nodes.paragraph!.create())
    if ((inner.size === 0 || commentOnly) && node.content.size > 0) {
      if (
        [
          'footnote_definition',
          'list_item',
          'table_cell',
          'table_header',
          'inkkit_callout',
        ].includes(node.type.name)
      )
        filtered.push(node.copy(paragraph()))
      return
    }
    if (!node.type.validContent(inner)) {
      if (node.type.name === 'list_item')
        filtered.push(node.copy(paragraph().append(inner)))
      return
    }
    filtered.push(node.copy(inner))
  })
  return Fragment.fromArray(filtered)
}

// ProseMirror omits a parent wrapper when a selection is wholly inside its text.
export function commentSelectionContent(
  doc: ProseNode,
  from: number,
  to: number,
  content: Fragment,
): Fragment {
  const start = doc.resolve(from)
  const end = doc.resolve(to)
  for (let depth = start.depth; depth > 0; depth--) {
    const node = start.node(depth)
    if (isComment(node) && end.depth >= depth && node === end.node(depth))
      return Fragment.from(
        node.copy(
          node.content.cut(from - start.start(depth), to - start.start(depth)),
        ),
      )
  }
  return content
}
