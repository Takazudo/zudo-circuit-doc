# Publishing

Release policy, npm publishing steps, credentials, and recovery guidance.

Use `/l-make-release` to prepare a package release. This runbook records the release rules, owner
actions, and recovery steps. A matching GitHub Actions workflow publishes each package from its
release tag.

## Release policy

Releases use the stable npm `latest` channel only. There are no `next` tags or prerelease versions.
Each package's own `package.json` is its version source; the private root `package.json` is never
bumped for a release.

| Package | Release tag | Publish workflow |
| --- | --- | --- |
| `@takazudo/zudo-circuit-doc` | `vX.Y.Z` (`v*.*.*`) | [publish-zudo-circuit-doc.yml](https://github.com/Takazudo/zudo-circuit-doc/blob/main/.github/workflows/publish-zudo-circuit-doc.yml) |
| `create-zudo-circuit-doc` | `create-zudo-circuit-doc-vX.Y.Z` (`create-zudo-circuit-doc-v*.*.*`) | [publish-create-zudo-circuit-doc.yml](https://github.com/Takazudo/zudo-circuit-doc/blob/main/.github/workflows/publish-create-zudo-circuit-doc.yml) |

For pre-1.0 releases, use Scheme B: a breaking change increments the minor version; other changes
increment the patch version. The first release of each package is `0.1.0`. Finalize its seeded
[changelog](/docs/changelog), create the release commit, and tag that new commit. Never tag an old
package-introduction commit.

Publish the runtime before the initializer. The initializer's publish gate,
`pnpm verify:pack --fixture empty --published-runtime`, installs the runtime version selected by
the template's `^X.Y.Z` range from npm. That version must already be live. A runtime patch by itself
does not require an initializer release; a runtime minor or major release does, because the
initializer's runtime range must be updated and verified.

The workflows build and check their package, verify a consumer install, and **stage** the version
with `npm stage publish --tag latest --provenance`. A staged version is not live: a maintainer
approves it with 2FA, which puts it on the npm `latest` tag. A pushed matching release tag starts
its workflow. A manual retry must also name the exact release tag because the workflow guard
rejects branch refs.

## First version of a package

npm cannot stage a package name that does not exist yet, and the stage-only token cannot publish
directly. A package's first version is therefore published once by a maintainer from the exact
release tag tree:

```sh
pnpm --filter <package> build
cd packages/<dir> && pnpm pack --pack-destination <dir>
npm login --registry=https://registry.npmjs.org/
npm publish <tarball> --access public --tag latest --otp=<code>
```

Push the release tag and let its workflow pass every check first; its stage step fails for a new
package, which is expected. A local publish has no provenance statement.

## Approving a staged release

After the publish workflow succeeds, approve the pending stage with npm 11.15.0 or newer (use
`npx npm@11.20.0` when the installed npm is older):

```sh
npx npm@11.20.0 stage list <package>
npx npm@11.20.0 stage view <stage-id>
npx npm@11.20.0 stage approve <stage-id> --otp=<code>
```

`npm stage reject <stage-id>` discards a bad stage. See
[staged publishing](https://docs.npmjs.com/staged-publishing/).

## Publish credentials

The repository `NPM_TOKEN` secret is a **stage-only** npm granular access token (replaced
2026-09-27). Before a release, confirm that it is unexpired and has these settings:

- **Read and write (stage only)** permissions. npm rejects a direct `npm publish` with this token.
- Coverage for the `@takazudo` scope and the unscoped `create-zudo-circuit-doc` package. Choose
  **All packages** or an equivalent selection; selecting only the scope does not cover the unscoped
  initializer.

GitHub does not reveal a saved secret's value, so check the token settings and expiry in npm. To
rotate the token, create a replacement with the same permissions and update the repository secret:

```sh
gh secret set NPM_TOKEN
```

See [npm access tokens](https://docs.npmjs.com/about-access-tokens/) and
[creating and viewing access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens/).

### Move to Trusted Publishing

After each package exists on npm, configure a GitHub Actions trusted publisher in that package's npm
settings. Use owner `Takazudo`, repository `zudo-circuit-doc`, and the matching workflow filename.
Keep it stage-only so a maintainer still approves each version.

| Package | Workflow filename |
| --- | --- |
| `@takazudo/zudo-circuit-doc` | `publish-zudo-circuit-doc.yml` |
| `create-zudo-circuit-doc` | `publish-create-zudo-circuit-doc.yml` |

Verify that an OIDC-authenticated `npm stage publish` succeeds before removing the
`NPM_TOKEN` secret and revoking the token. Dry runs cannot verify npm authentication or prove that
provenance will be issued. npm has scheduled the end of token-based direct publishing for January
2027, so complete this migration before then. See
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

## If a publish workflow fails

A green workflow means the version is staged, not live; approve it as described above. For a failed
run, check the exact package version on the public npm registry before retrying or changing a tag:

```sh
npm view "@takazudo/zudo-circuit-doc@<version>" version --registry=https://registry.npmjs.org/
npm view "create-zudo-circuit-doc@<version>" version --registry=https://registry.npmjs.org/
```

If the command returns the version, the package is published. Keep the release tag and commit; do
not re-tag, delete the tag, or rerun the publish workflow. Continue any remaining release steps
through `/l-make-release`.

Retry only when the registry clearly confirms the exact version is absent. A timeout, authentication
error, or other inconclusive registry response means stop and check again later.

- For a transient or credential-only failure, fix the cause, then dispatch the existing workflow at
  the exact release tag:

  ```sh
  gh workflow run publish-zudo-circuit-doc.yml --ref vX.Y.Z
  gh workflow run publish-create-zudo-circuit-doc.yml --ref create-zudo-circuit-doc-vX.Y.Z
  ```

  A branch ref is rejected by the workflow's tag guard. If rotating the token, update
  `NPM_TOKEN` as described above before dispatching.
- If the package needs a code fix, release a new version through `/l-make-release`. Do not move or
  recreate the existing tag at different content.

## Local release check

Run the non-publishing release check before preparing a release:

```sh
pnpm release:dry-run
```

This checks release preparation locally. It does not test GitHub's secret, npm permissions, staging,
Trusted Publishing, or provenance issuance.

## Generated template install age

For the first release, keep `minimumReleaseAge: 0` in the generated template. The initializer's
published-runtime gate and a fresh scaffold both need to install a just-published runtime at once.
Revisit the setting after the packages exist on npm and pnpm fixes the peer-nested-lockfile
limitation documented in the template. Then restore the intended release age with a supported
exception for the first-party runtime, and change the template only after both the published-runtime
gate and a fresh scaffold install pass with that policy.
