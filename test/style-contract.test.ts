import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'

// The classes that ProseMirror, Milkdown and the table plugin add and read themselves.
// InkKit styles them and cannot rename them.
const upstream = [
  /^ProseMirror(-[\w-]+)?$/,
  /^(editor|selectedCell|milkdown-drop-indicator)$/,
]
const allowed = (name: string) =>
  name.startsWith('inkkit-') || upstream.some((pattern) => pattern.test(name))

const stylesheet = readFileSync('src/style.css', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

const keyframeSteps = /^(?:from|to|[\d.]+%)(?:\s*,\s*(?:from|to|[\d.]+%))*$/

// The text before each `{` is a selector list or an at-rule; quoted text and
// attribute selectors can hold dots, so they go first.
const selectors = [...stylesheet.matchAll(/([^{}]+)\{/g)]
  .map((match) => match[1]!.trim())
  .filter((text) => !text.startsWith('@') && !keyframeSteps.test(text))
  .map((text) => text.replace(/\[[^\]]*\]/g, '').replace(/(['"]).*?\1/g, ''))

test('the stylesheet selects only InkKit, ProseMirror and Milkdown classes', () => {
  const classes = new Set(
    selectors.flatMap((text) =>
      [...text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]!),
    ),
  )
  expect(classes.size).toBeGreaterThan(20)
  expect([...classes].filter((name) => !allowed(name))).toEqual([])
})

test('the stylesheet reads and sets only --inkkit-* properties', () => {
  const properties = new Set(
    [...stylesheet.matchAll(/--[\w-]+/g)].map((match) => match[0]),
  )
  expect(properties.size).toBeGreaterThan(20)
  expect([...properties].filter((name) => !/^--_?inkkit-/.test(name))).toEqual(
    [],
  )
})

test('the code names only prefixed classes for the elements it draws', () => {
  const literal =
    /(?:className\s*=|class:|classList\.(?:add|toggle|remove)\()\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g
  const found: [string, string][] = []
  for (const file of readdirSync('src').filter((name) => name.endsWith('.ts')))
    for (const match of readFileSync(`src/${file}`, 'utf8').matchAll(literal))
      for (const name of (match[1] ?? match[2] ?? match[3]!)
        .replace(/\$\{[^}]*\}/g, '')
        .split(/\s+/))
        // `language-mermaid` is the Markdown fence convention on imported
        // HTML, which InkKit reads and does not draw.
        if (name && name !== 'language-mermaid' && !name.startsWith('inkkit-'))
          found.push([file, name])
  expect(found).toEqual([])
})
