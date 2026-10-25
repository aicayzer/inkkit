import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [archiveArg, bundleArg, outputArg, hostArg] = process.argv.slice(2)
if (!archiveArg || !bundleArg || !outputArg || !hostArg)
  throw Error('Usage: verify-image-drag.mjs ARCHIVE BUNDLE OUTPUT HOST')
const [archive, bundle, output, host] = [
  archiveArg,
  bundleArg,
  outputArg,
  hostArg,
].map((path) => resolve(path))
mkdirSync(output, { recursive: true })
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const evidence = {
  archive,
  archiveSha256: hash(archive),
  bundle,
  bundleSha256: hash(bundle),
  host,
  hostSha256: hash(host),
  scope: 'WKWebView drag data observed by an AppKit destination; drop refused',
  cases: [],
}
for (const name of ['block', 'inline']) {
  const resultPath = join(output, `${name}.json`)
  rmSync(resultPath, { force: true })
  const run = spawnSync(host, [bundle, resultPath, name], {
    encoding: 'utf8',
    timeout: 25000,
  })
  writeFileSync(
    join(output, `${name}.log`),
    `${run.stdout ?? ''}${run.stderr ?? ''}`,
  )
  const failures = []
  let result
  try {
    if (run.error || run.status !== 0)
      throw Error(`Native host failed: ${run.error?.message ?? run.status}`)
    result = JSON.parse(readFileSync(resultPath, 'utf8'))
    if (result.error) throw Error(result.error)
    if (
      !result.events?.some(
        (event) => event.type === 'dragstart' && event.trusted === true,
      )
    )
      failures.push('No trusted dragstart')
    if (
      !result.events?.some(
        (event) => event.type === 'dragend' && event.trusted === true,
      )
    )
      failures.push('No trusted dragend')
    if (!result.destination?.length)
      failures.push('No AppKit destination callback')
    const displayURL = result.before?.displayURL
    if (!displayURL?.startsWith('data:image/'))
      failures.push('Missing private display URL fixture')
    for (const capture of result.destination ?? []) {
      if (capture.phase !== 'draggingEntered')
        failures.push('Unexpected destination phase')
      if (!capture.html || !capture.text)
        failures.push('Empty destination HTML or text')
      if (
        !capture.text.includes('Drag label') ||
        !capture.html.includes('Drag label')
      )
        failures.push('Readable image label missing')
      for (const value of [capture.html, capture.text]) {
        if (value.includes('private-authored-image.png'))
          failures.push('Authored image reference leaked')
        if (displayURL && value.includes(displayURL))
          failures.push('DOM display URL leaked')
        if (/data:image\//i.test(value)) failures.push('Image bytes leaked')
      }
    }
    const before = result.before?.snapshot
    const after = result.after?.snapshot
    const expectedSource =
      name === 'block'
        ? '![Drag label](private-authored-image.png)\n'
        : 'Before ![Drag label](private-authored-image.png) after.\n'
    if (before?.text !== expectedSource || !Number.isInteger(before?.revision))
      failures.push('Missing authored source or revision fixture')
    if (
      !after ||
      before.text !== after.text ||
      before.revision !== after.revision
    )
      failures.push('Unaccepted drag changed source or revision')
    if (result.after?.diagnostics?.length || result.after?.error)
      failures.push('Editor reported an error')
    if (result.acceptedDrop !== false)
      failures.push('Drop acceptance was not refused')
  } catch (error) {
    failures.push(error.message)
  }
  evidence.cases.push({
    name,
    passed: failures.length === 0,
    failures,
    resultPath,
  })
}
evidence.passed =
  evidence.cases.length === 2 && evidence.cases.every((entry) => entry.passed)
writeFileSync(
  join(output, 'results.json'),
  JSON.stringify(evidence, null, 2) + '\n',
)
console.log(JSON.stringify(evidence, null, 2))
if (!evidence.passed) process.exitCode = 1
