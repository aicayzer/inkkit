# Releases

The first release is `0.0.1`. It is published manually by the maintainer from the exact verified tarball. Do not publish it through CI or tag it before the native interoperability gates pass.

1. Run the checks in `development.md`, including isolated native integrations and external clipboard checks.
2. Record the release commit, tarball SHA-256, npm integrity and verification results. Review the packed file allowlist.
3. Tag the reviewed commit `v0.0.1`. The release workflow validates and packages this tag, but explicitly skips its publish job.
4. From the repository directory, the maintainer runs `npm login && npm publish ./_local/release/aicayzer-inkkit-0.0.1.tgz --access public`.
5. Verify `npm view @aicayzer/inkkit@0.0.1 version dist.integrity` and install the registry package in a clean consumer. Compare its integrity with the verified tarball.

Do not repeat a publish after an unknown outcome without checking the registry. A published name/version cannot be replaced.

## Trusted publishing for later releases

In the package's npm settings, add a GitHub Actions trusted publisher with:

- Organization or user: `aicayzer`
- Repository: `inkkit`
- Workflow filename: `release.yml`
- Environment name: leave empty
- Publishing permissions: allow direct publishing through `npm publish`

The workflow uses GitHub-hosted runners, Node.js 26 and npm's OIDC authentication. The publish job has `contents: read` and `id-token: write`; no npm token is stored. The workflow filename must match the actual file in `.github/workflows/`. Follow [npm's trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/).

Subsequent matching version tags validate and publish the tested tarball. OIDC publication is only proven after such a release succeeds. Do not create a new version merely to test OIDC.

A new trusted-publisher configuration must complete its first successful workflow publication within two days. Otherwise it expires; recreate it when the next actual release is ready. A prior manual publication does not establish that the OIDC workflow works. See [npm's configuration-expiry guidance](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

Stop after first-publication verification. App migrations/releases and the 0.0.2 feature plan require their own delivery phase.
