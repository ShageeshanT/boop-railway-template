# Changelog

Notable changes per release of `boop-railway-template`.

Format: one section per release. Prefix breaking items with `[BREAKING]` and include a migration note.

---

## v0.1.0 — initial fork

- Forked from [boop-agent](https://github.com/raroque/boop-agent).
- Added: WhatsApp channel via [Baileys](https://github.com/WhiskeySockets/Baileys) (`server/whatsapp.ts`). Mirrors the Sendblue contract — same `handleUserMessage` entrypoint, `wa:<jid>` conversation prefix, allowlist gating via `WHATSAPP_ALLOWED_JIDS`.
- Added: env loader can pull from `/data/.env` (or `BOOP_DATA_DIR`/`BOOP_ENV_FILE`) for Railway-style persistent volumes (`server/env-setup.ts`).
- Added: `WA_AUTH_DIR` env var to redirect WhatsApp credentials onto a persistent volume.
- Added: password-gated setup wizard at `/setup` (`server/setup-routes.ts`) — view status, edit env vars, save to `/data/.env`, save & restart. Requires `SETUP_PASSWORD` env var.
- Added: `Dockerfile` + `.dockerignore` — multi-stage build, Claude CLI baked in, `HOME=/data` so `claude` login persists across redeploys, `tini` for signal forwarding.
- Added: `railway.json` declaring Dockerfile build + `/health` healthcheck + restart policy.
- Changed: `convex/_generated/` is no longer gitignored — committed so Docker/Railway builds don't need Convex auth at build time. Re-run `npx convex codegen` after schema changes.
- Repackaged as `boop-railway-template` (see `package.json`).
- Removed personal assets (`luna.jpeg`, `imessage.jpg`).
