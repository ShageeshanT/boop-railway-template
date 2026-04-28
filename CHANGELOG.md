# Changelog

Notable changes per release of `boot-railway-template`.

Format: one section per release. Prefix breaking items with `[BREAKING]` and include a migration note.

---

## v0.1.0 — initial fork

- Forked from [boop-agent](https://github.com/raroque/boop-agent).
- Added: WhatsApp channel via [Baileys](https://github.com/WhiskeySockets/Baileys) (`server/whatsapp.ts`). Mirrors the Sendblue contract — same `handleUserMessage` entrypoint, `wa:<jid>` conversation prefix, allowlist gating via `WHATSAPP_ALLOWED_JIDS`.
- Added: env loader can pull from `/data/.env` (or `BOOP_DATA_DIR`/`BOOP_ENV_FILE`) for Railway-style persistent volumes (`server/env-setup.ts`).
- Added: `WA_AUTH_DIR` env var to redirect WhatsApp credentials onto a persistent volume.
- Repackaged as `boot-railway-template` (see `package.json`).
- Removed personal assets (`luna.jpeg`, `imessage.jpg`).
