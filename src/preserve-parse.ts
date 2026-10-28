import { parserCtx } from '@milkdown/kit/core'
import { remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { serialize } from './dialect'
import { linkForm } from './link-form'
import { type SourceNode } from './preserve-types'
import { lf, form } from './preserve-shape'

/**
 * Characters preservation has parsed and written. A test reads it to tell an
 * edit validated where it happened from one that read the whole document.
 */
export const preservationWork = { characters: 0 }

export function parseDoc(ctx: Ctx, text: string): ProseNode {
  preservationWork.characters += text.length
  return ctx.get(parserCtx)(text)
}

// The tree of `text`, with each link's form in its data as the transformed
// tree has it, so comparing two trees compares how their links were written.
export function parseTree(ctx: Ctx, text: string): Root {
  preservationWork.characters += text.length
  const tree = ctx.get(remarkCtx).parse(text) as Root
  // Positions count from after a byte order mark.
  const body = text.replace(/^\uFEFF/, '')
  const visit = (node: SourceNode) => {
    if (node.type === 'link')
      node.data = {
        ...(node.data as object | undefined),
        inkkitLinkForm: linkForm(node, body),
      }
    node.children?.forEach(visit)
  }
  visit(tree as unknown as SourceNode)
  return tree
}

export function write(ctx: Ctx, doc: ProseNode): string {
  const text = serialize(ctx, doc)
  preservationWork.characters += text.length
  return text
}

export function blockForm(ctx: Ctx, node: ProseNode): string {
  // An empty document is empty Markdown, but an empty block inside a document
  // is authored spacing and must remain a real block when read again.
  if (node.type.name === 'paragraph' && node.content.size === 0) return '<br />'
  const text = form(
    write(ctx, node.type.schema.topNodeType.create(null, [node])),
  )
  // A literal block's text is its source, so a line ending at its end is part
  // of what it holds, though the writer drops it and it cannot be read back.
  // Keeping it in the form shows the edit that added it.
  let endings = ''
  const literal = (child: ProseNode) => {
    if (child.type.name === 'literal_markdown')
      endings += lf(/(?:\r?\n)*$/.exec(child.textContent)![0])
  }
  literal(node)
  node.descendants((child) => {
    literal(child)
    return !child.isTextblock
  })
  return text + endings
}

/**
 * When enabled, every save that did not take the whole-document path is saved
 * through it as well, and each difference in bytes or refusal is recorded.
 * The test suite enables it, so every test also compares the two paths.
 */
export const crossCheck = {
  enabled: false,
  compared: 0,
  differences: [] as string[],
}
