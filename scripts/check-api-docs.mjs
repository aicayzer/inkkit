// Fails when the API reference in docs/reference/ leaves out part of the built public
// surface: an export of `dist/index.d.ts`, a public member of `InkKitEditor`, or an option,
// event or label key. Run `pnpm build` first.
import { readdir, readFile } from 'node:fs/promises'

const pages = (await readdir('docs/reference')).filter((name) =>
  name.endsWith('.mdx'),
)
const reference = (
  await Promise.all(
    pages.map((name) => readFile(`docs/reference/${name}`, 'utf8')),
  )
).join('\n')

// The names a declaration file exports, following `export *`.
async function exportedNames(file) {
  const source = await readFile(`dist/${file}`, 'utf8')
  const names = []
  for (const [, list] of source.matchAll(/^export (?:type )?\{([^}]*)\}/gm))
    for (const item of list.split(','))
      if (item.trim())
        names.push(
          item
            .trim()
            .split(/\s+as\s+/)
            .pop(),
        )
  for (const [, from] of source.matchAll(/^export \* from '\.\/([^']+)\.js'/gm))
    names.push(...(await exportedNames(`${from}.d.ts`)))
  return names
}

// The lines of a declaration's body that begin with a name, such as the properties of an
// interface or the public members of a class.
function members(source, header) {
  const start = source.indexOf(header)
  if (start < 0) throw new Error(`${header} is not in the declarations`)
  const body = source.slice(start + header.length, source.indexOf('\n}', start))
  return [
    ...body.matchAll(
      /^ {4}(?!private |protected |constructor)(?:static |readonly |get |set )*([A-Za-z_]\w*)\??[(:<]/gm,
    ),
  ].map((match) => match[1])
}

const editor = await readFile('dist/editor.d.ts', 'utf8')
const types = await readFile('dist/types.d.ts', 'utf8')
const wanted = new Map()
const want = (kind, names) => {
  for (const name of names) wanted.set(`${kind} ${name}`, name)
}
want('export', await exportedNames('index.d.ts'))
want(
  'InkKitEditor member',
  members(editor, 'export declare class InkKitEditor {'),
)
for (const [kind, source, header] of [
  ['EditorOptions option', editor, 'export interface EditorOptions {'],
  ['EditorEvents event', editor, 'export interface EditorEvents {'],
  ['EditorLabels label', types, 'export interface EditorLabels {'],
  [
    'TextInputPreferences field',
    editor,
    'export interface TextInputPreferences {',
  ],
  ['FormatOptions field', editor, 'export interface FormatOptions {'],
  ['TableOptions field', types, 'export interface TableOptions {'],
])
  want(kind, members(source, header))

// A name counts as documented when it appears in a code span.
const missing = [...wanted]
  .filter(([, name]) => !new RegExp(`\`[^\`\\n]*\\b${name}\\b`).test(reference))
  .map(([label]) => label)
if (wanted.size < 100)
  throw new Error(`Only ${wanted.size} names found; the parser is out of date`)
if (missing.length) {
  console.error(`docs/reference does not mention:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
console.log(
  `docs/reference mentions all ${wanted.size} exported names, members and keys`,
)
