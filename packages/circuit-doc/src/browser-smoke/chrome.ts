/**
 * System Chrome discovery and lifecycle (ADR-017): headless, sandboxed by
 * `--no-sandbox` (containers/CI never have user namespaces for the real
 * sandbox), driven purely over CDP — no Playwright/puppeteer dependency.
 */

import { type ChildProcessByStdio, spawn } from "node:child_process";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { Readable } from "node:stream";

import { connectCdp, delay, type CdpClient } from "./cdp.ts";

type ChromeProcess = ChildProcessByStdio<null, null, Readable>;

/** Names tried, in order, when `--chrome`/`CHROME_BIN` is not given. */
export const CHROME_CANDIDATE_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] as const;

/** `PATH` lookup against the given environment (not the parent process's). */
export async function which(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the Chrome binary to launch: `--chrome`, then `CHROME_BIN`, then the
 * first of `CHROME_CANDIDATE_NAMES` found on `PATH`. `null` means "not found",
 * which the CLI turns into exit 4 rather than a failed check — an optional
 * tool missing is not the same as the site failing a check.
 */
export async function findChromeBinary(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (explicit !== undefined) return (await isExecutable(explicit)) ? explicit : null;
  const configured = env.CHROME_BIN;
  if (configured !== undefined && configured !== "") return (await isExecutable(configured)) ? configured : null;
  for (const candidate of CHROME_CANDIDATE_NAMES) {
    const found = await which(candidate, env);
    if (found !== null) return found;
  }
  return null;
}

export type ChromeSession = {
  readonly cdp: CdpClient;
  readonly close: () => Promise<void>;
};

/** Launches headless Chrome, connects CDP to its one page target, and returns a client plus teardown. */
export async function launchChrome(bin: string): Promise<ChromeSession> {
  const profile = await mkdtemp(join(tmpdir(), "zcd-browser-smoke-chrome-"));
  const chrome = spawn(
    bin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--enable-unsafe-swiftshader",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let cdp: CdpClient | undefined;
  try {
    const debuggingPort = await readDebuggingPort(chrome);
    chrome.stderr.resume();
    const targets = (await waitForJson(`http://127.0.0.1:${debuggingPort}/json/list`)) as ReadonlyArray<{
      type: string;
      webSocketDebuggerUrl?: string;
    }>;
    const page = targets.find((target) => target.type === "page");
    if (page?.webSocketDebuggerUrl === undefined) throw new Error("Chrome page target was not available");
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    // Background rAF/timer throttling in headless made the idle assertion flaky; this matches the legacy zudo-pd harness (#108).
    await cdp.send("Page.bringToFront");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
  } catch (error) {
    await teardown(chrome, profile, cdp);
    throw error;
  }

  return {
    cdp,
    close: () => teardown(chrome, profile, cdp),
  };
}

async function teardown(chrome: ChromeProcess, profile: string, cdp: CdpClient | undefined): Promise<void> {
  cdp?.close();
  chrome.kill("SIGTERM");
  await waitForExit(chrome);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function waitForExit(child: ChromeProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

async function readDebuggingPort(chrome: ChromeProcess): Promise<number> {
  // Listen with 'data' rather than `for await`: breaking out of an async
  // iterator destroys the stream, leaving Chrome writing into a closed pipe.
  return new Promise<number>((resolvePort, rejectPort) => {
    let stderr = "";
    const onData = (chunk: unknown): void => {
      stderr += String(chunk);
      const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//u.exec(stderr);
      if (match !== null) {
        cleanup();
        resolvePort(Number(match[1]));
        return;
      }
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    };
    const onEnd = (): void => {
      cleanup();
      rejectPort(new Error(`Chrome exited before opening DevTools: ${stderr.slice(-2000)}`));
    };
    const cleanup = (): void => {
      chrome.stderr.off("data", onData);
      chrome.stderr.off("end", onEnd);
    };
    chrome.stderr.on("data", onData);
    chrome.stderr.on("end", onEnd);
  });
}

async function waitForJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome's debugging endpoint is not listening yet; keep polling.
    }
    await delay(50);
  }
  throw new Error(`Timed out fetching ${url}`);
}
