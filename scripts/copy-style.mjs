import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
await copyFile('src/style.css', 'dist/style.css')
// Native ESM consumers require file extensions; TypeScript resolves source files
// with bundler semantics while hosts bundle the same exports with Vite.
for (const name of await readdir('dist')) {
  if (!name.endsWith('.js') && !name.endsWith('.d.ts')) continue
  const path = `dist/${name}`
  const source = await readFile(path, 'utf8')
  await writeFile(
    path,
    source.replace(
      /(from\s+['"]|import\s+['"])(\.\.?\/[^'"]+)(['"])/g,
      (match, prefix, target, quote) =>
        /\.[a-z]+$/.test(target) ? match : `${prefix}${target}.js${quote}`,
    ),
  )
}
