# Releases

Release `0.0.1` was published manually from the verified tarball. The workflow retains its `v0.0.1` publication exception. The [verification record](verification.md) contains the first-release evidence.

## Release gate

Pushing a later matching version tag starts npm publication. Complete the gate **before pushing the tag**, within an explicitly authorised release session.

1. Confirm the milestone's acceptance criteria and review compatibility changes. Additive work can use the planned pre-1.0 `0.0.x` series; document public API changes and migration requirements rather than treating every increment as a bug fix.
2. Run the checks in [development](development.md), including relevant isolated native integrations and clipboard checks. Update API and supported-syntax documentation to match the implemented behaviour.
3. Record the reviewed release commit, tested tarball SHA-256, npm integrity, decompressed tar SHA-256, offline bundle SHA-256 and verification results in the release issue. Retain the candidate and its evidence in `_local/release/<version>/`. Review the packed file allowlist and confirm version/tag agreement.
4. Check the npm trusted-publisher configuration, then tag the reviewed commit `v<version>` and push that tag. Inspect the hosted workflow's validation and publication results.
5. Download the release workflow's `release-package` artefact into a separate directory. Verify publication with the command below. Record the workflow URL, OIDC result and registry evidence before closing the release issue and milestone. Publish and verify 0.0.2 before beginning 0.0.3 delivery.

```sh
node scripts/verify-release.mjs 0.0.2 \
  _local/release/0.0.2/aicayzer-inkkit-0.0.2.tgz \
  _local/hosted-release/0.0.2/aicayzer-inkkit-0.0.2.tgz
```

Use the corresponding version and paths for each release. The command verifies registry version and SHA-512 integrity, requires the registry's compressed archive to match the published CI archive exactly, and compares the decompressed tar byte-for-byte with the native-tested candidate. Different compression is acceptable only when decompressed tar bytes are identical; record that difference. A content mismatch blocks release completion.

The command also installs the exact registry version in a fresh consumer with an isolated npm cache, verifies declarations and CSS, and builds an offline single-file bundle. It records `registry-evidence.json` and the downloaded archive in `_local/release/<version>/`. These build checks do not replace runtime WKWebView and native clipboard verification of the candidate.

Do not repeat a publish after an unknown outcome without checking the registry. A published name/version cannot be replaced.

## Trusted publishing for later releases

In the package's npm settings, add a GitHub Actions trusted publisher with:

- Organization or user: `aicayzer`
- Repository: `inkkit`
- Workflow filename: `release.yml`
- Environment name: leave empty
- Publishing permissions: allow direct publishing through `npm publish`

The workflow uses GitHub-hosted runners, Node.js 26 and npm's OIDC authentication. npm requires version 11.5.1 or later for trusted publishing. The publish job has `contents: read` and `id-token: write`; no npm token is stored. The workflow filename must match the actual file in `.github/workflows/`. Check live settings before pushing each release tag; `npm trust list @aicayzer/inkkit --json` is available with npm 11.15 or later and may require account authentication. Follow [npm's trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/).

Subsequent matching version tags validate and publish the tested tarball. OIDC publication is only proven after such a release succeeds. Do not create a new version merely to test OIDC.

A new trusted-publisher configuration must complete its first successful workflow publication within two days. Otherwise it expires; recreate it when the next actual release is ready. A prior manual publication does not establish that the OIDC workflow works. See [npm's configuration-expiry guidance](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

Complete the authorised release's verification and handover. App adoption, app releases and the next feature milestone remain separate delivery work.
