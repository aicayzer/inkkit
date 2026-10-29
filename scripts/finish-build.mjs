import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'

await copyFile('src/style.css', 'dist/style.css')
await mkdir('dist/themes', { recursive: true })
for (const theme of ['standard', 'calm', 'essential'])
  await copyFile(`src/themes/${theme}.css`, `dist/themes/${theme}.css`)

// TypeScript resolves source imports with bundler semantics; native ESM
// consumers need the extension.
const declarations = new Map()
for (const name of await readdir('dist')) {
  if (!name.endsWith('.d.ts')) continue
  const source = await readFile(`dist/${name}`, 'utf8')
  declarations.set(
    name,
    source.replace(
      /(from\s+['"]|import\s+['"])(\.\.?\/[^'"]+)(['"])/g,
      (match, prefix, target, quote) =>
        /\.[a-z]+$/.test(target) ? match : `${prefix}${target}.js${quote}`,
    ),
  )
}

// The JavaScript is bundled, so only the declarations the public entries
// reach ship, and they may not name a package hosts do not install.
const reached = new Set()
const pending = ['index.d.ts', 'core.d.ts']
while (pending.length) {
  const name = pending.pop()
  if (reached.has(name)) continue
  const source = declarations.get(name)
  if (source === undefined) throw new Error(`dist/${name} was not emitted`)
  reached.add(name)
  for (const [, specifier] of source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g,
  )) {
    if (specifier.startsWith('./'))
      pending.push(specifier.slice(2).replace(/\.js$/, '.d.ts'))
    else
      throw new Error(
        `dist/${name} imports ${specifier}, which the package does not install`,
      )
  }
}
for (const [name, source] of declarations)
  if (reached.has(name)) await writeFile(`dist/${name}`, source)
  else await rm(`dist/${name}`)
