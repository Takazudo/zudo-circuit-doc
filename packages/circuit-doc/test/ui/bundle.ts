// Bundle TSX and the published server/testing entries together so every real
// Island target shares the scanner context used by the synchronous renderer.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export type SsrModule<T> = T & {
  readonly h: typeof import("@takazudo/zfb/zudo-react").h;
  readonly renderToString: typeof import("@takazudo/zfb/zudo-react/server").renderToString;
};

export async function bundleForSsr<T>(entryFromPackageRoot: string): Promise<SsrModule<T>> {
  const compiled = await build({
    stdin: {
      contents: [
        `export * from ${JSON.stringify(`./${entryFromPackageRoot}`)};`,
        'export { h } from "@takazudo/zfb/zudo-react";',
        'import { renderToString as render } from "@takazudo/zfb/zudo-react/server";',
        'import { withIslandTestContext } from "@takazudo/zfb/zudo-react/testing";',
        'import { FootprintPreviewIsland } from "./src/islands/footprint-preview-island.tsx";',
        'import { PackageModelViewerIsland } from "./src/islands/package-model-viewer-island.tsx";',
        'export const renderToString = (node, options) => withIslandTestContext({ components: { FootprintPreviewIsland, PackageModelViewerIsland } }, () => render(node, options));',
      ].join("\n"),
      resolveDir: PACKAGE_ROOT,
      sourcefile: "ssr-entry.ts",
      loader: "ts",
    },
    absWorkingDir: PACKAGE_ROOT,
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const source = compiled.outputFiles[0]?.text;
  if (source === undefined) throw new Error(`esbuild produced no output for ${entryFromPackageRoot}`);
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)) as SsrModule<T>;
}
