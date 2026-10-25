import type { Mark, Node as ProseNode, Schema } from '@milkdown/kit/prose/model'

/** Literal lines stay in their textblock, including headings and table cells. */
export function literalTextNodes(
  schema: Schema,
  text: string,
  marks: readonly Mark[],
  isHTML: boolean,
): ProseNode[] {
  const nodes: ProseNode[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((line, index) => {
    if (index)
      nodes.push(
        schema.nodes.hardbreak!.create(
          { isHTML },
          null,
          // A terminal break must sit outside closing formatting delimiters.
          index === lines.length - 1 && line === '' ? [] : marks,
        ),
      )
    if (line) nodes.push(schema.text(line, marks))
  })
  return nodes
}
