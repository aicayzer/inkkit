import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { declarations } from './api-docs/declarations.mjs'
import { validate } from './api-docs/validate.mjs'

const root = resolve(import.meta.dirname, '..')
const { required, entries } = declarations(root)
const names = (await readdir(`${root}/docs/reference`))
  .filter((name) => name.endsWith('.mdx'))
  .sort()
const pages = new Map(
  await Promise.all(
    names.map(async (name) => [
      `docs/reference/${name}`,
      await readFile(`${root}/docs/reference/${name}`, 'utf8'),
    ]),
  ),
)
const { errors } = validate(required, pages)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else
  console.log(
    `API reference has owned descriptions for ${required.size} exports and members across ${entries.size} package entries. Accuracy still requires review.`,
  )
