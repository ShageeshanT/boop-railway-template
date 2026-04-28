// Loads env files in priority order (highest priority listed first):
//   1. BOOP_ENV_FILE (explicit override)
//   2. <BOOP_DATA_DIR>/.env  (default /data/.env — Railway volume, written by setup wizard)
//   3. .env.local                                 — local dev
//   4. .env                                       — fallback
//
// Loaded lowest-priority-first with override:true so later loads win, and we re-read
// BOOP_DATA_DIR after .env.local so it can be set there for local dev.
// Imported for side effects — must run before any module reads process.env.
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const loaded: string[] = [];

function loadIfExists(path: string | undefined, override: boolean): void {
  if (!path) return;
  if (!existsSync(path)) return;
  config({ path, override });
  loaded.push(path);
}

// Lowest priority first. override:true means later loads win.
loadIfExists(resolve(root, ".env"), false);
loadIfExists(resolve(root, ".env.local"), true);
// Now BOOP_DATA_DIR may have been set by .env.local — re-read it before looking for /data/.env.
const dataDir = process.env.BOOP_DATA_DIR ?? "/data";
loadIfExists(resolve(dataDir, ".env"), true);
loadIfExists(process.env.BOOP_ENV_FILE, true);

if (loaded.length > 0) {
  console.log(`[env] loaded: ${loaded.join(", ")}`);
}
