import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageNotice, packageRoot } from '../scripts/third-party-notices'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true })
})

function fixture(license: string | undefined = 'MIT') {
  const root = mkdtempSync(join(tmpdir(), 'inkkit-notices-'))
  roots.push(root)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-package', version: '1.2.3', license }),
  )
  return root
}

describe('bundled third-party notices', () => {
  it('finds the owning package in npm and pnpm module IDs', () => {
    expect(
      packageRoot('/host/node_modules/example/dist/main.js?commonjs'),
    ).toBe('/host/node_modules/example')
    expect(
      packageRoot(
        '\0/host/node_modules/.pnpm/scoped@1/node_modules/@scope/example/index.js',
      ),
    ).toBe('/host/node_modules/.pnpm/scoped@1/node_modules/@scope/example')
    expect(packageRoot('/host/src/main.ts')).toBeUndefined()
  })

  it('preserves every license alternative and additional NOTICE', () => {
    const root = fixture('(MIT OR Apache-2.0)')
    writeFileSync(join(root, 'LICENSE-MIT'), 'MIT copyright and terms')
    writeFileSync(join(root, 'LICENSE.APACHE'), 'Apache terms')
    writeFileSync(join(root, 'NOTICE'), 'Required attribution')
    writeFileSync(join(root, 'README.md'), 'Unrelated content')
    const notice = packageNotice(root)
    expect(notice.title).toBe('fixture-package@1.2.3 ((MIT OR Apache-2.0))')
    expect(notice.text).toContain('MIT copyright and terms')
    expect(notice.text).toContain('Apache terms')
    expect(notice.text).toContain('Required attribution')
    expect(notice.text).not.toContain('Unrelated content')
  })

  it('fails a missing license instead of silently emitting an incomplete notice', () => {
    const root = fixture()
    writeFileSync(join(root, 'NOTICE'), 'Attribution is not a license')
    expect(() => packageNotice(root)).toThrow('ships no licence file')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'unlicensed' }),
    )
    expect(() => packageNotice(root)).toThrow('declares no licence')
  })
})
