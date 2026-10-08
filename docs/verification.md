# Verification record

Verified on 8 October 2026. This record describes the tested release candidate; it does not establish publication or complete the Craft interoperability gate.

## Candidate

- Package: `@aicayzer/inkkit@0.0.1`.
- Package source: `0ede884fe0a8b7b5a19437d48bc9dd140e10275c`.
- Archive: `aicayzer-inkkit-0.0.1.tgz`.
- SHA-256: `d739adc1883145fd62b4ac3800da6bb53d2253f437959e9e49fb97dfb1e0059d`.
- npm integrity: `sha512-hi0tSouWXnVBOMucKU4z4MMxhFU0OYTu6FW5DakFhHpfqPzUX6aD3Eorsa3vn5Uhc52OyYdqwgViY17SzRdemQ==`.
- Package checks: 99 tests, TypeScript, formatting, build and a clean npm consumer passed. The clean consumer exercised the public exports, stylesheet and a single-file offline bundle.

The earlier archive, SHA-256 `07943c224e4c1fb47d5b1a49806e1424233f7e323bdd475dbe2b652ae021af07`, was replaced after an actual Obsidian reverse-copy check exposed a heading import defect. The replacement filters the copied encoding metadata and narrowly identified reading-view controls. A reduced native clipboard fixture and regression tests retain arbitrary authored SVG and similarly named content.

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

## Outstanding Craft gate

Craft interoperability remains **unverified**. A transferred TestFlight build (3.6.10) did not launch on the test machine. The official vendor download (3.6.8) launched, but its window exposed no editor or onboarding content through accessibility. Screen capture was denied by the host's privacy controls, so the visible state could not be inspected. No account requirement was inferred, no credentials were copied and no privacy control was bypassed.

The remaining step is to allow screen capture for the SSH automation's responsible process in the test host's Screen & System Audio Recording settings, then inspect Craft's visible state and run the full and partial clipboard checks in both directions. Any required account setup must be handled explicitly. A permission request is pending with the user. The release remains a draft without a release tag or npm publication while this gate is open.

## Reproduction and cleanup

The reusable packed-consumer, WebKit and native clipboard probes are in [`scripts/interop`](../scripts/interop/README.md). The captured evidence remains in ignored scratch storage; production clipboard snapshots, notes, downloaded applications and account data are not committed.

The test Mail compose window was closed using **Don't Save** after confirming its unique fixture subject. It had no recipients and no message was sent. The original native clipboard was restored, then saved again and compared byte-for-byte with the original snapshot. Existing Mail windows were not closed and Mail was not quit.
