# Changelog

All notable changes to `create-zudo-circuit-doc` are documented in this file.

The format is based on Keep a Changelog, and release notes are generated from the changelog MDX pages.

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
