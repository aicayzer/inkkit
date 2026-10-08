import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { checkConsumer, sha256 } from './test-package.mjs'

const [version, testedPath, ciPath] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !testedPath || !ciPath) {
  throw new Error(
    'Usage: node scripts/verify-release.mjs VERSION TESTED_ARCHIVE CI_ARCHIVE',
  )
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok)
    throw new Error(`Registry request failed: ${response.status} ${url}`)
  return response
}

try {
  const testedArchive = resolve(testedPath)
  const ciArchive = resolve(ciPath)
  const tested = await readFile(testedArchive)
  const ci = await readFile(ciArchive)
  const testedEvidence = JSON.parse(
    await readFile(
      join(dirname(testedArchive), 'package-evidence.json'),
      'utf8',
    ),
  )
  if (
    testedEvidence.version !== version ||
    testedEvidence.sha256 !== sha256(tested) ||
    !testedEvidence.commit ||
    testedEvidence.workingTreeDirty !== false
  )
    throw new Error('Tested archive does not match its package evidence')

  const metadata = await (
    await download(`https://registry.npmjs.org/@aicayzer%2finkkit/${version}`)
  ).json()
  if (metadata.name !== '@aicayzer/inkkit' || metadata.version !== version)
    throw new Error('Unexpected registry package version')
  const tarballUrl = new URL(metadata.dist.tarball)
  if (
    tarballUrl.protocol !== 'https:' ||
    tarballUrl.hostname !== 'registry.npmjs.org'
  )
    throw new Error('Unexpected registry tarball origin')
  const registry = Buffer.from(await (await download(tarballUrl)).arrayBuffer())
  const integrity = `sha512-${createHash('sha512').update(registry).digest('base64')}`
  if (metadata.dist.integrity !== integrity)
    throw new Error('Registry archive does not match npm integrity')
  if (!registry.equals(ci))
    throw new Error(
      'Registry compressed archive differs from the published CI archive',
    )
  const testedTar = gunzipSync(tested)
  const registryTar = gunzipSync(registry)
  if (!registryTar.equals(testedTar))
    throw new Error(
      'Published package contents differ from the tested decompressed tar',
    )
  if (testedEvidence.decompressedTarSha256 !== sha256(testedTar))
    throw new Error(
      'Tested decompressed tar does not match its package evidence',
    )

  const consumer = await checkConsumer(version, version)
  const destination = resolve('_local/release', version)
  await mkdir(destination, { recursive: true })
  await writeFile(join(destination, `registry-${version}.tgz`), registry)
  const evidence = {
    version,
    testedCommit: testedEvidence.commit,
    verifiedAt: new Date().toISOString(),
    testedArchive,
    ciArchive,
    tarballUrl: tarballUrl.href,
    testedSha256: sha256(tested),
    publishedSha256: sha256(registry),
    integrity,
    decompressedTarSha256: sha256(registryTar),
    compressionOnlyDifference: !registry.equals(tested),
    ...consumer,
    checks: [
      'registry version',
      'registry integrity',
      'registry/CI compressed archive identity',
      'tested/published decompressed tar identity',
      'fresh registry installation',
      'public declarations',
      'CSS export',
      'offline Vite bundle',
    ],
  }
  await writeFile(
    join(destination, 'registry-evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString())
  if (error.stderr) console.error(error.stderr.toString())
  throw error
}
