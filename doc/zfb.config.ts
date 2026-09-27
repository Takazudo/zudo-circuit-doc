import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    siteName: "zudo-circuit-doc",
    siteUrl: "https://zudo-circuit-doc.zudolab.dev",
    sitemap: true,
    themePacks: ["default"],
    llmsTxt: true,
    cjkFriendly: true,
    dynamicPageTransition: true,
    docHistory: true,
    changelogs: [
      {
        sourceDir: "src/content/docs/changelog/zudo-circuit-doc",
        outputFile: "../packages/circuit-doc/CHANGELOG.md",
        packageName: "@takazudo/zudo-circuit-doc",
      },
      {
        sourceDir: "src/content/docs/changelog/create-zudo-circuit-doc",
        outputFile: "../packages/create-zudo-circuit-doc/CHANGELOG.md",
        packageName: "create-zudo-circuit-doc",
      },
    ],
    headerNav: [
      {
        label: "Getting Started",
        path: "/docs/getting-started",
        categoryMatch: "getting-started",
      },
      {
        label: "Concepts",
        path: "/docs/concepts",
        categoryMatch: "concepts",
      },
      {
        label: "Workflows",
        path: "/docs/workflows",
        categoryMatch: "workflows",
      },
      {
        label: "Reference",
        path: "/docs/reference",
        categoryMatch: "reference",
      },
      {
        label: "Design",
        path: "/docs/design",
        categoryMatch: "design",
      },
      {
        label: "Release",
        path: "/docs/release",
        categoryMatch: "release",
      },
      {
        label: "Changelog",
        path: "/docs/changelog",
        categoryMatch: "changelog",
      },
    ],
    headerRightItems: [
      { type: "component", component: "theme-toggle" },
      { type: "component", component: "search" },
    ],
  }),
);
