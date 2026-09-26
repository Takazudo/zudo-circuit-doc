// Node type stripping cannot load `.tsx`, so UI/island modules are bundled
// through esbuild (LED tests/evidence-fact.test.ts precedent) and imported
// from a data: URL. The entry re-exports preact's `h` and the SSR renderer
// next to the module under test so hooks and vnodes share one preact copy.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export type SsrModule<T> = T & {
  readonly h: typeof import("preact").h;
  readonly renderToString: typeof import("preact-render-to-string").default;
};

export async function bundleForSsr<T>(entryFromPackageRoot: string): Promise<SsrModule<T>> {
  const compiled = await build({
    stdin: {
      contents: [
        `export * from ${JSON.stringify(`./${entryFromPackageRoot}`)};`,
        `export { h } from "preact";`,
        `export { default as renderToString } from "preact-render-to-string";`,
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
    // @takazudo/zfb's Island is JSX-runtime-agnostic but imports
    // react/jsx-runtime; zfb's own build aliases React to preact the same way.
    alias: { "react/jsx-runtime": "preact/jsx-runtime", react: "preact/compat" },
  });
  const source = compiled.outputFiles[0]?.text;
  if (source === undefined) throw new Error(`esbuild produced no output for ${entryFromPackageRoot}`);
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)) as SsrModule<T>;
}
