import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { launchChrome } from "../../src/browser-smoke/chrome.ts";

const fakeChromeSource = String.raw`#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { appendFileSync, readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { join } = require("node:path");

const logPath = join(__dirname, "fake-chrome.log");
const modePath = join(__dirname, "mode");
appendFileSync(logPath, JSON.stringify(process.argv.slice(2)) + "\n");

function frame(payload, opcode = 0x1) {
  const body = Buffer.from(payload);
  if (body.length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]);
  const header = Buffer.alloc(4);
  header[0] = 0x80 | opcode;
  header[1] = 126;
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

const server = createServer((request, response) => {
  if (request.url === "/json/list") {
    const port = server.address().port;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([{
      type: "page",
      webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/page/1",
    }]));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.on("upgrade", (request, socket, head) => {
  const mode = readFileSync(modePath, "utf8").trim();
  if (mode === "refuse-ws") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n",
  );

  let input = Buffer.alloc(0);
  const consume = (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 2) {
      const first = input[0];
      const second = input[1];
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (input.length < 4) return;
        length = input.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (input.length < 10) return;
        const extendedLength = input.readBigUInt64BE(2);
        if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          socket.destroy();
          return;
        }
        length = Number(extendedLength);
        offset = 10;
      }
      const mask = masked ? input.subarray(offset, offset + 4) : undefined;
      if (masked) offset += 4;
      if (input.length < offset + length) return;
      const payload = Buffer.from(input.subarray(offset, offset + length));
      input = input.subarray(offset + length);
      if (mask !== undefined) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      const opcode = first & 0x0f;
      if (opcode === 0x8) {
        socket.write(frame(payload, 0x8));
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        socket.write(frame(payload, 0xa));
        continue;
      }
      if (opcode !== 0x1) continue;
      const message = JSON.parse(payload.toString("utf8"));
      appendFileSync(logPath, message.method + "\n");
      socket.write(frame(JSON.stringify({ id: message.id, result: {} })));
    }
  };
  socket.on("data", consume);
  if (head.length > 0) consume(head);
});

server.listen(0, "127.0.0.1", () => {
  process.stderr.write("DevTools listening on ws://127.0.0.1:" + server.address().port + "/devtools/browser/fake\n");
});

process.on("SIGTERM", () => {
  appendFileSync(logPath, "SIGTERM\n");
  process.exit(0);
});
`;

describe("launchChrome", () => {
  let scratch = "";
  let fakeChrome = "";
  let logPath = "";
  let modePath = "";

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "zcd-fake-chrome-"));
    fakeChrome = join(scratch, "fake-chrome");
    logPath = join(scratch, "fake-chrome.log");
    modePath = join(scratch, "mode");
    await writeFile(fakeChrome, fakeChromeSource, { mode: 0o755 });
    await chmod(fakeChrome, 0o755);
    await writeFile(modePath, "normal\n");
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
    scratch = "";
  });

  async function logLines(): Promise<string[]> {
    return (await readFile(logPath, "utf8")).trimEnd().split("\n");
  }

  async function assertRemoved(path: string): Promise<void> {
    await assert.rejects(access(path), { code: "ENOENT" });
  }

  function profileFromArgs(argv: string[]): string {
    const flag = argv.find((argument) => argument.startsWith("--user-data-dir="));
    assert.ok(flag, "fake Chrome should receive --user-data-dir");
    return flag.slice("--user-data-dir=".length);
  }

  it("passes the required Chrome flags", { timeout: 15_000 }, async () => {
    const session = await launchChrome(fakeChrome);
    try {
      const [argvLine] = await logLines();
      assert.ok(argvLine);
      const argv = JSON.parse(argvLine) as string[];
      for (const flag of [
        "--headless=new",
        "--no-sandbox",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--remote-debugging-port=0",
      ]) {
        assert.ok(argv.includes(flag), `expected ${flag} in Chrome arguments`);
      }
      assert.ok(argv.some((argument) => argument.startsWith("--user-data-dir=")));
    } finally {
      await session.close();
    }
  });

  it("enables Page, brings it to the front, then enables Runtime and Network", { timeout: 15_000 }, async () => {
    const session = await launchChrome(fakeChrome);
    try {
      const lines = await logLines();
      assert.deepEqual(lines.slice(1), ["Page.enable", "Page.bringToFront", "Runtime.enable", "Network.enable"]);
    } finally {
      await session.close();
    }
  });

  it("terminates Chrome and removes its profile after close", { timeout: 15_000 }, async () => {
    const session = await launchChrome(fakeChrome);
    try {
      const [argvLine] = await logLines();
      assert.ok(argvLine);
      const profile = profileFromArgs(JSON.parse(argvLine) as string[]);

      await session.close();

      const lines = await logLines();
      assert.ok(lines.includes("SIGTERM"));
      await assertRemoved(profile);
    } finally {
      await session.close();
    }
  });

  it("terminates Chrome and removes its profile when the WebSocket connection fails", { timeout: 15_000 }, async () => {
    await writeFile(modePath, "refuse-ws\n");

    await assert.rejects(launchChrome(fakeChrome), /could not connect/u);

    const lines = await logLines();
    assert.ok(lines.includes("SIGTERM"));
    const [argvLine] = lines;
    assert.ok(argvLine);
    await assertRemoved(profileFromArgs(JSON.parse(argvLine) as string[]));
  });
});
