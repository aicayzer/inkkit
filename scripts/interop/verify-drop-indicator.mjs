import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
if (args.length !== 4)
  throw Error('Usage: verify-drop-indicator.mjs ARCHIVE BUNDLE OUTPUT HOST')
const [archive, bundle, output, host] = args.map((path) => resolve(path))
mkdirSync(output, { recursive: true })
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const resultPath = join(output, 'native-drop.json')
rmSync(resultPath, { force: true })
const evidence = {
  archiveSha256: hash(archive),
  bundleSha256: hash(bundle),
  hostSha256: hash(host),
  scope: 'Native WKWebView dragover, exit, reentry and insertion',
  failures: [],
}
const run = spawnSync(host, [bundle, resultPath], {
  encoding: 'utf8',
  timeout: 25000,
})
writeFileSync(
  join(output, 'native-drop.log'),
  `${run.stdout ?? ''}${run.stderr ?? ''}`,
)
try {
  if (run.error || run.status !== 0)
    throw Error(`Native helper failed: ${run.error?.message ?? run.status}`)
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  if (result.error) throw Error(result.error)
  for (const type of ['dragstart', 'dragover', 'drop', 'dragend'])
    if (!result.events.some((event) => event.type === type && event.trusted))
      evidence.failures.push(`Missing trusted ${type}`)
  const samples = Object.fromEntries(
    result.samples.map((sample) => [sample.phase, sample]),
  )
  for (const phase of ['inside', 'reentry']) {
    const sample = samples[phase]
    const cursor = sample?.cursors.find(
      (item) => item.display !== 'none' && item.height > 0 && item.width > 0,
    )
    if (!cursor) {
      evidence.failures.push(`${phase}: no rendered indicator`)
      continue
    }
    if (!cursor.inRoot)
      evidence.failures.push(`${phase}: indicator outside editor root`)
    if (cursor.color === 'rgba(0, 0, 0, 0)' || Number(cursor.opacity) === 0)
      evidence.failures.push(`${phase}: transparent indicator`)
    const x = result.before.targetX,
      y = result.before.targetY
    if (
      Math.abs(cursor.y - y) > 24 ||
      x < cursor.x - 2 ||
      x > cursor.x + cursor.width + 2
    )
      evidence.failures.push(`${phase}: indicator does not mark the target gap`)
  }
  for (const phase of ['outside', 'ended']) {
    if (!samples[phase])
      evidence.failures.push(`${phase}: missing lifecycle sample`)
    else if (
      samples[phase].cursors.some(
        (item) => item.display !== 'none' && item.height > 0 && item.width > 0,
      )
    )
      evidence.failures.push(`${phase}: indicator remains visible`)
  }
  const text = result.after?.snapshot?.text ?? ''
  const insertion = text.indexOf('Native insertion')
  if (
    insertion < text.indexOf('First target paragraph.') ||
    insertion > text.indexOf('Second target paragraph.') ||
    insertion < 0
  )
    evidence.failures.push(
      'Native drop did not insert between the target paragraphs',
    )
  if (result.after?.diagnostics?.length || result.after?.error)
    evidence.failures.push('Editor reported an error')
} catch (error) {
  evidence.failures.push(error.message)
}
evidence.passed = evidence.failures.length === 0
writeFileSync(
  join(output, 'results.json'),
  JSON.stringify(evidence, null, 2) + '\n',
)
console.log(JSON.stringify(evidence, null, 2))
if (!evidence.passed) process.exitCode = 1
