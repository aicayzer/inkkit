import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// These packages omit the MIT notice shipped in their upstream repository:
// https://github.com/shlroland/remark-highlight-mark/blob/master/License
const missingLicenceCopyright: Record<string, string> = {
  'mdast-util-highlight-mark': 'Copyright (c) 2024 remark-highlight-mark',
  'micromark-extension-highlight-mark':
    'Copyright (c) 2024 remark-highlight-mark',
}

const mit = (copyright: string) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

export function packageRoot(id: string): string | undefined {
  const path = id.replace(/^\0/, '').split('?')[0]!
  const marker = path.lastIndexOf('/node_modules/')
  if (marker < 0) return undefined
  const rest = path.slice(marker + '/node_modules/'.length).split('/')
  const name = rest[0]!.startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)
  return join(path.slice(0, marker), 'node_modules', ...name)
}

export function packageNotice(root: string): { title: string; text: string } {
  const manifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ) as { name: string; version: string; license?: string }
  const license = manifest.license
  if (!license) throw new Error(`${manifest.name} declares no licence`)
  const files = readdirSync(root, { withFileTypes: true })
    .filter(
      (file) =>
        file.isFile() &&
        /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file.name),
    )
    .map((file) => file.name)
    .sort()
  const licenceFiles = files.filter((file) => !/^notice/i.test(file))
  const copyright = missingLicenceCopyright[manifest.name]
  if (!licenceFiles.length && (license !== 'MIT' || !copyright))
    throw new Error(`${manifest.name} ships no licence file`)
  return {
    title: `${manifest.name}@${manifest.version} (${license})`,
    text: [
      ...(!licenceFiles.length ? [mit(copyright!)] : []),
      ...files.map(
        (file) => `${file}\n\n${readFileSync(join(root, file), 'utf8').trim()}`,
      ),
    ].join('\n\n'),
  }
}

export function thirdPartyNotices(
  fileName = 'THIRD-PARTY-NOTICES.txt',
  prefix = 'Inkkit bundles these packages. Each keeps its own license.\n\n',
): Plugin {
  return {
    name: 'inkkit-third-party-notices',
    generateBundle(_, bundle) {
      const packages = new Set<string>()
      for (const output of Object.values(bundle))
        if (output.type === 'chunk')
          for (const id of output.moduleIds) {
            const root = packageRoot(id)
            if (root) packages.add(root)
          }
      const notices = [...packages]
        .map(packageNotice)
        .sort((a, b) => a.title.localeCompare(b.title))
      this.emitFile({
        type: 'asset',
        fileName,
        source:
          prefix +
          notices
            .map(({ title, text }) => `${title}\n\n${text}\n`)
            .join('\n' + '-'.repeat(72) + '\n\n'),
      })
    },
  }
}
