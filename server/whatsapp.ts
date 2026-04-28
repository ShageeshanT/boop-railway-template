import path from "node:path";
import { fileURLToPath } from "node:url";
import qrcodeTerminal from "qrcode-terminal";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { handleUserMessage } from "./interaction-agent.js";
import { broadcast } from "./broadcast.js";

const MAX_CHUNK = 2900;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = process.env.WA_AUTH_DIR
  ? path.resolve(process.env.WA_AUTH_DIR)
  : path.resolve(__dirname, "..", ".wa-auth");

function stripMarkdown(text: string): string {
  // WhatsApp supports *bold* _italic_ ~strike~ ```code``` natively.
  // Strip headings and convert links to "text (url)" — leave the rest.
  return text
    .replace(/^#+\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();
}

function chunk(text: string, size = MAX_CHUNK): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split(/\n/)) {
    if ((buf + "\n" + line).length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function extractText(msg: WAMessage): string | undefined {
  const m = msg.message;
  if (!m) return undefined;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    undefined
  );
}

function parseAllowlist(): Set<string> | null {
  const raw = process.env.WHATSAPP_ALLOWED_JIDS?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.includes("@") ? s : `${s.replace(/^\+/, "")}@s.whatsapp.net`)),
  );
}

let activeSocket: WASocket | null = null;
const presenceTimers = new Map<string, ReturnType<typeof setInterval>>();

async function sendWhatsapp(toJid: string, text: string): Promise<void> {
  if (!activeSocket) {
    console.warn("[whatsapp] socket not connected — dropping message");
    return;
  }
  const plain = stripMarkdown(text);
  for (const part of chunk(plain)) {
    try {
      await activeSocket.sendMessage(toJid, { text: part });
      console.log(`[whatsapp] → sent ${part.length} chars to ${toJid}`);
    } catch (err) {
      console.error("[whatsapp] send failed", err);
    }
  }
}

function startTypingLoop(toJid: string): () => void {
  if (!activeSocket) return () => {};
  const sock = activeSocket;
  sock.sendPresenceUpdate("composing", toJid).catch(() => {});
  const timer = setInterval(() => {
    sock.sendPresenceUpdate("composing", toJid).catch(() => {});
  }, 8000);
  presenceTimers.set(toJid, timer);
  return () => {
    clearInterval(timer);
    presenceTimers.delete(toJid);
    sock.sendPresenceUpdate("paused", toJid).catch(() => {});
  };
}

export async function startWhatsapp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const allowlist = parseAllowlist();
  if (allowlist) {
    console.log(`[whatsapp] allowlist: ${[...allowlist].join(", ")}`);
  } else {
    console.warn(
      "[whatsapp] no WHATSAPP_ALLOWED_JIDS set — anyone who messages this number can use the agent",
    );
  }

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  });
  activeSocket = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("\n[whatsapp] scan this QR with your WhatsApp app (Linked Devices → Link a device):\n");
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log(`[whatsapp] connected as ${sock.user?.id ?? "unknown"}`);
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.warn(
        `[whatsapp] connection closed (code=${code ?? "?"})${loggedOut ? " — logged out, delete .wa-auth/ and restart" : " — reconnecting"}`,
      );
      if (!loggedOut) {
        setTimeout(() => {
          startWhatsapp().catch((err) => console.error("[whatsapp] reconnect failed", err));
        }, 2000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleInbound(msg, allowlist);
      } catch (err) {
        console.error("[whatsapp] inbound handler error", err);
      }
    }
  });
}

async function handleInbound(msg: WAMessage, allowlist: Set<string> | null): Promise<void> {
  if (msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid) return;
  // Skip groups, broadcasts, statuses — direct chats only.
  if (jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@broadcast")) return;

  if (allowlist && !allowlist.has(jid)) {
    console.log(`[whatsapp] ignoring message from ${jid} (not in allowlist)`);
    return;
  }

  const content = extractText(msg)?.trim();
  if (!content) return;

  const messageId = msg.key.id ?? undefined;
  if (messageId) {
    const { claimed } = await convex.mutation(api.sendblueDedup.claim, { handle: messageId });
    if (!claimed) return;
  }

  const conversationId = `wa:${jid}`;
  const turnTag = Math.random().toString(36).slice(2, 8);
  const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
  console.log(`[turn ${turnTag}] ← ${jid}: ${JSON.stringify(preview)}`);
  const start = Date.now();

  broadcast("message_in", { conversationId, content, from_number: jid, handle: messageId });

  const stopTyping = startTypingLoop(jid);
  try {
    const reply = await handleUserMessage({
      conversationId,
      content,
      turnTag,
      onThinking: (t) => broadcast("thinking", { conversationId, t }),
    });
    if (reply) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
      console.log(
        `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
      );
      await sendWhatsapp(jid, reply);
      await convex.mutation(api.messages.send, {
        conversationId,
        role: "assistant",
        content: reply,
      });
    } else {
      console.log(`[turn ${turnTag}] → (no reply)`);
    }
  } finally {
    stopTyping();
  }
}
