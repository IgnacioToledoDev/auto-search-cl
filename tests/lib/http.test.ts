import { describe, expect, it, vi } from "vitest";
import { HttpError, htmlFetch } from "../../src/lib/http.ts";

function res(status: number, body = ""): Response {
  return new Response(body, { status });
}

function setup(responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const sleep = vi.fn(async (ms: number) => {
    sleeps.push(ms);
  });
  return { fetchFn, sleep, sleeps };
}

describe("htmlFetch", () => {
  it("returns body text on 200 with browser-like UA and a timeout signal", async () => {
    const { fetchFn, sleep } = setup([res(200, "<html>ok</html>")]);
    const text = await htmlFetch("https://x.cl/a", { fetch: fetchFn, sleep });
    expect(text).toBe("<html>ok</html>");
    const init = fetchFn.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/Mozilla\/5\.0/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries on 429 and 5xx then succeeds", async () => {
    const { fetchFn, sleep } = setup([res(429), res(503), res(200, "done")]);
    expect(await htmlFetch("https://x.cl", { fetch: fetchFn, sleep, random: () => 0 })).toBe("done");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff from 500ms capped at 5s (plus jitter)", async () => {
    const { fetchFn, sleep, sleeps } = setup(Array.from({ length: 7 }, () => res(500)));
    await expect(htmlFetch("https://x.cl", { fetch: fetchFn, sleep, random: () => 0 })).rejects.toBeInstanceOf(HttpError);
    expect(sleeps).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
  });

  it("adds jitter on top of the delay, bounded", async () => {
    const { fetchFn, sleep, sleeps } = setup([res(500), res(200, "ok")]);
    await htmlFetch("https://x.cl", { fetch: fetchFn, sleep, random: () => 0.5 });
    expect(sleeps[0]).toBeGreaterThan(500);
    expect(sleeps[0]).toBeLessThanOrEqual(500 + 250);
  });

  it("gives up after 6 retries (7 attempts) with HttpError carrying status", async () => {
    const { fetchFn, sleep } = setup(Array.from({ length: 7 }, () => res(502)));
    const err = await htmlFetch("https://x.cl", { fetch: fetchFn, sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(502);
    expect(fetchFn).toHaveBeenCalledTimes(7);
  });

  it("fails immediately on plain 4xx without retry", async () => {
    const { fetchFn, sleep } = setup([res(404)]);
    const err = await htmlFetch("https://x.cl", { fetch: fetchFn, sleep }).catch((e) => e);
    expect((err as HttpError).status).toBe(404);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries network errors and timeouts", async () => {
    const { fetchFn, sleep } = setup([new TypeError("fetch failed"), res(200, "ok")]);
    expect(await htmlFetch("https://x.cl", { fetch: fetchFn, sleep })).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rethrows the last network error when retries are exhausted", async () => {
    const { fetchFn, sleep } = setup(Array.from({ length: 3 }, () => new TypeError("fetch failed")));
    await expect(htmlFetch("https://x.cl", { fetch: fetchFn, sleep, retries: 2 })).rejects.toThrow("fetch failed");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("honors custom headers and retries option", async () => {
    const { fetchFn, sleep } = setup([res(500), res(500)]);
    await htmlFetch("https://x.cl", { fetch: fetchFn, sleep, retries: 1, headers: { Accept: "text/html" } }).catch(() => {});
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const init = fetchFn.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["Accept"]).toBe("text/html");
  });
});
