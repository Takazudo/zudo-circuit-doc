# Changelog

All notable changes to `create-zudo-circuit-doc` are documented in this file.

The format is based on Keep a Changelog, and release notes are generated from the changelog MDX pages.

## [Unreleased]

**Pending 0.2.0; not published.** The prepared upstream family is
zudo-doc 7.0.0 / ZFB 4.5.2, following the merged [#156](https://github.com/Takazudo/zudo-circuit-doc/pull/156) migration.

## Breaking changes

- Require Node 24 LTS (`>=24 <25`), matching zudo-doc 7. Node 22 and 25 are unsupported.

- Generate the zudo-doc 7 / ZFB 4 host and select runtime ^0.3.0.
- Keep old generated projects on runtime ^0.2.0 with zudo-doc 5 / ZFB 2 until the complete host
  migration is intentional. The prepared pins are zudo-doc/history/create-zudo-doc 7.0.0 and
  the aligned ZFB 4.5.2 tuple, with tested runtime peer floors ^7.0.0 / ^4.5.2.
- Follow the existing-consumer migration recipe.

## Verification and publication

Strict packed-consumer types, build, browser and fixture verification gate integration.
Publish/approve runtime first, run the empty consumer's published-runtime gate, then
publish/approve initializer. These publication steps remain separately pending.

## [0.1.0] - 2026-09-27

Initial release of `create-zudo-circuit-doc`, an initializer that creates a ready-to-use
circuit-development project with a zudo-doc site, the runtime package, canonical project workflows,
and evidence authoring templates.

## Features

- `pnpm create zudo-circuit-doc <destination>` scaffolds a project from a template kept in sync with
  the `examples/empty` host, checked for parity with the upstream zudo-doc scaffold.
- Generated projects depend on `@takazudo/zudo-circuit-doc` through a `^0.1.0` caret range and ship a
  `circuit.config.ts`, empty evidence data, the canonical agent workflow, skills, and authoring
  templates.
- Options: `--name`, `--title`, `--library`, `--agent claude|codex|both|none`, `--yes`,
  `--install` / `--no-install`, `--git` / `--no-git`, and `--runtime-spec` to override the runtime
  dependency with a semver range, dist-tag, or absolute `file:` spec.
- A non-empty destination is rejected and left byte-for-byte unchanged; an existing empty directory
  is accepted.
- Generated projects include a README titled after the site, a `contract.md`, and plain-text next
  steps.
