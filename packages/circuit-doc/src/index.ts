// Bootstrap placeholder (#2), extended with the core's public API (#5). The
// root barrel is edited only along the dependency chain #5 (core) -> #11
// (provider) -> #16 (validator runner, the last editor); every other
// sub-issue exposes its API through its own exports subpath.
export const CIRCUIT_DOC_PACKAGE_NAME = "@takazudo/zudo-circuit-doc";

export * from "./core/errors.ts";
export * from "./core/text.ts";
export * from "./core/url.ts";
export * from "./core/ids.ts";
export * from "./core/mdx.ts";
export * from "./core/page.ts";
export * from "./core/links.ts";
export * from "./core/emit.ts";
export * from "./core/publication.ts";
export * from "./core/view-model.ts";
export * from "./core/adapter.ts";
export * from "./core/pipeline.ts";
export * from "./core/scan.ts";
export * from "./core/model-descriptor.ts";
export * from "./core/reference-descriptor.ts";
export * from "./core/render/shared.ts";
export * from "./core/render/catalog.ts";
export * from "./core/render/integration.ts";
export * from "./core/render/landing.ts";
export * from "./core/render/record.ts";

// v1 evidence provider (#11).
export * from "./provider/v1/paths.ts";
export * from "./provider/v1/read.ts";
export * from "./provider/v1/evidence.ts";
export * from "./provider/v1/integration.ts";
export * from "./provider/v1/matrix.ts";
export * from "./provider/v1/references.ts";
export * from "./provider/v1/validate.ts";
export * from "./provider/v1/canaries.ts";
export * from "./provider/v1/model-assets.ts";
export * from "./provider/v1/index.ts";

// The canonical validator runner: config transport + packaged Python discovery (#16).
export * from "./validate/resolved-config.ts";
export * from "./validate/python.ts";
export * from "./validate/runner.ts";
