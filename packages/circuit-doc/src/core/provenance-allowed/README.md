# Provenance allowlists

`scripts/check-core-provenance.mjs` re-hashes every file recorded in
`../PROVENANCE.md` and fails the check if any byte differs from the recorded
upstream sha256 — unless the changed file's path is listed in one of the
`.txt` files in this directory.

Each sub-issue that deliberately changes a `src/core/**` file owned by #5
(currently #10, #14, #15) gets its own file here, named after the issue's
branch slug, e.g. `10-emit-ownership.txt`. One relative path per line,
relative to `packages/circuit-doc/src/core/`. This keeps each issue's allowed
drift isolated, so two parallel branches never need to touch the same file to
add their own exception, and a reviewer can see at a glance which issue owns
which intentional change.

Do not add a path here to silence an accidental or unreviewed diff — only for
a change the owning issue is deliberately making, matching an ADR in the epic
(https://github.com/Takazudo/zudo-circuit-doc/issues/1).
