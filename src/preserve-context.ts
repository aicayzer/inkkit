import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { lineBreakHTML } from './literals'
import { type SourceNode } from './preserve-types'
import { parseDoc, parseTree, write } from './preserve-parse'
import { definitionLabel, semanticSignature } from './preserve-shape'

export class DefinitionContext {
  private readonly definitionNodes = new Map<string, number>()

  constructor(
    private readonly ctx: Ctx,
    private readonly lineEnding: string,
    private readonly definitionSources:
      readonly { label: string; text: string }[] | undefined,
  ) {}

  // Every definition in the source, in order. A block's links can depend on
  // definitions and nothing else outside it, so parsing it with these gives
  // the meaning it has in the document.
  // The definitions a block's text can refer to: only a bracketed label that
  // matches one can resolve, so the others need not be parsed with it.
  definitions(
    text: string,
  ): { text: string; blocks: number; nodes: number } | undefined {
    if (this.definitionSources === undefined) return undefined
    const labels = new Set<string>()
    for (const match of text.matchAll(/\[((?:\\[\s\S]|[^\\[\]])*)\]/g))
      labels.add(definitionLabel(match[1]!))
    const sources = this.definitionSources
      .filter((source) => labels.has(source.label))
      .map((source) => source.text)
    const appended = sources.join('\n\n')
    let nodes = this.definitionNodes.get(appended)
    if (nodes === undefined) {
      nodes = appended ? parseDoc(this.ctx, appended).childCount : 0
      this.definitionNodes.set(appended, nodes)
    }
    return { text: appended, blocks: sources.length, nodes }
  }

  // The block's text followed by what it can depend on elsewhere in the
  // document, or undefined when that cannot be known from the block alone.
  inContext(
    text: string,
  ): { text: string; blocks: number; nodes: number } | undefined {
    // HTML and %% comments can span blocks.
    if (/<|%%/.test(text)) return undefined
    if (!text.includes('[')) return { text, blocks: 1, nodes: 1 }
    const definitions = this.definitions(text)
    if (!definitions) return undefined
    return definitions.text
      ? {
          text: text + this.lineEnding.repeat(2) + definitions.text,
          blocks: 1 + definitions.blocks,
          nodes: 1 + definitions.nodes,
        }
      : { text, blocks: 1, nodes: 1 }
  }

  // The first block of text as the document would read it in place.
  parseLocally(text: string): ProseNode | undefined {
    const local = this.inContext(text)
    if (!local) return undefined
    const parsed = parseDoc(this.ctx, local.text)
    return parsed.childCount === local.nodes ? parsed.firstChild! : undefined
  }

  // Canonical Markdown for a block and its source tree, read in the same
  // context, so references in it resolve as they do in the document.
  canonicalTree(
    text: string,
  ): { canonical: string; node: SourceNode } | undefined {
    const local = this.inContext(text)
    if (!local) return undefined
    const tree = parseTree(this.ctx, local.text)
    return tree.children.length === local.blocks
      ? {
          canonical: local.text,
          node: tree.children[0] as unknown as SourceNode,
        }
      : undefined
  }

  // Whether `text` reads as `nodes` in place. HTML blocks, HTML comments and
  // `%%` comments can span blocks, so text holding them is not read alone;
  // the `<br />` line an empty paragraph is written as is the exception. A
  // paragraph after the text must still read as a paragraph of its own, which
  // shows that nothing in the text runs on into what follows it.
  readsAs(text: string, nodes: ProseNode[]): boolean {
    if (
      text.includes('%%') ||
      text
        .split(/\r?\n/)
        .some((line) => line.includes('<') && !lineBreakHTML(line))
    )
      return false
    const definitions = text.includes('[')
      ? this.definitions(text)
      : { text: '', blocks: 0, nodes: 0 }
    if (!definitions) return false
    const sentinel = 'InkKit end of region'
    const separator = this.lineEnding.repeat(2)
    const read = parseDoc(
      this.ctx,
      text +
        separator +
        sentinel +
        (definitions.text ? separator + definitions.text : ''),
    )
    if (
      read.childCount !== nodes.length + 1 + definitions.nodes ||
      read.child(nodes.length).type.name !== 'paragraph' ||
      read.child(nodes.length).textContent !== sentinel
    )
      return false
    const children: ProseNode[] = []
    for (let index = 0; index < nodes.length; index++)
      children.push(read.child(index))
    const expected = read.type.create(null, nodes)
    const reopened = read.type.create(null, children)
    if (semanticSignature(reopened) !== semanticSignature(expected))
      return false
    const normalized = (value: string): string => value.replace(/\r\n?/g, '\n')
    const canonical = write(this.ctx, expected)
    const actual = normalized(write(this.ctx, reopened))
    if (actual === normalized(canonical)) return true
    // Parsing may normalize loose-list spacing, as in `reopens`.
    const again = parseDoc(
      this.ctx,
      canonical + (definitions.text ? separator + definitions.text : ''),
    )
    if (again.childCount !== nodes.length + definitions.nodes) return false
    const rewritten: ProseNode[] = []
    for (let index = 0; index < nodes.length; index++)
      rewritten.push(again.child(index))
    return (
      actual === normalized(write(this.ctx, read.type.create(null, rewritten)))
    )
  }
}
