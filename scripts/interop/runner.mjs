import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  accessSync,
  constants,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { validateNative } from './native-results.mjs'
import { validatePrint } from './print-results.mjs'

const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const json = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const clipboardCommand = (binary, action, path) => {
  const run = spawnSync(binary, [action, path], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (run.error || run.status !== 0)
    throw Error(
      `Pasteboard ${action} failed: ${run.error?.message ?? run.stderr}`,
    )
}

export async function runScenarios({
  bundle,
  destination,
  host,
  tools = {},
  scenarios,
  selected,
  requestedGroups,
  command,
}) {
  if (!selected.length) throw Error('Selection contains no scenarios')
  const consumer = JSON.parse(
    readFileSync(join(dirname(bundle), 'consumer-evidence.json'), 'utf8'),
  )
  const bundleSha256 = hash(bundle)
  if (!consumer.version || consumer.bundleSha256 !== bundleSha256)
    throw Error(
      'Consumer evidence does not match this bundle; rebuild it from the candidate archive',
    )
  if (tools.archive && hash(tools.archive) !== consumer.tarballSha256)
    throw Error('Candidate archive does not match the consumer evidence')
  const hosts = {}
  const needsClipboard = selected.some((name) => scenarios[name].clipboard)
  for (const name of selected) {
    const kind = scenarios[name].hostKind ?? 'webkit'
    const binary = kind === 'image-drag' ? tools['image-drag-host'] : host
    if (!binary) throw Error(`Selected ${name} requires --image-drag-host PATH`)
    accessSync(binary, constants.X_OK)
    hosts[kind] ??= { path: binary, sha256: hash(binary) }
  }
  if (needsClipboard) {
    if (!tools.clipboard)
      throw Error('Selected scenarios require --clipboard PATH')
    accessSync(tools.clipboard, constants.X_OK)
  }
  mkdirSync(destination, { recursive: true })
  const evidence = {
    version: consumer.version,
    entry: consumer.entry,
    tarballSha256: consumer.tarballSha256,
    ...(tools.archive ? { archive: tools.archive } : {}),
    bundle,
    bundleSha256,
    ...(hosts.webkit ? { host, hostSha256: hosts.webkit.sha256 } : {}),
    hosts,
    command,
    testedAt: new Date().toISOString(),
    selection: { groups: requestedGroups, scenarios: selected },
    scenarios: [],
    ...(needsClipboard
      ? { clipboard: tools.clipboard, clipboardSha256: hash(tools.clipboard) }
      : {}),
  }
  const backup = join(destination, 'private-pasteboard-backup.json')
  const restored = join(destination, 'private-pasteboard-restored.json')
  let backedUp = false
  try {
    if (needsClipboard) {
      // A retained backup may be the only recovery copy after a failed restore.
      try {
        accessSync(backup)
        throw Error(`Retained pasteboard backup exists: ${backup}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      clipboardCommand(tools.clipboard, 'save', backup)
      backedUp = true
    }
    for (const name of selected) {
      const descriptor = scenarios[name]
      const fixture = descriptor.fixture
      const kind = descriptor.hostKind ?? 'webkit'
      const binary = hosts[kind].path
      const input = join(destination, `${name}.input.json`)
      const output = join(destination, `${name}.result.json`)
      const log = join(destination, `${name}.log`)
      json(input, fixture)
      rmSync(output, { force: true })
      const args =
        kind === 'image-drag'
          ? [bundle, output, fixture.variant]
          : [bundle, fixture.mode ?? 'scenario', input, output]
      const run = spawnSync(binary, args, {
        timeout: descriptor.timeout ?? (descriptor.native ? 60_000 : 120_000),
        encoding: 'utf8',
      })
      writeFileSync(log, `${run.stdout ?? ''}${run.stderr ?? ''}`)
      let result
      const failures = []
      if (run.error || run.status !== 0)
        failures.push(
          `Native host failed: ${run.error?.message ?? run.signal ?? run.status}`,
        )
      try {
        result = JSON.parse(readFileSync(output, 'utf8'))
      } catch (error) {
        failures.push(`Cannot read native result: ${error.message}`)
      }
      if (kind === 'webkit' && result?.passed !== true)
        failures.push('Native scenario did not pass')
      if (
        result?.pageErrors?.length ||
        run.stderr?.includes('WKWebView page error:')
      )
        failures.push('Uncaught WKWebView page error')
      if (
        descriptor.strict &&
        (result?.final?.error ||
          !Array.isArray(result?.final?.diagnostics) ||
          result.final.diagnostics.length ||
          run.stderr?.includes('WKWebView:'))
      )
        failures.push('Native editor reported errors or diagnostics')
      if (descriptor.native)
        failures.push(...validateNative(result, descriptor.native))
      if (descriptor.validate)
        failures.push(...descriptor.validate(result, fixture))
      const printFailures = validatePrint(result, fixture)
      failures.push(...printFailures)
      evidence.scenarios.push({
        name,
        contract: descriptor.contract,
        passed: failures.length === 0,
        hostKind: kind,
        host: binary,
        hostSha256: hosts[kind].sha256,
        status: run.status,
        signal: run.signal,
        error: run.error?.message ?? run.stderr?.trim(),
        input,
        inputSha256: hash(input),
        output,
        log,
        steps: result?.steps?.length ?? 0,
        failures: result?.steps?.filter((step) => !step.passed) ?? [],
        validationFailures: failures,
        finalError: result?.final?.error ?? null,
        diagnostics: result?.final?.diagnostics ?? [],
        pageErrors: result?.pageErrors ?? [],
        ...(descriptor.native
          ? {
              nativeSteps:
                result?.steps?.filter(
                  (step) => step.operation === 'nativeInput',
                ) ?? [],
            }
          : {}),
        ...(['print', 'printable'].includes(fixture.mode)
          ? { print: result?.print, printFailures }
          : {}),
      })
    }
  } catch (error) {
    evidence.error = error.message
  } finally {
    if (backedUp) {
      try {
        clipboardCommand(tools.clipboard, 'restore', backup)
        clipboardCommand(tools.clipboard, 'save', restored)
        evidence.pasteboardRestored = readFileSync(backup).equals(
          readFileSync(restored),
        )
        if (evidence.pasteboardRestored) {
          rmSync(backup)
          rmSync(restored)
        }
      } catch (error) {
        evidence.restorationError = error.message
      }
    }
    evidence.passed =
      !evidence.error &&
      !evidence.restorationError &&
      (!needsClipboard || evidence.pasteboardRestored === true) &&
      evidence.scenarios.length === selected.length &&
      evidence.scenarios.every((scenario) => scenario.passed)
    json(join(destination, 'evidence.json'), evidence)
  }
  return evidence
}
