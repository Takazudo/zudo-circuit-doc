# Canonical circuit workflow — instruction draft

This is a **draft template**, not an installed skill. During implementation, place the agreed workflow at `circuit/WORKFLOW.md` and make selected tool entry files point to it. Preserve any existing project instructions.

## Shared behavior

Read the current project brief and next-actions page. Use the configured inventory/evidence provider. Route exact manufacturer/MPN/supplier identities to their owner bundles before changing circuit, schematic, PCB, BOM, firmware, startup behavior or associated documentation.

For adding or replacing a component, handle identity, sources, facts, pins, project use, CAD, publication and validation as a connected task. Use relevant integration rules for claims that span components or lifecycle stages.

Treat retained facts and source locks as the authoritative exact-component knowledge. Use authored documentation for purpose, rationale and decisions. Regenerate catalog MDX; do not patch it by hand.

## Sources and claims

Prefer manufacturer-primary evidence for performance claims. Preserve revision, retrieval date, hash, locator, minimal extract, units, conditions, provenance and verdict. If evidence cannot be obtained, record that state and keep the affected claim unresolved. Never borrow electrical ratings from a same-name component or silently infer unavailable content.

Run canonical offline validation before and after relevant edits. Online acquisition/refresh is explicit and never part of the documentation build. Re-pin changed sources only after inspecting them.

## CAD work

Resolve the exact variant before downloading. Distinguish exact, family and derived models. Preserve originals, source provenance, correction/derivation steps, transforms and geometric checks. Check electrical pin/pad mapping separately from visual appearance. Physical seating and solder/clearance checks need their own evidence.

Follow configured library paths and selected preview tooling; do not embed workstation-specific paths or lamp-specific library names. Regenerate affected previews when canonical input changes.

## Design and task scope

Follow the user's requested work and established project decisions. Complete routine downloads, evidence updates and generated outputs without repeated permission prompts. Ask a focused question only when a missing exact identity, design choice or external access prevents a meaningful result.

A source audit identifies a possible design change; it does not itself decide to change connectivity or firmware behavior. Implement such a change when it is part of the user's task, and update the related design/evidence together.

## Completion

Report what changed, what source/variant was checked, what validation ran, and what remains unresolved. Keep bench work explicit. Link the source locator or acquisition receipt. Update next actions when the project state has materially changed.

## Thin entry-file examples

For a selected tool, the substantive content can be as small as:

> Read circuit/WORKFLOW.md first. It defines the shared circuit-development workflow and points to the configured exact-component evidence. Use that canonical source for this project.

The initializer should adapt the entry filename and merge behavior to the current tool's conventions. It should not duplicate the whole workflow into both tool directories.
