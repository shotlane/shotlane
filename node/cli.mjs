#!/usr/bin/env node
// The shotlane command: screenshots, PDFs, Markdown and page checks from a terminal. No dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Shotlane, ShotlaneError, VERSION } from "./shotlane.mjs";

const BASE = (process.env.SHOTLANE_BASE_URL || "https://shotlane.dev").replace(/\/$/, "");

const HELP = `shotlane ${VERSION}: a real browser in your terminal

  shotlane shot <url|file>     Screenshot, saved as <host>.png
  shotlane pdf <url|file>      PDF, saved as <host>.pdf
  shotlane md <url>            The page as Markdown, printed
  shotlane check <url>         Phone, tablet and desktop, with the problems on each
  shotlane credits             Credits left
  shotlane login               Save your API key
  shotlane logout              Forget it

Options:
  -o, --output <file>          Where to save; - prints it
  --json                       check and credits: the API's JSON
  --<option> [value]           Any API option: --full-page, --device iphone, --format webp,
                               --devices iphone,desktop (check). See ${BASE}/docs

<file> is HTML or Markdown on disk; - reads HTML from stdin.
The key comes from SHOTLANE_API_KEY or shotlane login. Without one, md and shot work on
plain URLs a few times a day. Free key: ${BASE}/signup
check exits 1 if it finds problems.`;

export class UsageError extends Error {}

// a word that is the page rather than an option's value: a URL, a host name, a path or "-"
const looksLikeInput = (w) => w === "-" || /:\/\/|[./\\]/.test(w) || fs.existsSync(w);

// --name value, --name=value, or a bare --name (true) when another option or nothing follows. No list of the API's
// options: when a bare flag before the input took the input as its value (shot --full-page example.com), it gets it back.
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const out = { cmd: cmd === "-h" || cmd === "--help" ? "help" : cmd, input: undefined, output: undefined, json: false, opts: {} };
  const took = [];  // options that took the following word as their value
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-o" || a === "--output") {
      if (rest[i + 1] === undefined) throw new UsageError(`${a} needs a file name`);
      out.output = rest[++i];
    } else if (a.startsWith("--output=")) out.output = a.slice(9);
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") out.cmd = "help";
    else if (a.startsWith("--")) {
      let [name, value] = a.slice(2).split(/=(.*)/s);
      name = name.replace(/-/g, "_");
      if (value === undefined) {
        const next = rest[i + 1];
        if (next === undefined || (next.startsWith("-") && next !== "-")) value = "true";
        else {
          value = rest[++i];
          took.push(name);
        }
      }
      out.opts[name] = value;
    } else if (out.input === undefined) out.input = a;
    else throw new UsageError(`unexpected argument: ${a}`);
  }
  if (out.input === undefined) {
    const name = took.findLast((n) => looksLikeInput(out.opts[n]));
    if (name) [out.input, out.opts[name]] = [out.opts[name], "true"];
  }
  return out;
}

export function configPath(env = process.env, platform = process.platform) {
  const dir =
    platform === "win32" && env.APPDATA ? env.APPDATA : env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(dir, "shotlane", "config.json");
}

function savedKey() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")).api_key || "";
  } catch {
    return "";
  }
}

// a URL (https:// added when missing), an HTML or Markdown file, or HTML from stdin ("-")
export function resolveInput(arg, { md = false, check = false } = {}) {
  if (!arg) throw new UsageError("give a URL or a file, before the options");
  if (arg === "-") return { html: fs.readFileSync(0, "utf8") };
  const markdown = /\.(md|markdown)$/i.test(arg);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) && fs.existsSync(arg) && fs.statSync(arg).isFile()) {
    if (markdown && check) throw new UsageError("check takes a URL or an HTML file");
    const text = fs.readFileSync(arg, "utf8");
    return markdown && !md ? { markdown: text } : { html: text };
  }
  if (markdown || /\.html?$/i.test(arg)) throw new UsageError(`no such file: ${arg}`);  // a typo, not a host
  return { url: /^[a-z][a-z0-9+.-]*:\/\//i.test(arg) ? arg : `https://${arg}` };
}

