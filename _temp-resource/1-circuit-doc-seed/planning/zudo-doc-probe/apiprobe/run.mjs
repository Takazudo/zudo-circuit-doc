import { createZudoDoc } from "create-zudo-doc";
import fs from "node:fs";
const staging = process.argv[2];
fs.mkdirSync(staging, { recursive: true });
process.chdir(staging);
const t = Date.now();
const dir = await createZudoDoc({
  projectName: "api-app",
  defaultLang: "en",
  colorSchemeMode: "light-dark",
  lightScheme: "Default Light", darkScheme: "Default Dark", defaultMode: "dark", respectPrefersColorScheme: true,
  themePack: "default",
  features: ["search","sidebarFilter","sidebarResizer","sidebarToggle","tocToggle","docHistory","llmsTxt","imageEnlarge","assetViewer","dynamicPageTransition","footerCopyright"],
  packageManager: "pnpm",
});
console.log("created", dir, Date.now()-t, "ms");
