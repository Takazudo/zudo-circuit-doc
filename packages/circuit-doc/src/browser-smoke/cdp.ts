/**
 * A minimal Chrome DevTools Protocol client over Node's global `WebSocket`
 * (ADR-017): no Playwright/puppeteer dependency, one JSON-RPC request per
 * `send()`, matched back to its caller by `id`.
 */

import { assertEqual } from "./assertions.ts";

export type CdpClient = {
  readonly send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  readonly close: () => void;
};

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function connectCdp(url: string): Promise<CdpClient> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error(`could not connect to ${url}`)), { once: true });
  });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; method: string }>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
    };
    if (message.id === undefined) return;
    const callbacks = pending.get(message.id);
    if (callbacks === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) callbacks.reject(new Error(`${callbacks.method}: ${message.error.message}`));
    else callbacks.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const id = (nextId += 1);
      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { resolve: resolveSend, reject: rejectSend, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

export async function evaluate(cdp: CdpClient, expression: string): Promise<unknown> {
  const result = (await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as { exceptionDetails?: { exception?: { description?: string }; text: string }; result: { value: unknown } };
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

export async function waitFor(cdp: CdpClient, expression: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

export async function setViewportAndMedia(
  cdp: CdpClient,
  width: number,
  theme: "light" | "dark",
  reducedMotion: boolean,
  height = 900,
  deviceScaleFactor = 1,
): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" },
    ],
  });
}

export async function navigate(cdp: CdpClient, origin: string, path: string): Promise<void> {
  const target = new URL(path, origin);
  await cdp.send("Page.navigate", { url: target.href });
  await waitFor(
    cdp,
    `location.pathname === ${JSON.stringify(target.pathname)} && location.search === ${JSON.stringify(target.search)}`,
  );
  await waitFor(cdp, `document.readyState === 'complete'`);
}

/** Forces the document's own theme attribute; distinct from `setViewportAndMedia`'s system-appearance emulation. */
export async function setDocumentTheme(cdp: CdpClient, theme: "light" | "dark"): Promise<void> {
  await evaluate(
    cdp,
    `(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      document.documentElement.style.colorScheme = ${JSON.stringify(theme)};
    })()`,
  );
  assertEqual(await evaluate(cdp, `document.documentElement.dataset.theme`), theme, `${theme} theme marker`);
  assertEqual(
    await evaluate(cdp, `matchMedia('(prefers-color-scheme: ${theme})').matches`),
    true,
    `${theme} color-scheme media`,
  );
}
