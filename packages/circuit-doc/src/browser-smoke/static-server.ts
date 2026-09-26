/**
 * The `node:http` static file server `check-browser` serves the built site
 * from — no dev server, no framework, just enough to let Chrome load the
 * project's own `--dist` (ADR-017 point 1).
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".wrl", "model/vrml"],
  [".wasm", "application/wasm"],
  [".txt", "text/plain; charset=utf-8"],
]);

export type StaticSite = {
  readonly origin: string;
  readonly close: () => Promise<void>;
};

/** Serves `distRoot` on `127.0.0.1` at an OS-assigned free port. */
export async function serveStaticSite(distRoot: string): Promise<StaticSite> {
  const root = resolve(distRoot);
  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/u, "");
        let file = resolve(root, relative);
        if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error("path traversal");
        if (url.pathname.endsWith("/") || extname(file) === "") file = join(file, "index.html");
        const bytes = await readFile(file);
        response.writeHead(200, { "content-type": MIME.get(extname(file)) ?? "application/octet-stream" });
        response.end(bytes);
      } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
      }
    })();
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("browser-smoke static server did not bind TCP");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
