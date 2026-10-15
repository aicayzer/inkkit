# Releases

Release `0.0.1` was published manually from the verified tarball. The [verification record](verification.md) contains the first-release evidence. Later releases are published by the release workflow.

## What the release workflow checks

Pushing a `v*` tag starts `.github/workflows/release.yml`. It publishes only when every step passes:

1. The tag is `v` followed by the `version` in `package.json`.
2. The tagged commit is on `main` (its tip or an ancestor), or is exactly the tip of the explicit `release/<version>` maintenance branch matching `package.json`. A tag on an unmerged feature branch, a different version's maintenance branch, or an obsolete maintenance candidate fails.
3. The whole CI workflow runs on the tagged commit, the same checks as a pull request: formatting, `pnpm check` with the packed-consumer pages in Chromium and WebKit, the built-playground check, and the whole browser suite in Chromium and WebKit.
4. The publish job publishes the `package-candidate` archive that the CI `check` job packed and tested, through npm trusted publishing.

These checks live in the tagged commit's own `release.yml`, and two settings outside the workflow add to them:

- The publish job runs in the GitHub environment `npm`, which allows deployments only from `v*` tags.
- A tag ruleset lets only repository administrators create, move or delete `v*` tags.

## Publication checklist

### Focused maintenance releases

When `main` already contains features excluded from an authorized maintenance release, create `release/<version>` from the last published version. Merge only the reviewed correction, regression coverage, release metadata and required release tooling through a green pull request into that branch. The release tag must point to its exact tip. All normal CI, native verification, package-integrity and trusted-publishing gates still apply. Forward-port the correction and any release-tooling changes to `main` through a separate reviewed pull request so subsequent releases retain the fix. Keep future feature milestones separate from the maintenance version.

### Every release

Implementation and publication require explicit delivery authority. Record publication checklists in the version milestone and release evidence without opening another version-shaped release issue. Retain existing historical release issues unchanged.

Pushing a later matching version tag starts npm publication. Complete the gate **before pushing the tag**, within an explicitly authorised release session.

1. Confirm the milestone's acceptance criteria and review compatibility changes. Additive work can use the planned pre-1.0 `0.0.x` series; document public API changes and migration requirements rather than treating every increment as a bug fix.
2. Run the checks in [development](development.md), using the bounded browser/native selection policy and relevant changed-contract checks. Update API and supported-syntax documentation to match the implemented behaviour.
3. Record the reviewed release commit, tested tarball SHA-256, npm integrity, decompressed tar SHA-256, offline bundle SHA-256 and verification results in the milestone publication checklist and release evidence. Retain the candidate and its evidence in `_local/release/<version>/`. Review the packed file allowlist and confirm version/tag agreement.
4. Check the npm trusted-publisher configuration, then tag the reviewed commit `v<version>` and push that tag. Inspect the hosted workflow's validation and publication results.
5. Download the release workflow's `package-candidate` artefact into a separate directory. Verify publication with the command below. Record the workflow URL, OIDC result and registry evidence before marking the milestone publication checklist complete and closing the milestone. Publish and verify each authorised release before beginning implementation of the next.

```sh
node scripts/verify-release.mjs 0.0.7 \
  _local/release/0.0.7/aicayzer-inkkit-0.0.7.tgz \
  _local/hosted-release/0.0.7/0.0.7/aicayzer-inkkit-0.0.7.tgz
```

Use the corresponding version and paths for each release. The command verifies registry version and SHA-512 integrity, requires the registry's compressed archive to match the published CI archive exactly, and compares the decompressed tar byte-for-byte with the native-tested candidate. Different compression is acceptable only when decompressed tar bytes are identical; record that difference. A content mismatch blocks release completion.

The command also installs the exact registry version in a fresh consumer with an isolated npm cache, verifies declarations and CSS, builds an offline single-file bundle, and opens the main and `core` pages in Chromium and WebKit with the same runtime checks as `pnpm test:package`. It records `registry-evidence.json` and the downloaded archive in `_local/release/<version>/`. These build checks do not replace selected runtime WKWebView checks when the native boundary changes. External-app clipboard checks are exceptional and need an identified changed contract or reproduced bug, as described in [development](development.md). A source-only documentation change does not require a native run. Reuse native evidence only when the tested package inputs and relevant contract are unchanged, and record the comparison.

Do not repeat a publish after an unknown outcome without checking the registry. A published name/version cannot be replaced.

## Trusted publishing for later releases

In the package's npm settings, add a GitHub Actions trusted publisher with:

- Organization or user: `aicayzer`
- Repository: `inkkit`
- Workflow filename: `release.yml`
- Environment name: leave blank
- Publishing permissions: allow direct publishing through `npm publish`

The workflow uses GitHub-hosted runners, Node.js 26 and npm's OIDC authentication. npm requires version 11.5.1 or later for trusted publishing. The publish job runs in the `npm` environment with `contents: read` and `id-token: write`; no npm token is stored. Create the environment under the repository's Settings > Environments, under **Deployment branches and tags** choose **Selected branches and tags**, and add a rule of type **Tag** with the pattern `v*`. The workflow filename must match the actual file in `.github/workflows/`. Check available configuration evidence before pushing each release tag. Successful OIDC releases establish the publishing path when the workflow and package configuration are unchanged. `npm trust list @aicayzer/inkkit --json` is an optional read with npm 11.15 or later and may require account authentication; that request alone does not require local npm login. Investigate actual configuration changes or publication failures. Follow [npm's trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/).

Subsequent matching version tags validate and publish the tested tarball. OIDC publication is only proven after such a release succeeds. Do not create a new version merely to test OIDC.

A new trusted-publisher configuration must complete its first successful workflow publication within two days. Otherwise it expires; recreate it when the next actual release is ready. A prior manual publication does not establish that the OIDC workflow works. See [npm's configuration-expiry guidance](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

Complete the authorised release's verification and handover. App adoption, app releases and the next feature milestone remain separate delivery work.
