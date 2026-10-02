# Offline release proposal (not authorization, not a release)

Upstream repository: Takazudo/zudo-circuit-doc. Current default main5d0e2b630776489d394be341586b889dfe0d1cb8; runtime/test/build inputs exactly match tested releasef3c0aee5f3704686fb833cf79548c530509e11b2. All upstream operations so far are read-only. Isolated release working tree: (an isolated working tree on the author machine). No source branch push, upstream commit, release tag, npm stage, GitHub Release or deployment has occurred.

Prepared versions: runtime0.2.0; initializer0.1.1. Runtime0.2.0 follows SchemeB because exported model-path/transform/descriptor types become nullable and document-kind switches must handle source-record. Existing typed LED consumers required null handling. The initializer is a compatibility update to its generated ^0.2.0 runtime range. Its flags/API are unchanged. Release dates in the prepared MDX are proposed metadata, not evidence of publication; refresh the date if actual release occurs later.

The full candidate includes the source/test fixes, user-facing schema/CAD/browser documentation, canonical example workflow and checks text, generated initializer template, package versions and changelog MDX. The normal docs build must generate package CHANGELOG.md files; do not hand-author those outputs. The original0.1.0 changelogs remain historical.

Release execution after explicit approval must follow current .claude/skills/l-make-release/SKILL.md and dev-docs/publishing.md. Split the reviewed implementation PR from release preparation as appropriate; retain the runtime and initializer release commits/tags separately. Merge/push to upstream main automatically deploys upstream documentation. That side effect is part of the required exception to the circuit project's no-deploy/read-only-sibling rules.

1. Apply the reviewed change through an upstream topic/PR and exact-head CI, then merge.
2. On clean current main, prepare runtime0.2.0, template range and generated changelog; run normal guarded build/docs, typechecks/tests, template check, release dry-run, packed empty/minimal consumers, then commit. Verify every applicable exact-main CI/deployment run before tagging.
3. Recheck exact version absence and unchanged upstream head/tag status. Push immutable tagv0.2.0 only after those gates. The normal workflow stages with existing stage-only credentials; it does not make the package live.
4. Maintainer2FA approval promotes the stage. No code/credential has been requested or supplied. Verify actual registry version/latest and create/reuse GitHub Release.
5. Only after runtime is live, execute initializer0.1.1 compatibility release separately, including the published-runtime consumer gate. Its prepared metadata is reviewable now; its registry-dependent gate cannot honestly pass before runtime publication.
6. Adopt the released runtime in the OSC project, update its resolved-version blocker decisions, publish the remaining exact inventory records with honest generic document/no-model labels, regenerate and validate. No hardware/source qualification is implied.

Offline verification is constrained to cached dependencies and local tarballs. Environment sets npm_config_offline and PNPM_CONFIG_OFFLINE; no package install into sibling/shared node_modules is allowed. Exact registry-absence/authentication/staging/provenance checks and the initializer published-runtime gate are NOT RUN in this preparation. A green local dry-run is not authentication or publication evidence.

Approval must explicitly cover the upstream repository work, normal PR/merge and automatic upstream docs deployment, reviewed release commits/tags/npm staging, and later project adoption. Owner2FA remains an external completion step. No fabrication, supplier contact or circuit-site deployment is included.
