# Verification record

This record separates native-tested candidates from completed registry publication. Release issues retain the artefact hashes, workflow results and verification evidence for each version.

## Candidate

- Package: `@aicayzer/inkkit@0.0.1`.
- Package source: `0ede884fe0a8b7b5a19437d48bc9dd140e10275c`.
- Archive: `aicayzer-inkkit-0.0.1.tgz`.
- SHA-256: `d739adc1883145fd62b4ac3800da6bb53d2253f437959e9e49fb97dfb1e0059d`.
- npm integrity: `sha512-hi0tSouWXnVBOMucKU4z4MMxhFU0OYTu6FW5DakFhHpfqPzUX6aD3Eorsa3vn5Uhc52OyYdqwgViY17SzRdemQ==`.
- Package checks: 99 tests, TypeScript, formatting, build and a clean npm consumer passed. The clean consumer exercised the public exports, stylesheet and a single-file offline bundle.

The earlier archive, SHA-256 `07943c224e4c1fb47d5b1a49806e1424233f7e323bdd475dbe2b652ae021af07`, was replaced after an actual Obsidian reverse-copy check exposed a heading import defect. The replacement filters the copied encoding metadata and narrowly identified reading-view controls. A reduced native clipboard fixture and regression tests retain arbitrary authored SVG and similarly named content.

Hosted CI passed at documentation commit `15dbd2d`. Its compressed archive has SHA-256 `598398bdd8088319fe7d42ad949cfe49dd91b5aa84e71b8e0757a9f817ec95be`; its decompressed tar is byte-identical to the native-tested archive (tar SHA-256 `705e20c51eaf967c692553b554f0e4c7757bee74dc0a56355f8aad25fa7ebd2f`). Only the compressed representation differs. The manual first publication must use the native-tested archive identified above, and registry verification must compare its npm integrity.

## Registry publication

The maintainer published `@aicayzer/inkkit@0.0.1` from the native-tested archive. The registry metadata and downloaded archive match both hashes above exactly. Installing version `0.0.1` directly from npm in a fresh consumer passed public declaration checks, stylesheet resolution, runtime dependency bundling and a single-file offline build.

Tag `v0.0.1` points to release commit `6ee767a56ed4c8b41fb20c347f5d2f0fa2ad5052`. Its release workflow passed validation and skipped automatic publication, preserving the manual first release. App rollout and later package features remain separate phases.

At the 0.0.1 handover, the supplied npm settings showed the expected GitHub repository and `release.yml` trusted publisher, with direct publishing permitted. OIDC publication had not yet been exercised.

## 0.0.2 publication

