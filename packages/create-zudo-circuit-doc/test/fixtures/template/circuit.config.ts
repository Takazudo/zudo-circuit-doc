import type { CircuitConfig } from "@takazudo/zudo-circuit-doc/config";

export default {
  configVersion: 1,
  project: { name: "__PROJECT_NAME__", title: "__SITE_TITLE__" },
  cad: { enabled: false, libraryName: "__LIBRARY_NAME__" },
} satisfies CircuitConfig;
