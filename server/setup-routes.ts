import express from "express";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";

const DATA_DIR = process.env.BOOP_DATA_DIR ?? "/data";
const ENV_PATH = path.resolve(DATA_DIR, ".env");

// Keys the wizard manages. Anything else in /data/.env is preserved untouched.
const MANAGED_KEYS = [
  "WHATSAPP_ENABLED",
  "WHATSAPP_ALLOWED_JIDS",
  "CONVEX_URL",
  "VITE_CONVEX_URL",
  "COMPOSIO_API_KEY",
  "COMPOSIO_USER_ID",
  "VOYAGE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "BOOP_MODEL",
] as const;

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnvFile(env: Record<string, string>): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const lines = Object.entries(env)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

function passwordOk(req: express.Request): boolean {
  const expected = process.env.SETUP_PASSWORD;
  if (!expected) return false; // no password set = wizard locked
  const provided =
    req.header("x-setup-password") ??
    (typeof req.body === "object" && req.body && (req.body as { password?: string }).password);
  return typeof provided === "string" && provided === expected;
}

function claudeCredsExist(): boolean {
  // Claude CLI stores creds under ~/.claude (or HOME=/data/.claude on Railway volume).
  for (const candidate of [
    path.resolve(DATA_DIR, ".claude"),
    path.resolve(homedir(), ".claude"),
  ]) {
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function createSetupRouter(): express.Router {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(SETUP_HTML);
  });

  router.post("/login", express.json(), (req, res) => {
    if (!process.env.SETUP_PASSWORD) {
      res.status(503).json({ ok: false, error: "SETUP_PASSWORD env var not set on the server" });
      return;
    }
    if (!passwordOk(req)) {
      res.status(401).json({ ok: false, error: "wrong password" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/config", (req, res) => {
    if (!passwordOk(req)) {
      res.status(401).json({ ok: false });
      return;
    }
    const env = readEnvFile();
    const values: Record<string, string> = {};
    for (const k of MANAGED_KEYS) {
      values[k] = env[k] ?? process.env[k] ?? "";
    }
    res.json({ ok: true, values });
  });

  router.post("/save", express.json(), (req, res) => {
    if (!passwordOk(req)) {
      res.status(401).json({ ok: false });
      return;
    }
    const incoming = (req.body as { values?: Record<string, string> }).values ?? {};
    const env = readEnvFile();
    for (const k of MANAGED_KEYS) {
      const v = incoming[k];
      if (typeof v === "string") {
        if (v.trim() === "") delete env[k];
        else env[k] = v.trim();
      }
    }
    writeEnvFile(env);
    res.json({ ok: true, path: ENV_PATH });
  });

  router.post("/restart", express.json(), (req, res) => {
    if (!passwordOk(req)) {
      res.status(401).json({ ok: false });
      return;
    }
    res.json({ ok: true, restarting: true });
    setTimeout(() => process.exit(0), 250);
  });

  router.get("/status", (req, res) => {
    if (!passwordOk(req)) {
      res.status(401).json({ ok: false });
      return;
    }
    res.json({
      ok: true,
      env: {
        path: ENV_PATH,
        exists: existsSync(ENV_PATH),
      },
      whatsapp: {
        enabled: process.env.WHATSAPP_ENABLED === "true",
        allowlist: (process.env.WHATSAPP_ALLOWED_JIDS ?? "").split(",").filter(Boolean).length,
      },
      convex: { configured: Boolean(process.env.CONVEX_URL) },
      composio: { configured: Boolean(process.env.COMPOSIO_API_KEY) },
      anthropic: {
        apiKey: Boolean(process.env.ANTHROPIC_API_KEY),
        claudeCli: claudeCredsExist(),
      },
      model: process.env.BOOP_MODEL ?? "claude-sonnet-4-6",
    });
  });

  return router;
}

const SETUP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>boop-railway-template — setup</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; background: #0b0b0e; color: #eaeaea;
      margin: 0; min-height: 100vh; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #9aa0a6; font-size: 13px; margin-bottom: 28px; }
    .card { background: #15151a; border: 1px solid #25252e; border-radius: 14px; padding: 22px; margin-bottom: 18px; }
    .card h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
    .card .hint { color: #888; font-size: 12px; margin-bottom: 14px; }
    label { display: block; font-size: 12px; color: #c8c8d0; margin: 12px 0 6px; font-weight: 500; }
    input, select { width: 100%; background: #0e0e13; color: #eee; border: 1px solid #2a2a36;
      border-radius: 8px; padding: 9px 11px; font: inherit; outline: none; }
    input:focus, select:focus { border-color: #5b6cff; }
    button { background: #5b6cff; color: white; border: 0; padding: 10px 16px; border-radius: 8px;
      font-weight: 600; font-size: 13px; cursor: pointer; }
    button:hover { background: #6e7dff; }
    button.ghost { background: transparent; color: #c8c8d0; border: 1px solid #2a2a36; }
    button.ghost:hover { background: #1a1a22; }
    button.danger { background: #c2364a; }
    button.danger:hover { background: #d44060; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px;
      font-size: 11px; font-weight: 600; }
    .pill.ok { background: #1c4a2a; color: #6ee7a8; }
    .pill.warn { background: #4a3c1c; color: #f5c66e; }
    .pill.bad { background: #4a1c1c; color: #f59292; }
    .status-row { display: flex; justify-content: space-between; padding: 8px 0;
      border-bottom: 1px solid #25252e; font-size: 13px; }
    .status-row:last-child { border-bottom: 0; }
    .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #1c4a2a;
      color: #6ee7a8; padding: 10px 18px; border-radius: 8px; font-size: 13px;
      opacity: 0; transition: opacity 0.2s; pointer-events: none; }
    .toast.bad { background: #4a1c1c; color: #f59292; }
    .toast.show { opacity: 1; }
    code { background: #1a1a22; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
    .muted { color: #888; font-size: 12px; }
    .login-card { max-width: 380px; margin: 80px auto 0; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="login-view" class="card login-card">
      <h1>boop-railway-template</h1>
      <div class="sub">Enter the setup password to continue.</div>
      <input id="login-pwd" type="password" placeholder="SETUP_PASSWORD" autofocus />
      <div class="row" style="justify-content:flex-end">
        <button id="login-btn">Unlock</button>
      </div>
      <div id="login-err" class="muted" style="color:#f59292;margin-top:10px"></div>
    </div>

    <div id="main-view" class="hidden">
      <h1>boop-railway-template</h1>
      <div class="sub">Configure env vars, write them to <code id="env-path">/data/.env</code>, restart the server.</div>

      <div class="card">
        <h2>Status</h2>
        <div class="hint">Live snapshot of the running server. Refreshes every 5s.</div>
        <div id="status">loading…</div>
      </div>

      <div class="card">
        <h2>WhatsApp</h2>
        <div class="hint">Pair via SSH (the server prints a QR in the terminal). Set the allowlist here.</div>
        <label>WHATSAPP_ENABLED</label>
        <select id="WHATSAPP_ENABLED">
          <option value="true">true (start the Baileys socket)</option>
          <option value="false">false (disable)</option>
        </select>
        <label>WHATSAPP_ALLOWED_JIDS <span class="muted">— comma-separated, no +</span></label>
        <input id="WHATSAPP_ALLOWED_JIDS" placeholder="15551234567,447911123456" />
      </div>

      <div class="card">
        <h2>Convex</h2>
        <div class="hint">Both should be the same URL.</div>
        <label>CONVEX_URL</label>
        <input id="CONVEX_URL" placeholder="https://your-deployment.convex.cloud" />
        <label>VITE_CONVEX_URL</label>
        <input id="VITE_CONVEX_URL" placeholder="https://your-deployment.convex.cloud" />
      </div>

      <div class="card">
        <h2>Anthropic</h2>
        <div class="hint">Either an API key here, OR SSH in and run <code>claude</code> to log in (creds persist on the volume).</div>
        <label>ANTHROPIC_API_KEY <span class="muted">— optional if Claude CLI logged in</span></label>
        <input id="ANTHROPIC_API_KEY" type="password" placeholder="sk-ant-..." />
        <label>BOOP_MODEL</label>
        <select id="BOOP_MODEL">
          <option value="">(default — claude-sonnet-4-6)</option>
          <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
          <option value="claude-opus-4-7">claude-opus-4-7</option>
          <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
        </select>
      </div>

      <div class="card">
        <h2>Composio (optional — integrations)</h2>
        <div class="hint">Without this, plain chat + memory + automations still work.</div>
        <label>COMPOSIO_API_KEY</label>
        <input id="COMPOSIO_API_KEY" type="password" placeholder="sk-comp-..." />
        <label>COMPOSIO_USER_ID <span class="muted">— defaults to "boop-default"</span></label>
        <input id="COMPOSIO_USER_ID" placeholder="boop-default" />
      </div>

      <div class="card">
        <h2>Embeddings (optional — vector recall)</h2>
        <div class="hint">Set one. Without either, recall falls back to substring match.</div>
        <label>VOYAGE_API_KEY</label>
        <input id="VOYAGE_API_KEY" type="password" placeholder="pa-..." />
        <label>OPENAI_API_KEY</label>
        <input id="OPENAI_API_KEY" type="password" placeholder="sk-..." />
      </div>

      <div class="row">
        <button id="save-btn">Save</button>
        <button id="restart-btn" class="danger">Save &amp; restart</button>
        <button id="logout-btn" class="ghost">Lock</button>
      </div>
      <div class="muted" style="margin-top:12px">
        Saved values are written to the file shown at the top. The server will pick them up on next boot.
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
const FIELDS = ${JSON.stringify(MANAGED_KEYS)};
let pwd = sessionStorage.getItem("boop_setup_pwd") || "";

function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  setTimeout(() => { t.className = "toast" + (bad ? " bad" : ""); }, 1800);
}

async function api(method, path, body) {
  const headers = { "x-setup-password": pwd };
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch("/setup" + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { lock(); throw new Error("unauthorized"); }
  return r.json();
}

function show(view) {
  $("login-view").classList.toggle("hidden", view !== "login");
  $("main-view").classList.toggle("hidden", view !== "main");
}

function lock() {
  pwd = "";
  sessionStorage.removeItem("boop_setup_pwd");
  show("login");
  $("login-pwd").value = "";
  $("login-pwd").focus();
}

async function unlock() {
  const p = $("login-pwd").value;
  $("login-err").textContent = "";
  const r = await fetch("/setup/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: p }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    $("login-err").textContent = data.error || "wrong password";
    return;
  }
  pwd = p;
  sessionStorage.setItem("boop_setup_pwd", pwd);
  show("main");
  loadAll();
}

async function loadAll() {
  await loadConfig();
  await loadStatus();
}

async function loadConfig() {
  const r = await api("GET", "/config");
  if (!r.ok) return;
  for (const k of FIELDS) {
    const el = $(k);
    if (el && r.values[k] !== undefined) el.value = r.values[k];
  }
}

async function loadStatus() {
  const r = await api("GET", "/status").catch(() => null);
  if (!r) return;
  $("env-path").textContent = r.env.path;
  const rows = [
    ["env file", r.env.exists ? pill("ok", "exists") : pill("warn", "not yet written")],
    ["whatsapp", r.whatsapp.enabled
      ? pill("ok", "enabled (" + r.whatsapp.allowlist + " allowlist)")
      : pill("bad", "disabled")],
    ["convex", r.convex.configured ? pill("ok", "configured") : pill("bad", "missing CONVEX_URL")],
    ["composio", r.composio.configured ? pill("ok", "configured") : pill("warn", "optional, off")],
    ["anthropic", r.anthropic.apiKey
      ? pill("ok", "api key set")
      : (r.anthropic.claudeCli ? pill("ok", "claude cli logged in") : pill("bad", "no creds — SSH in and run \`claude\`"))],
    ["model", '<code>' + r.model + '</code>'],
  ];
  $("status").innerHTML = rows.map(([k, v]) =>
    '<div class="status-row"><span>' + k + '</span><span>' + v + '</span></div>'
  ).join("");
}

function pill(kind, label) { return '<span class="pill ' + kind + '">' + label + '</span>'; }

function collect() {
  const values = {};
  for (const k of FIELDS) {
    const el = $(k);
    if (el) values[k] = el.value;
  }
  return values;
}

async function save() {
  const r = await api("POST", "/save", { values: collect() });
  if (r.ok) toast("saved → " + r.path);
  else toast("save failed", true);
  await loadStatus();
}

async function restart() {
  if (!confirm("Save and restart the server? Active connections will drop.")) return;
  await save();
  toast("restarting…");
  try { await api("POST", "/restart", {}); } catch { /* socket will close */ }
}

$("login-btn").addEventListener("click", unlock);
$("login-pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
$("save-btn").addEventListener("click", save);
$("restart-btn").addEventListener("click", restart);
$("logout-btn").addEventListener("click", lock);

if (pwd) {
  // Verify cached password is still valid
  fetch("/setup/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pwd }),
  }).then(r => {
    if (r.ok) { show("main"); loadAll(); setInterval(loadStatus, 5000); }
    else lock();
  });
} else {
  show("login");
}
setInterval(() => { if (pwd) loadStatus(); }, 5000);
</script>
</body>
</html>
`;
