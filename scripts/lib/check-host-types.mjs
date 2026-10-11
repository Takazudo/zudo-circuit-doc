import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { PNPM, run } from "./verify-helpers.mjs";

/** Compile the public registry at the consumer's resolution boundary, not workspace sources. */
export async function checkHostTypes(hostDir) {
  const docDir = path.join(hostDir, "doc");
  const probe = path.join(docDir, ".circuit-mdx-registration.ts");
  await writeFile(probe, [
    'import { defineChromeBindings } from "@takazudo/zudo-doc/chrome-bindings";',
    'import { circuitDocMdxExtras } from "@takazudo/zudo-circuit-doc/mdx-extras";',
    'defineChromeBindings({ mdxExtras: { ...circuitDocMdxExtras } });',
    '',
  ].join("\n"), { flag: "wx" });
  try {
    await run(PNPM[0], [...PNPM.slice(1), "exec", "tsc", "--noEmit", "--strict",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022",
      "--lib", "ES2022,DOM,DOM.Iterable", probe], docDir);
    await run(PNPM[0], [...PNPM.slice(1), "exec", "tsc", "--noEmit", "--project", "tsconfig.json"], docDir);
  } finally {
    await unlink(probe);
  }
}
