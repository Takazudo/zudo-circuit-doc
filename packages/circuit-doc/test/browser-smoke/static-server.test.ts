/** The `node:http` static server `check-browser` serves `--dist` from. */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { serveStaticSite, type StaticSite } from "../../src/browser-smoke/static-server.ts";

describe("serveStaticSite", () => {
  let scratch = "";
  let site: StaticSite;

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), "zcd-static-server-"));
    await mkdir(join(scratch, "docs", "components"), { recursive: true });
    await writeFile(join(scratch, "index.html"), "<html><body>root</body></html>");
    await writeFile(join(scratch, "docs", "components", "index.html"), "<html><body>components</body></html>");
    await writeFile(join(scratch, "search-index.json"), "[]");
    await writeFile(join(scratch, "model.wrl"), "#VRML V2.0 utf8\n");
    site = await serveStaticSite(scratch);
  });

  after(async () => {
    await site.close();
    await rm(scratch, { recursive: true, force: true });
  });

  it("serves index.html for a directory route", async () => {
    const response = await fetch(new URL("/docs/components/", site.origin));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/u);
    assert.match(await response.text(), /components/u);
  });

  it("serves index.html for the root route", async () => {
    const response = await fetch(new URL("/", site.origin));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /root/u);
  });

  it("maps file extensions to the right content type", async () => {
    const json = await fetch(new URL("/search-index.json", site.origin));
    assert.match(json.headers.get("content-type") ?? "", /application\/json/u);
    const wrl = await fetch(new URL("/model.wrl", site.origin));
    assert.match(wrl.headers.get("content-type") ?? "", /model\/vrml/u);
  });

  it("404s a route with no matching file", async () => {
    const response = await fetch(new URL("/does/not/exist/", site.origin));
    assert.equal(response.status, 404);
  });

  it("refuses a path-traversal request rather than serving a file outside dist", async () => {
    const response = await fetch(new URL("/..%2f..%2fpackage.json", site.origin));
    assert.equal(response.status, 404);
  });
});
