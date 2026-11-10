// Shotlane client for Node 18+ (and Deno, Bun, edge runtimes). One file, no dependencies.
//
//   import { Shotlane } from "./shotlane.mjs";
//   const s = new Shotlane(process.env.SHOTLANE_API_KEY);
//   await fs.promises.writeFile("page.png", await s.screenshot("https://example.com", { full_page: true }));
//   console.log(await s.markdown("https://react.dev/learn"));
//
// Every option is passed through as an API parameter; see https://shotlane.dev/docs.
import { createHmac, timingSafeEqual } from "node:crypto";

export const VERSION = "1.2.0";

export class ShotlaneError extends Error {
  constructor(status, message, headers) {
    super(`HTTP ${status}: ${message}`);
    this.status = status; this.headers = headers;
  }
}

export class Shotlane {
  constructor(apiKey, { baseUrl = "https://shotlane.dev", timeoutMs = 120000 } = {}) {
    this.apiKey = apiKey; this.baseUrl = baseUrl.replace(/\/$/, ""); this.timeoutMs = timeoutMs; this.lastHeaders = null;
  }

  async #request(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "User-Agent": `shotlane-node/${VERSION}`,
                 ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    this.lastHeaders = res.headers;
    const type = res.headers.get("content-type") || "";
    if (!res.ok) {
      const text = await res.text();
      let msg = text; try { msg = JSON.parse(text).error ?? text; } catch {}
      throw new ShotlaneError(res.status, msg, res.headers);
    }
    if (type.startsWith("application/json")) return res.json();
    if (type.startsWith("text/")) return res.text();
    return Buffer.from(await res.arrayBuffer());
  }

  #render(path, input, opts = {}) {
    const src = typeof input === "string" ? { url: input } : (input || {});
    return this.#request("POST", path, { ...src, ...opts });
  }

  // input: a URL string, or { url } / { html } / { markdown }
  screenshot(input, opts) { return this.#render("/v1/screenshot", input, opts); }
  pdf(input, opts) { return this.#render("/v1/pdf", input, opts); }
  markdown(input, opts) { return this.#render("/v1/markdown", input, opts); }
  extract(input, opts) { return this.#render("/v1/extract", input, opts); }
  screenshots(input, devices = ["desktop", "iphone"], opts = {}) { return this.#render("/v1/screenshots", input, { devices, ...opts }); }
  // a scrolling video of the page: MP4 Buffer by default ({ format: "webm" | "gif", duration: 1-15 }), 3 paid credits
  animate(input, opts) { return this.#render("/v1/animate", input, opts); }
  // does the page look right? { issues, shots: [{ device, url, issues: [...], diagnostics }] }, 1 credit per device
  check(input, devices = ["iphone", "ipad", "desktop"], opts = {}) { return this.#render("/v1/check", input, { devices, ...opts }); }
  report(url) { return this.#request("POST", "/v1/report", { url }); }
  map(url, opts = {}) { return this.#request("POST", "/v1/map", { url, ...opts }); }
  scrape(input, elements, opts = {}) { return this.#render("/v1/scrape", input, { elements, ...opts }); }
  account() { return this.#request("GET", "/v1/account"); }
  usage() { return this.#request("GET", "/v1/usage"); }
  devices() { return this.#request("GET", "/v1/devices"); }
  renderStatus(id) { return this.#request("GET", `/v1/renders/${id}`); }
  // async=true render; with { wait: true } (default) polls until done; the result link is job.url
  async renderAsync(input, { endpoint = "/v1/screenshot", wait = true, pollMs = 2000, timeoutMs = 300000, ...opts } = {}) {
    let job = await this.#render(endpoint, input, { ...opts, async: "true" });
    const deadline = Date.now() + timeoutMs;
    while (wait && job.status === "processing" && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollMs));
      job = await this.renderStatus(job.id);
    }
    return job;
  }

  async #wait(path, { pollMs = 3000, timeoutMs = 1800000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.#request("GET", path);
      if (job.status !== "running" || Date.now() > deadline) return job;
      await new Promise(r => setTimeout(r, pollMs));
    }
  }
  async crawl(url, { wait = true, ...opts } = {}) {
    const job = await this.#request("POST", "/v1/crawl", { url, ...opts });
    return wait ? this.#wait(`/v1/crawl/${job.id}`) : job;
  }
  async bulk(urls, mode = "png", { wait = true, ...opts } = {}) {
    const job = await this.#request("POST", "/v1/bulk", { urls, mode, ...opts });
    return wait ? this.#wait(`/v1/bulk/${job.id}`) : job;
  }
  async jobs() { return (await this.#request("GET", "/v1/bulk")).jobs; }  // the 10 most recent bulk and crawl jobs
  bulkJob(id) { return this.#request("GET", `/v1/bulk/${id}`); }
  crawlJob(id) { return this.#request("GET", `/v1/crawl/${id}`); }
  jobZip(job) { return this.#request("GET", new URL(job.zip_url).pathname); }

  createMonitor(url, { kind = "screenshot", interval = "daily", ...opts } = {}) {
    return this.#request("POST", "/v1/monitors", { url, kind, interval, ...opts });
  }
  async monitors() { return (await this.#request("GET", "/v1/monitors")).monitors; }
  monitor(id) { return this.#request("GET", `/v1/monitors/${id}`); }
  updateMonitor(id, fields) { return this.#request("POST", `/v1/monitors/${id}`, fields); }
  checkMonitor(id) { return this.#request("POST", `/v1/monitors/${id}/check`); }
  deleteMonitor(id) { return this.#request("DELETE", `/v1/monitors/${id}`); }
}

// A signed URL for <img> tags: no secret in the page. The public key is on your dashboard.
// The signature covers the endpoint path and the sorted query; only GET render endpoints accept it.
export function signUrl(params, publicKey, signingSecret, { endpoint = "/v1/screenshot", baseUrl = "https://shotlane.dev" } = {}) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
  const sig = createHmac("sha256", signingSecret).update(`${endpoint}?${query}`).digest("hex");
  return `${baseUrl.replace(/\/$/, "")}${endpoint}?${query}&key=${publicKey}&signature=${sig}`;
}

// True if a bulk/crawl/monitor webhook really came from Shotlane (X-Shotlane-Signature header). rawBody: Buffer or string.
export function verifyWebhook(rawBody, signatureHeader, signingSecret) {
  const expected = Buffer.from("sha256=" + createHmac("sha256", signingSecret).update(rawBody).digest("hex"));
  const got = Buffer.from(signatureHeader || "");
  return expected.length === got.length && timingSafeEqual(expected, got);
}