On 8 October 2026, [release.yml](https://github.com/aicayzer/inkkit/actions/runs/37852337446) published `v0.0.2` at commit `8fb5d77ad334dd2d926eb946d0faea302ab5c886` through OIDC. Independent cryptographic provenance verification confirmed the GitHub issuer, workflow/tag identity, source commit and published package digest. Registry compressed bytes matched the workflow archive; decompressed tar contents matched the native-tested candidate despite compression-only differences. Fresh exact-version installation, declarations/CSS, offline bundling and public-facade runtime checks passed. The complete artefact and native evidence is recorded in [release gate #18](https://github.com/aicayzer/inkkit/issues/18).

## Native app integrations

The replacement archive was installed into isolated integration branches in PadPad, personal Memos and Memos WithMarfa. Each consumer passed four public-facade JavaScript checks, TypeScript, formatting, offline bundling and a native Xcode build.

| Consumer        | Integration commit | Native bridge checks on replacement archive |
| --------------- | ------------------ | ------------------------------------------- |
| PadPad          | `88bb4aa`          | 9 clipboard and Markdown bridge tests       |
| Personal Memos  | `6ff1118`          | 5 InkKit bridge tests                       |
| Memos WithMarfa | `7924526`          | 6 InkKit bridge tests                       |

These 20 checks use the actual app-hosted WKWebView and native bridges. They cover immediate edits and snapshots, failure handling, delayed image import across document changes, ordered native RTFD image attachments and the relevant host adapters. WithMarfa checks include a decoded image through its real host scheme, exact bytes from a local cached asset, portable image export and an unavailable-asset warning. They use a local fixture library; production service hydration was not exercised.

Personal Memos also passed 17 model tests against the earlier archive. The model and native code did not change between those archive runs. Those 17 checks are recorded separately rather than attributed to the replacement archive.

The three local app branches are named `codex/inkkit-0.0.1`. They include the native adapters, consumer tests and corresponding agent/bridge documentation updates. They have not been pushed, merged or released. Their manifests name the registry version; regenerate their registry lockfiles after publication, before any app migration is merged. No temporary tarball path was committed. The original app checkouts retain their prior state.

## External clipboard interoperability

The external checks ran on macOS 27.0 using a standalone native WKWebView consumer built from the exact replacement archive. They used the package's public facade, ordinary native Paste and Copy commands, disposable notes and an unsent Mail compose window. This host is separate from the app integration suites above.

The full fixture contains a heading, bold and italic text, bullet and numbered lists, a code block, a two-column table and two managed inline PNG images with surrounding text. Both images have the same fixture bytes; reverse import therefore shares the imported asset while retaining both document positions. The partial fixture selects the formatted paragraph within that document.

| Direction                            | Destination/version                                | Result                                                                                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| InkKit to Obsidian, full and partial | Obsidian runtime 1.14.4; installed launcher 1.8.10 | Passed visible content and formatting. The full note retains the heading, emphasis, lists, code contents, table cells and both images. Both images decode to 80 × 40 pixels.                                                    |
| Obsidian to InkKit, full and partial | Native reading-view selection                      | Passed after the heading-control fix. The imported heading remains a heading; emphasis, lists, code contents, table and both image positions survive. Imported PNG bytes match the exported fixture bytes.                      |
| InkKit to Mail, full and partial     | Mail 16.0                                          | Passed visible text and rich content. The full compose body exposes its heading, lists, table and both images through native accessibility. The native rich clipboard contains two PNG attachments at their original positions. |
| Mail to InkKit, full and partial     | Native compose-body selection                      | Passed semantic HTML import, including the heading, emphasis, lists, Swift code block, table and both images. The partial selection preserves its formatted phrase. Imported PNG bytes match the exported fixture bytes.        |

These are semantic checks, not byte-identical Markdown round trips. Obsidian canonicalises italic delimiters and list spacing and drops the code block's language hint on paste. Native rich HTML can introduce non-breaking spaces. Mail can inherit paragraph style when replacing an existing rich body; the repeated-paste partial fixture inherited a heading style while retaining its text and emphasis. The package's exported partial HTML remains a paragraph.

The test images were meaningful native rich content and data-backed HTML, without private presentation URLs. These checks exercise the package image adapter and the native clipboard formats. They do not claim that a production Memos window was manually copied into every destination.

## Additional example destination

Craft interoperability remains **unverified**. A transferred TestFlight build (3.6.10) did not launch on the test machine. The official vendor download (3.6.8) launched, but its window exposed no editor or onboarding content through accessibility. Screen capture was denied by the host's privacy controls, so the visible state could not be inspected. No account requirement was inferred, no credentials were copied and no privacy control was bypassed.

Craft was named as an example application, not a required test destination. Its unverified status does not block publication. The completed Obsidian and Apple Mail checks provide the required representative external clipboard evidence; no Craft test or privacy-permission change is required from the maintainer.

## Reproduction and cleanup

The reusable packed-consumer, WebKit and native clipboard probes are in [`scripts/interop`](../scripts/interop/README.md). The captured evidence remains in ignored scratch storage; production clipboard snapshots, notes, downloaded applications and account data are not committed.

The test Mail compose window was closed using **Don't Save** after confirming its unique fixture subject. It had no recipients and no message was sent. The original native clipboard was restored, then saved again and compared byte-for-byte with the original snapshot. Existing Mail windows were not closed and Mail was not quit.

## 0.0.6 candidate verification

On 9 October 2026, clean candidate `4969787146ae65f442fa8f46e30409a22f94cca3` passed 394 regressions, TypeScript, formatting, playground and fresh packed-consumer checks, including public declarations, CSS and offline bundling. Independent source and preservation review included the actual Obsidian clipboard return and malformed table input. Candidate archive SHA-256: `04211d3efd21d25ef70604d2273b3c5cf7e3fe3b4d6cd0d8bbf03ea6d23d0701`.

All 55 installed package files in the standalone WKWebView and three isolated app hosts match the candidate. On Atlas, macOS 27 and Xcode 27, the standalone consumer passed 37 scenarios and 740 operations covering retained features, table operations, source reconstruction, undo, copying, saving and reopening.

The isolated PadPad, Memos and Memos WithMarfa hosts passed 87 functions and 90 parameter cases, including native Paste, growth, undo and malformed-input handling. Full and partial native transfers to and from Obsidian 1.14.4 and Mail 16.0 passed. Returned tables retain the exact ordered 3×3 cells. Obsidian normalises column alignment to logical start; native rich returns can normalise Markdown spelling and discard Mermaid metadata while retaining a verified portable bitmap. These are semantic clipboard checks.

Clipboard, app and print preferences were protected and independently checked against restoration baselines. Disposable notes and unsent compose windows were removed; no client app adopted the package permanently. Earlier candidates and failure evidence remain retained. Publication and registry verification are recorded separately in [release gate #22](https://github.com/aicayzer/inkkit/issues/22).

## 0.0.6 publication

On 9 October 2026, [release.yml](https://github.com/aicayzer/inkkit/actions/runs/37917653773) published `v0.0.6` at `70ee5bf2c08372daa2c0e207ee1d8f56dd7710b5` through GitHub-hosted npm OIDC. Independent fresh-cache Sigstore verification confirmed certificate trust, the GitHub issuer, workflow/tag identity, source commit and signed package digest. Registry compressed SHA-256 `ce8cd1bb5b0c31c4329728a1b5373f848c7f8fd6eef89bb54a9f48793c6d10a7` matches the workflow archive exactly; decompressed tar SHA-256 `3f66ea5b1ed15bebc46d395df5e74b29718e9ee1f54e2832987da6b7dc10b6ce` matches the native-tested candidate. Only compression differs from that candidate.

Fresh exact-version npm installation, public declarations, CSS and offline bundling pass. A separate fresh native consumer built from the downloaded registry archive matches all 55 package files and passed all 37 scenarios and 740 operations. Protected clipboard and print preferences match their baselines. Independent publication and runtime audits passed; [release gate #22](https://github.com/aicayzer/inkkit/issues/22) and milestone 0.0.6 are closed. The [GitHub release](https://github.com/aicayzer/inkkit/releases/tag/v0.0.6) includes the verified registry archive. Permanent app adoption and app releases remain separate.

## 0.0.7 candidate verification

On 9 October 2026, clean candidate `19624ef443c7e05d58f641163ec7cb79c14e801f` passed 452 regressions, TypeScript, formatting, playground and fresh packed-consumer checks. Public declarations, CSS and offline bundling passed. Independent source, preservation and native-evidence reviews passed. Archive SHA-256: `79c95e8595e8b735003e5fd83ac51c806c1f77eebcfd13feb3c66596f7e3c1ee`; decompressed tar SHA-256: `eb3bb1b2a7bf4ee4509f408cb021edf27008a84d56a398e9ac00af2ea91eaa3d`.

All 61 installed package files match the candidate in four fresh consumers. The standalone macOS WKWebView passed 48 scenarios and 1,072 operations, including source editing, replacement, heading navigation, undo, preservation and rendered textarea scrolling. This exposed and verified a fix for off-screen source selections. Three isolated app hosts passed 99 functions and 102 cases with no failures or skips, including native source paste. Clipboard, app and print preferences match their restoration baselines; no app permanently adopted the package.

The 0.0.7 external Obsidian/Mail return exchanges remain unverified. Two Obsidian outgoing captures were collected, but no return exchange completed and no Mail paste completed before a fixture helper became unavailable. The user stopped further external and app testing because the accumulated testing was excessive. Owned fixtures were closed and protected state restored. The completed package and native results remain valid; these incomplete exchanges are a recorded limitation, not a requirement to repeat testing. Earlier candidates and failure evidence remain retained. Publication is recorded separately in [release gate #23](https://github.com/aicayzer/inkkit/issues/23).

## 0.0.7 publication

On 9 October 2026, [release.yml](https://github.com/aicayzer/inkkit/actions/runs/37926055714) published `v0.0.7` at `8f57353c8ccd53a25512e2fb47792cffc7269be8` through GitHub-hosted npm OIDC. Fresh-cache Sigstore verification confirmed certificate trust, the GitHub issuer, workflow/tag identity, source commit and signed package digest. Registry compressed SHA-256 `a57a4fe77c3ff863660d4bbf1fc652cfd600c487f3a8a6287d7d7d4c7d45588f` matches the workflow archive exactly; decompressed tar SHA-256 `eb3bb1b2a7bf4ee4509f408cb021edf27008a84d56a398e9ac00af2ea91eaa3d` matches the native-tested candidate. Only compression differs from that candidate.

Fresh exact-version npm installation, public declarations, CSS and offline bundling passed. Offline consumer SHA-256 `d3be167f19b07a4be30aec56b4ed093a3670314c02d1f791cef0a7f4116ba6e1` matches the candidate consumer. The merged release changes only verification documentation from the native-tested candidate; package inputs are identical.

One short published-package WKWebView scenario passed all 17 steps: source editing, mode switching, replacement, heading data/navigation, undo and exact clean snapshot restoration. Its 61 installed files match the registry archive and its runtime bundle matches the native-tested candidate. Protected clipboard restoration passed. No app-host or external clipboard suites were repeated. Independent publication and runtime-evidence reviews passed; [release gate #23](https://github.com/aicayzer/inkkit/issues/23) and milestone 0.0.7 are complete. The [GitHub release](https://github.com/aicayzer/inkkit/releases/tag/v0.0.7) includes the verified registry archive. Both authorised releases are published and verified; permanent app adoption and later roadmap work remain separate.

## 0.0.8 publication verification

On 9 October 2026, [PR #50](https://github.com/aicayzer/inkkit/pull/50) merged the host controls, fixture playground and bounded verification after independent review and [hosted Linux/macOS CI](https://github.com/aicayzer/inkkit/actions/runs/37989183395). Review fixed invalid negative task-marker CSS offsets. Clean reviewed candidate `681c2cf799c4185cf0c5e4518068463b0a80da7f` passed 478 regressions, package/format/playground checks, 12 Chromium cases and six selected WKWebView scenarios (103 steps).

The original packed evidence remains attributed to `3b7f4fa77c26b17009ff6c7a8a1c82a6f73006a5`; final original commit `4b095679a6672469d413b0a8a5fe2e3e64234e31` changed only a fixture’s cancellation expectation. Those archives and native/failure results remain retained. The reviewed CSS fix changed package inputs and received fresh evidence rather than relabelling the original archive.

[release.yml](https://github.com/aicayzer/inkkit/actions/runs/37989458320) published `v0.0.8` at `ceb6ee440d3ce010ec524c653a508db963518f94` through npm OIDC and recorded signed provenance. Registry SHA-256 `964015d5a19578bbedde4d3aa3432b4159b1a6977aee832790924be8041d3bca` matches the hosted archive exactly. Decompressed tar SHA-256 `d8ccff69b668f9204292b70d68d3c229e864ea13637c15f46d2dfbbc66072d91` matches the reviewed native-tested candidate; only compression differs. Fresh exact-version registry installation, declarations, CSS and offline bundling passed. Offline consumer SHA-256 `7fbe0b27a9237ed531a93e2c1cdd0c9c9adea3b0d66c69e1836275c6014dc694` matches the candidate. npm processing delayed availability; publication was not repeated.

[The GitHub release](https://github.com/aicayzer/inkkit/releases/tag/v0.0.8) holds the registry archive and machine-readable evidence; milestone 0.0.8 is complete. Raw evidence remains on Atlas under `/Users/aicayzer/Services/inkkit-worktrees/0.0.8/_local/release/0.0.8/`. Synthetic composition tests establish guards, not complete IME interoperability. Input preferences depend on browser/OS support. No routine external-app matrix or actual-app adoption occurred.

## 0.0.9 publication verification

On 9 October 2026, [PR #51](https://github.com/aicayzer/inkkit/pull/51) merged native search ranges and the viewport contract after independent review and [hosted Linux/macOS CI](https://github.com/aicayzer/inkkit/actions/runs/37992644466). Clean reviewed candidate `7c1d926658dec8bd1dbc450b72cc4b9da3f586d9` passed 495 regressions, package/format/playground checks, 12 selected Chromium cases and five selected WKWebView scenarios (152 steps). Review corrected reload selection, wrapped-range scrolling and host-focused formatted search navigation. Earlier candidate evidence remains separate.

[release.yml](https://github.com/aicayzer/inkkit/actions/runs/37992859461) published `v0.0.9` at `104c7ddd06d4b42fe3218646c3415c9efb2ea67e` through npm OIDC with signed provenance. Registry SHA-256 `dadf171581e6cce75f4126f594bb4364abb9af56c8c34988a14d028c5776954c` matches the hosted archive exactly. Decompressed tar SHA-256 `56f2ad4b1c18baf73d1033272255b8ee60e367e495246fc18a632fce20d19454` matches the native-tested candidate; only compression differs. Fresh exact-version registry installation, declarations, CSS and offline bundling passed. Offline consumer SHA-256 `9a89393f373c99e9aac36bb06dc65c7da79bb031d6c048d51bbf5bf16830e1fb` matches the candidate. A brief registry availability delay did not trigger another publication.

[The GitHub release](https://github.com/aicayzer/inkkit/releases/tag/v0.0.9) holds the archive and machine-readable evidence; milestone 0.0.9 is complete. Raw evidence remains on Atlas in the development worktree under `_local/release/0.0.9/`. UTF-16 offsets and geometry belong to their captured editor/document scope. Composition cases verify guards rather than a complete IME matrix. No actual-app adoption or external-app matrix occurred.

## 0.0.10 candidate verification

On 9 October 2026, clean packed commit `6adcbe23c8109d7099ad9bf047fd4a0602ee1f51` passed 578 regressions, TypeScript/build/format/playground and isolated packed-consumer declaration/CSS/offline checks. Nine selected Chromium smoke and linked-file cases passed. Independent syntax/export and view/lifecycle reviews resolved action error reporting, newly folded request cancellation and blocked PDF fallback findings. The package build also required an explicit portable declaration annotation.

Candidate archive SHA-256: `a49e1c8719dce6ff709d649eb70dd97054cac523e07fa2dea1eb6f2fb3d4ad88`; decompressed tar SHA-256: `96449bb5c57b4b3207d59927b23136712c209b9cbf87844e6ddec69d5302ede1`; fresh offline consumer SHA-256: `9d3bce746b3c80e29d79d0839a61df15594d6a22d429baf1127245df14bbd9b7`.

Six selected WKWebView scenarios passed 114 steps covering retained core behaviour, Unicode wiki source/activation, named sizing/undo/read-only, media controls and lifecycle, stale asynchronous exports, ordinary DOM copy and portable output. Frozen HTML printed to a real native PDF with all descriptive media/file fallbacks and three verified image placements. The existing AppKit pasteboard probe preserved exact text/HTML, three ordered attachments with exact bytes and rich descriptive fallbacks; all original pasteboard types and bytes were restored. No external application or actual-app adoption was involved.

Native evidence retains the first run and its failures. Fixture commits through `74f25849a2c05882e7e2c6d8c72fd53353abf03f` corrected observation timing and full DOM selection, without changing packed inputs. Passing core/stale-export cases were reused; the three affected scenarios were rerun. Final fixture bundle SHA-256: `81d8ba7d796989631d293e4ce0cc7cd1d2b4082346c8bb2727cda0835ecc3715`. The unchanged selectable native host SHA-256 is `85e298616ee4233df2ebf6f5fe5d0a7fa7cab8906b50c5e1ae395a1cd5a2a85e`.

PDF previews remain protected and depend on platform support; the visible fallback and host Open action are verified, rather than claiming an embedded PDF page rendered on every platform. Audio/video/PDF/file print and rich copy use documented descriptive fallbacks. Composition fixtures verify guards, not complete IME interoperability. Hosts retain file access, permissions and native actions. Publication is a separate gate under [releasing](releasing.md). Raw evidence remains on Atlas under `_local/release/0.0.10/` in the development worktree.
