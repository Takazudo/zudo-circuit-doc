import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    siteName: "App",
    chromeBindingsModule: "./src/chrome-bindings.tsx",
    llmsTxt: true,
    sidebarResizer: true,
    sidebarToggle: true,
    tocToggle: true,
    imageEnlarge: true,
    dynamicPageTransition: true,
    docHistory: true,
    assetViewer: true,
    footer: {
      links: [],
      copyright: "Copyright © 2026 Your Name. Built with zudo-doc.",
    },
    headerNav: [
      {
        label: "Getting Started",
        path: "/docs/getting-started",
        categoryMatch: "getting-started",
      },
    ],
    headerRightItems: [
      {
        type: "component",
        component: "theme-toggle",
      },
      {
        type: "component",
        component: "search",
      },
    ],
  }),
);
