import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst, transformWithOxc } from 'vite'
import { expect, test } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Modules that only Markdown may reach: parsing, source preservation and HTML import. */
const markdownOnly = [
  /^src\/preserve[^/]*\.ts$/,
  /^src\/dialect\.ts$/,
  /^src\/html-import\.ts$/,
  /^src\/paste-html\.ts$/,
]

/** The repository modules `file` loads at run time. Type-only imports are erased first, as the
 *  build erases them, so only what runs counts. */
async function runtimeImports(file: string): Promise<string[]> {
  const source = await readFile(file, 'utf8')
  const { code } = await transformWithOxc(source, file)
  const found: string[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const item = node as { type?: string; source?: { value?: unknown } }
    if (
      (item.type === 'ImportDeclaration' ||
        item.type === 'ExportNamedDeclaration' ||
        item.type === 'ExportAllDeclaration' ||
        item.type === 'ImportExpression') &&
      typeof item.source?.value === 'string'
    )
      found.push(item.source.value)
    for (const value of Object.values(node)) visit(value)
  }
  visit(parseAst(code))
  return found
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => {
      const path = resolve(dirname(file), specifier)
      for (const candidate of [path, `${path}.ts`, `${path}/index.ts`])
        if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate
      throw new Error(`Unresolved import ${specifier} in ${file}`)
    })
}

/** Every module reachable from `entry`, with the chain that first reaches it. */
async function importGraph(entry: string): Promise<Map<string, string[]>> {
  const start = resolve(root, entry)
  const chains = new Map<string, string[]>([[start, [start]]])
  const queue = [start]
  for (let file = queue.shift(); file; file = queue.shift())
    for (const next of await runtimeImports(file))
      if (!chains.has(next)) {
        chains.set(next, [...chains.get(file)!, next])
        queue.push(next)
      }
  return new Map(
    [...chains].map(([file, chain]) => [
      relative(root, file),
      chain.map((link) => relative(root, link)),
    ]),
  )
}

/** The chains by which `entry` reaches a module only Markdown may use. */
async function markdownReached(entry: string): Promise<string[][]> {
  const graph = await importGraph(entry)
  return [...graph]
    .filter(([file]) => markdownOnly.some((pattern) => pattern.test(file)))
    .map(([, chain]) => chain)
}

// Point another format's handler here, such as `src/formats/rich-text.ts`, when it is added.
for (const entry of ['src/formats/text.ts'])
  test(`${entry} reaches no Markdown parsing or preservation`, async () => {
    expect(await markdownReached(entry)).toEqual([])
  })

test('the import graph check finds Markdown modules where they are reached', async () => {
  const reached = await markdownReached('src/formats/markdown.ts')
  const files = reached.map((chain) => chain.at(-1))
  expect(files).toContain('src/preserve.ts')
  expect(files).toContain('src/dialect.ts')
  // A chain names how the module is reached, starting at the entry.
  expect(reached[0]![0]).toBe('src/formats/markdown.ts')
})

test('the import graph check ignores type-only imports', async () => {
  const graph = await importGraph('src/formats/text.ts')
  // `types.ts` imports types from modules that the handler never loads.
  expect(graph.has('src/formats/types.ts')).toBe(false)
  expect(graph.has('src/print.ts')).toBe(true)
})
