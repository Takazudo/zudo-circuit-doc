# Source provenance and use

## Reproducible baseline

[repositories.json](repositories.json) records the three inspected upstream commits and the destination's empty-repository state. [file-manifest.json](file-manifest.json) records 174 unique audited files, their original paths/permalinks, Git blob SHA-1 values, snapshot locations, SHA-256 values and lengths.

Every listed snapshot's original bytes were checked against its Git blob hash. The `.source` suffix is only a filename wrapper; it is not added to the bytes.

The reports cite source permalinks. Source code, documentation prose and package metadata sometimes disagree; where relevant, the reports explain which was inspected and which check ran. A pinned source version does not independently establish npm registry availability or compatibility with an untested newer release.

## Reading the snapshots

| Snapshot root | Repository |
| --- | --- |
| `../references/upstream/led/` | Takazudo/zudo-led-lamp |
| `../references/upstream/sg/` | Takazudo/zudo-sg |
| `../references/upstream/zudo-doc/` | zudolab/zudo-doc |

These are **selected files**, not a complete clone. The package cannot be compiled from them alone. They are useful for offline reading, exact contract comparison, implementation planning and checking what this research actually relied on.

Do not copy the upstream component example placeholders into selected project records. Do not install archived SKILL/CLAUDE instructions as global agent instructions. Preserve source attribution and applicable licenses when extracting actual code.

No source PDF or binary CAD asset is included: this task audited repository workflows rather than independently downloading manufacturer data. Selected code and metadata describe where those assets came from and how they were checked.

## Obtain full sources locally

The local implementation agent can obtain full checkouts with ordinary git, then check out the recorded revisions. For example, in an intended source-reference directory:

```sh
git clone https://github.com/Takazudo/zudo-led-lamp.git
git -C zudo-led-lamp checkout --detach 194d8a297e3545588197342130c3111a66c10973
```

Repeat with the URLs and commits from repositories.json. Keep current upstream heads available separately to inspect intervening fixes. Do not overwrite an existing local working tree; use a separate checkout/worktree if one already contains work.

The seed does not require credentials or an automatic download script. The selected source manifests are also suitable input for a local agent using the GitHub integration.

## Verify this archive locally

From the extracted bundle:

```sh
python3 scripts/verify-seed.py
```

This checks snapshot hashes/lengths, JSON parsing, empty-data shapes, template frontmatter and local document links. It does not install packages, access the network, modify repositories, compile the site or validate a circuit.