export function defaultName(arg, ext) {
  if (arg === "-") return `page.${ext}`;
  if (!/^https?:\/\//i.test(arg) && fs.existsSync(arg)) return `${path.basename(arg).replace(/\.[^.]+$/, "")}.${ext}`;
  try {
    return `${new URL(/:\/\//.test(arg) ? arg : `https://${arg}`).hostname || "page"}.${ext}`;
  } catch {
    return `page.${ext}`;
  }
}

const err = (s) => process.stderr.write(s + "\n");

function size(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function left(headers) {
  const n = headers?.get?.("x-credits-remaining");
  return n == null ? "" : `, ${n} credits left`;
}

// a file, stdout (-o -), or JSON when the options made the API answer with JSON (e.g. --response-type json)
function emit(result, args, ext, headers) {
  if (!Buffer.isBuffer(result) && typeof result !== "string") {
    result = JSON.stringify(result, null, 2) + "\n";
    if (args.output === undefined) return void process.stdout.write(result);
    ext = "json";
  }
  const file = args.output ?? defaultName(args.input, ext);
  if (file === "-") {
    process.stdout.write(result);
    return;
  }
  fs.writeFileSync(file, result);
  err(`Saved ${file} (${size(Buffer.byteLength(result))}${left(headers)})`);
}

// no key: the keyless /md/ and /shot/ links (a few a day per network, plain URLs only)
async function keyless(kind, args) {
  const src = resolveInput(args.input);
  if (!src.url || Object.keys(args.opts).length)
    throw new UsageError(`without a key, ${kind} takes a plain URL and no options. Run shotlane login (free key: ${BASE}/signup)`);
  const res = await fetch(`${BASE}/${kind === "md" ? "md" : "shot"}/${encodeURIComponent(src.url)}`, {
    headers: { "User-Agent": `shotlane-cli/${VERSION}` },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new ShotlaneError(res.status, (await res.text()).trim(), res.headers);
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining != null) err(`${remaining} keyless requests left today. Free key: ${BASE}/signup`);
  return kind === "md" ? res.text() : Buffer.from(await res.arrayBuffer());
}

async function prompt(question) {
  if (!process.stdin.isTTY) return fs.readFileSync(0, "utf8").trim();  // echo $KEY | shotlane login
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let asked = false;
  rl._writeToOutput = (s) => {  // the key isn't echoed
    if (!asked) rl.output.write(s);
    asked = true;
  };
  try {
    return (await new Promise((resolve) => rl.question(question, resolve))).trim();
  } finally {
    rl.output.write("\n");
    rl.close();
  }
}

const ENV_WINS = "SHOTLANE_API_KEY is set in this shell, and commands use it instead of the saved key.";

async function login() {
  err(`Your API key is on ${BASE}/dashboard (free account: ${BASE}/signup).`);
  const key = await prompt("API key: ");
  if (!key) throw new UsageError("no key given");
  let acct;
  try {
    acct = await new Shotlane(key, { baseUrl: BASE }).account();
  } catch (e) {
    if (e instanceof ShotlaneError && e.status === 401) throw new UsageError(`that key isn't valid. Copy it from ${BASE}/dashboard`);
    throw e;
  }
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ api_key: key }) + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  err(`Logged in as ${acct.email} (${acct.credits} credits). Key saved in ${file}`);
  if (process.env.SHOTLANE_API_KEY) err(ENV_WINS);
}

function printCheck(body) {
  let problems = 0;
  for (const s of body.shots || []) {
    if (!s.ok) {
      problems++;
      console.log(`${s.device}: failed: ${s.error}`);
      continue;
    }
    const issues = s.issues || [];
    problems += issues.length;
    console.log(`${s.device}: ${issues.length ? `${issues.length} problem${issues.length > 1 ? "s" : ""}` : "no problems"}  ${s.url}`);
    for (const i of issues) console.log(`  - ${i}`);
  }
  console.log(`${body.credits_used} credit${body.credits_used === 1 ? "" : "s"} used. Images kept ${Math.round(body.expires_in / 3600)} h.`);
  return problems;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const { cmd } = args;
  if (!cmd || cmd === "help") return console.log(HELP), 0;
  if (cmd === "-v" || cmd === "--version" || cmd === "version") return console.log(VERSION), 0;
  if (cmd === "login") return await login(), 0;
  if (cmd === "logout") {
    fs.rmSync(configPath(), { force: true });
    err("Logged out.");
    if (process.env.SHOTLANE_API_KEY) err(ENV_WINS);
    return 0;
  }
  const commands = ["shot", "pdf", "md", "check", "credits"];
  if (!commands.includes(cmd)) throw new UsageError(`unknown command: ${cmd}. Try shotlane --help`);
  const key = process.env.SHOTLANE_API_KEY || savedKey();
  if (!key) {
    if (cmd === "md" || cmd === "shot") {
      const result = await keyless(cmd, args);
      if (cmd === "md" && args.output === undefined) return process.stdout.write(result), 0;
      return emit(result, args, cmd === "md" ? "md" : "png"), 0;
    }
    throw new UsageError(`${cmd} needs an API key. Run shotlane login (free key: ${BASE}/signup)`);
  }
  const s = new Shotlane(key, { baseUrl: BASE });
  if (cmd === "credits") {
    const a = await s.account();
    if (args.json) console.log(JSON.stringify(a, null, 2));
    else console.log(`${a.credits} credits: ${a.free_credits} free this month, ${a.paid_credits} paid.`);
    return 0;
  }
  if (cmd === "check") {
    const { devices, ...opts } = args.opts;
    const body = await s.check(resolveInput(args.input, { check: true }), devices ? devices.split(",") : undefined, opts);
    if (args.json) console.log(JSON.stringify(body, null, 2));
    const failed = (body.shots || []).filter((x) => !x.ok).length;
    const problems = args.json ? (body.issues || 0) + failed : printCheck(body);
    return problems ? 1 : 0;
  }
  if (cmd === "md") {
    const text = await s.markdown(resolveInput(args.input, { md: true }), args.opts);
    if (args.output === undefined) return process.stdout.write(typeof text === "string" ? text : JSON.stringify(text, null, 2) + "\n"), 0;
    return emit(text, args, "md", s.lastHeaders), 0;
  }
  const fmt = (args.opts.format || (cmd === "pdf" ? "pdf" : "png")).toLowerCase();
  const result = await (cmd === "pdf" ? s.pdf : s.screenshot).call(s, resolveInput(args.input), args.opts);
  emit(result, args, fmt === "jpeg" ? "jpg" : fmt, s.lastHeaders);
  return 0;
}

const direct = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (direct) {
  // exit once stdout and stderr have drained: process.exit right after a big write cuts a pipe short (macOS, Windows)
  const exit = (code) => process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
  main(process.argv.slice(2)).then(
    (code) => exit(code ?? 0),
    (e) => {
      if (e instanceof UsageError) {
        err(`shotlane: ${e.message}`);
        return exit(2);
      }
      if (e instanceof ShotlaneError && e.status === 401) err(`shotlane: ${e.message}\nRun shotlane login, or set SHOTLANE_API_KEY.`);
      else err(`shotlane: ${e.message}`);
      exit(1);
    },
  );
}
