import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { declarations } from './declarations.mjs'
import { validate } from './validate.mjs'

const check = (required, source) =>
  validate(new Set(required), new Map([['reference.mdx', source]]))
const missing = (result, target) =>
  assert.ok(
    result.errors.some(
      (error) => error === `Missing API description: ${target}`,
    ),
    result.errors.join('\n'),
  )
const section = (target, body = 'Reads the current document.') =>
  `{/* @api ${target} */}\n### snapshot\n\n${body}\n`

test('a qualified section owns its explanatory prose', () => {
  const result = check(
    ['InkKitEditor.snapshot'],
    section('InkKitEditor.snapshot'),
  )
  assert.deepEqual(result.errors, [])
  assert.match(
    result.documented.get('InkKitEditor.snapshot').location,
    /reference.mdx:2$/,
  )
})

test('incidental mentions, links and examples cannot document an absent method', () => {
  const source =
    'Calls `snapshot()` to save.\n\n[Snapshot](#snapshot)\n\n```ts\neditor.snapshot()\n```'
  missing(check(['InkKitEditor.snapshot'], source), 'InkKitEditor.snapshot')
})

for (const body of [
  '`snapshot(): string`',
  '```ts\neditor.snapshot()\n```',
  '[Read the reference](#snapshot)',
  'TODO',
  'Description.',
  '---',
])
  test(`an owned section refuses a description consisting of ${JSON.stringify(body)}`, () => {
    missing(
      check(['InkKitEditor.snapshot'], section('InkKitEditor.snapshot', body)),
      'InkKitEditor.snapshot',
    )
  })

test('prose after the next heading cannot satisfy the previous section', () => {
  const source =
    section('InkKitEditor.snapshot', '`snapshot()`') +
    '\n### Other\n\nReads the current document.'
  missing(check(['InkKitEditor.snapshot'], source), 'InkKitEditor.snapshot')
})

test('same-named fields retain distinct owners', () => {
  const source =
    '{/* @api-scope CommandState */}\n## State\n\n<ResponseField name="editable" type="boolean">\nWhether editing is allowed.\n</ResponseField>'
  const result = check(
    ['EditorOptions.editable', 'CommandState', 'CommandState.editable'],
    source,
  )
  missing(result, 'EditorOptions.editable')
  assert.ok(result.documented.has('CommandState.editable'))
})

test('same-named adapter methods cannot substitute for each other', () => {
  const source =
    '## FileAdapter\n\nResolves files for display.\n\n<ResponseField name="exportImage" type="function">\nProvides portable image bytes.\n</ResponseField>'
  const result = check(
    ['FileAdapter', 'FileAdapter.exportImage', 'ImageAdapter.exportImage'],
    source,
  )
  missing(result, 'ImageAdapter.exportImage')
  assert.ok(result.documented.has('FileAdapter.exportImage'))
})

test('labels require their own row and explanatory column, not defaults or mentions', () => {
  const source =
    '{/* @api-scope EditorLabels */}\n\n| Label | Default text | Where it appears |\n| --- | --- | --- |\n| `copyCode` | Copy source code | |\n| `placeholder` | Start typing | Unlike `copyCode`, labels empty documents. |'
  const result = check(
    [
      'EditorLabels',
      'EditorLabels.copyCode',
      'EditorLabels.placeholder',
      'EditorLabels.sourceEditor',
    ],
    source,
  )
  missing(result, 'EditorLabels.copyCode')
  missing(result, 'EditorLabels.sourceEditor')
  assert.ok(result.documented.has('EditorLabels.placeholder'))
})

test('fake sections inside code and ordinary comments do not count', () => {
  const source =
    '```mdx\n' +
    section('InkKitEditor.snapshot') +
    '\n```\n\n{/* ### snapshot\nReads the current document. */}'
  missing(check(['InkKitEditor.snapshot'], source), 'InkKitEditor.snapshot')
})

test('a parent field cannot borrow a nested child description', () => {
  const source =
    '{/* @api-scope EditorOptions */}\n## Options\n\n<ResponseField name="rendering" type="object">\n<Expandable title="rendering">\n<ResponseField name="diagramPreview" type="boolean">\nShows previews below diagrams.\n</ResponseField>\n</Expandable>\n</ResponseField>'
  const result = check(
    [
      'EditorOptions',
      'EditorOptions.rendering',
      'EditorOptions.rendering.diagramPreview',
    ],
    source,
  )
  missing(result, 'EditorOptions.rendering')
  assert.ok(result.documented.has('EditorOptions.rendering.diagramPreview'))
})

test('nested names cannot be supplied under another scope', () => {
  const source =
    '{/* @api-scope Other */}\n\n<ResponseField name="diagramPreview" type="boolean">\nShows previews below diagrams.\n</ResponseField>'
  missing(
    check(
      [
        'Other',
        'Other.diagramPreview',
        'EditorOptions.rendering.diagramPreview',
      ],
      source,
    ),
    'EditorOptions.rendering.diagramPreview',
  )
})

