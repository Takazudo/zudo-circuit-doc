// Ported verbatim from zudo-led-lamp `doc/component-docs/footprint-previews/hash.ts`.
import { createHash } from "node:crypto";

export function sha256(contents: string | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** `aggregateHash([])` (the zero-package manifest) is the hash of the empty string. */
export function aggregateHash(entries: readonly { readonly path: string; readonly sha256: string }[]): string {
  return sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""));
}
