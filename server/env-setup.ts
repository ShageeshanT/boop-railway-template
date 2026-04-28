// Loads env files in priority order:
//   1. BOOP_ENV_FILE (explicit override)         — highest priority
//   2. /data/.env (or BOOP_DATA_DIR/.env)        — Railway volume, written by setup wizard
//   3. .env.local                                 — local dev
//   4. .env                                       — fallback
// Imported for side effects — must run before any module reads process.env.
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dataDir = process.env.BOOP_DATA_DIR ?? "/data";

const candidates = [
  process.env.BOOP_ENV_FILE,
  resolve(dataDir, ".env"),
  resolve(root, ".env.local"),
  resolve(root, ".env"),
].filter((p): p is string => Boolean(p));

const loaded: string[] = [];
for (const path of candidates) {
  if (existsSync(path)) {
    config({ path });
    loaded.push(path);
  }
}

if (loaded.length > 0) {
  console.log(`[env] loaded: ${loaded.join(", ")}`);
}
