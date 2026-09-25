/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Self-contained doc-route stub — required for `pnpm dev` / `pnpm build` to
// serve /docs/*. See @takazudo/zudo-doc's own generated project scaffold for
// the sanctioned entrypoints this stub is built from; do not fork a route
// stub for presentational customization — use src/chrome-bindings.tsx instead.

import type { JSX } from "preact";
import { routeContext } from "virtual:zudo-doc-route-context";
import {
  createRouteContext,
  type RouteContextPayload,
} from "@takazudo/zudo-doc/route-context";
import { createChrome } from "@takazudo/zudo-doc/chrome";
import { DocHistory } from "@takazudo/zudo-doc/doc-history";
import { defineChromeBindings } from "@takazudo/zudo-doc/chrome-bindings";
import { chromeBindings } from "virtual:zudo-doc-chrome-bindings";

const ctx = routeContext as unknown as RouteContextPayload;
const routeCtx = createRouteContext(ctx);
const { renderDocPage } = createChrome(routeCtx, {
  ...chromeBindings,
  ...defineChromeBindings({ DocHistory }),
});

export const frontmatter = { title: "Docs" };

export function paths(): Array<{ params: { slug: string[] }; props: unknown }> {
  const locale = routeCtx.defaultLocale;
  const source = routeCtx.resolveNavSource(locale, undefined);
  return routeCtx
    .buildDocRouteEntries({
      source,
      locale,
      routeSig: `docs;${locale}`,
    })
    .map((item) => ({
      params: { slug: item.slugParams },
      props: item.props,
    }));
}

type PageArgs = { params: { slug: string[] } } & Record<string, unknown>;

export default function DocsPage(props: PageArgs): JSX.Element {
  return renderDocPage(props as never, {
    locale: routeCtx.defaultLocale,
    docHistoryContentDir: routeCtx.settings.docsDir,
  });
}
