import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    siteName: "zudo-circuit-doc",
    themePacks: ["default"],
    llmsTxt: true,
    cjkFriendly: true,
    dynamicPageTransition: true,
    docHistory: true,
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
    ],
    headerRightItems: [
      { type: "component", component: "theme-toggle" },
      { type: "component", component: "search" },
    ],
  }),
);