for (const source of [
  '{/* @api Missing */}\nDescribes a missing type.',
  '{/* @api Type */}',
  '{/* @api-scope Type Other */}\n## Type',
  '{/* @api Type */}\n{/* @api Type */}\nText describes this type.',
  '{/* @api Type */}\n```ts\ninterface Type {}\n```',
])
  test(`malformed or unattached annotation fails: ${JSON.stringify(source)}`, () => {
    assert.ok(check(['Type'], source).errors.length > 0)
  })

test('duplicate primary descriptions are reported with both locations', () => {
  const result = check(['Type'], section('Type') + '\n' + section('Type'))
  assert.ok(
    result.errors.some((error) =>
      /duplicate primary description for Type.*already at/.test(error),
    ),
  )
})

test('MDX nesting, literal generic attributes, grouped table fields and CRLF are structural', () => {
  const source =
    '{/* @api-scope Options */}\n## Options\n\n<ResponseField name="result" type="Promise<{ value: string }>">\nReturns the selected value.\n</ResponseField>\n\n{/* @api-scope Options */}\n\n| Field | Type | Meaning |\n| --- | --- | --- |\n| `from`, `to` | `string \\| number` | The selected range endpoints. |'
  const result = check(
    ['Options', 'Options.result', 'Options.from', 'Options.to'],
    source.replaceAll('\n', '\r\n'),
  )
  assert.deepEqual([...result.documented.keys()].sort(), [
    'Options.from',
    'Options.result',
    'Options.to',
  ])
  assert.deepEqual(result.errors, ['Missing API description: Options'])
})

test('built declaration AST follows aliases, both entries, nested fields and visibility', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkkit-api-docs-'))
  try {
    await mkdir(join(root, 'dist'))
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          types: [],
          module: 'ESNext',
          moduleResolution: 'bundler',
        },
        files: ['dist/index.d.ts', 'dist/core.d.ts'],
      }),
    )
    await writeFile(
      join(root, 'dist/index.d.ts'),
      "export * from './core.js'; export { Thing as Alias } from './types.js';",
    )
    await writeFile(
      join(root, 'dist/core.d.ts'),
      "export { Thing, Options } from './types.js';",
    )
    await writeFile(
      join(root, 'dist/types.d.ts'),
      'export declare class Thing { private hidden; protected guarded; private constructor(); static mount(): Thing; read(value: string): string; read(value: number): number; get editable(): boolean; set editable(value: boolean); }\nexport interface Options { rendering?: { diagramPreview?: boolean; added?: string }; }',
    )
    const { required, entries } = declarations(root, 'tsconfig.json')
    assert.deepEqual(entries.get('core'), ['Options', 'Thing'])
    assert.deepEqual(entries.get('index'), ['Alias', 'Options', 'Thing'])
    assert.deepEqual([...required].sort(), [
      'Alias',
      'Alias.editable',
      'Alias.mount',
      'Alias.read',
      'Options',
      'Options.rendering',
      'Options.rendering.added',
      'Options.rendering.diagramPreview',
      'Thing',
      'Thing.editable',
      'Thing.mount',
      'Thing.read',
    ])
    missing(validate(required, new Map()), 'Options.rendering.added')
    await rm(join(root, 'dist/core.d.ts'))
    assert.throws(
      () => declarations(root, 'tsconfig.json'),
      /Missing built declaration/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unsupported declaration members and syntax failures never fall back to string matching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkkit-api-docs-'))
  try {
    await mkdir(join(root, 'dist'))
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { noEmit: true, types: [] },
        files: ['dist/index.d.ts', 'dist/core.d.ts'],
      }),
    )
    await writeFile(join(root, 'dist/core.d.ts'), "export * from './index.js';")
    await writeFile(
      join(root, 'dist/index.d.ts'),
      'export interface Callable { (): void; }',
    )
    assert.throws(
      () => declarations(root, 'tsconfig.json'),
      /Unsupported public member/,
    )
    await writeFile(
      join(root, 'dist/index.d.ts'),
      'export interface Broken { field: ; }',
    )
    assert.throws(
      () => declarations(root, 'tsconfig.json'),
      /Declaration syntax errors/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('real reference deletions remain missing despite incidental mentions elsewhere', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const { required } = declarations(root)
  const pages = new Map(
    await Promise.all(
      (await readdir(join(root, 'docs/reference')))
        .filter((name) => name.endsWith('.mdx'))
        .map(async (name) => [
          name,
          await readFile(join(root, 'docs/reference', name), 'utf8'),
        ]),
    ),
  )
  assert.deepEqual(validate(required, pages).errors, [])
  for (const [file, pattern, target] of [
    [
      'editor.mdx',
      /\{\/\* @api InkKitEditor\.snapshot \*\/\}\s*### snapshot\n[^]*?(?=\n## Editability)/,
      'InkKitEditor.snapshot',
    ],
    [
      'options.mdx',
      /<ResponseField name="editable" type="boolean" default="true">[^]*?<\/ResponseField>/,
      'EditorOptions.editable',
    ],
    [
      'appearance.mdx',
      /^\| `sourceEditor`[^\n]*\n/m,
      'EditorLabels.sourceEditor',
    ],
  ]) {
    const altered = new Map(pages)
    const original = altered.get(file)
    assert.ok(pattern.test(original), `Mutation must find ${target}`)
    altered.set(file, original.replace(pattern, ''))
    missing(validate(required, altered), target)
  }
})
