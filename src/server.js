import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createStore } from "./storage.js";
import { buildMessageAad, decryptMessage, encryptMessage, getEncryptionKey } from "./crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const port = Number(process.env.PORT || 3000);
const store = createStore();
const encryptionKey = getEncryptionKey();
const sseClients = new Map();

if (!process.env.CHAT_MASTER_KEY) {
  console.warn("CHAT_MASTER_KEY is not set. Using a development key; set a strong secret before hosting.");
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function normalizeParticipants(values) {
  return [...new Set((values || []).map(normalizeUsername).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function safeConversation(conversation) {
  return {
    id: conversation.id,
    name: conversation.name,
    type: conversation.type,
    participants: conversation.participants,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt
  };
}

function canReadMessage(message, username) {
  return message.recipients.includes(username);
}

function decryptForUser(message, username) {
  if (!canReadMessage(message, username)) return null;
  const text = decryptMessage(message.encrypted, encryptionKey, message.aad);
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: message.sender,
    text,
    createdAt: message.createdAt
  };
}

function notifyUsers(usernames) {
  for (const username of usernames) {
    const clients = sseClients.get(username) || new Set();
    for (const client of clients) {
      client.write(`event: refresh\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    const username = normalizeUsername(url.searchParams.get("username"));
    if (!username) return sendError(res, 400, "Username is required.");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ username })}\n\n`);

    const clients = sseClients.get(username) || new Set();
    clients.add(res);
    sseClients.set(username, clients);
    req.on("close", () => {
      clients.delete(res);
      if (!clients.size) sseClients.delete(username);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/conversations") {
    const username = normalizeUsername(url.searchParams.get("username"));
    if (!username) return sendError(res, 400, "Username is required.");

    const data = await store.read();
    const conversations = data.conversations
      .filter((conversation) => Array.isArray(conversation.participants) && conversation.participants.includes(username))
      .sort((a, b) => (b.lastMessageAt || b.createdAt).localeCompare(a.lastMessageAt || a.createdAt))
      .map(safeConversation);
    return sendJson(res, 200, { conversations });
  }

  if (req.method === "POST" && url.pathname === "/api/conversations") {
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const participants = normalizeParticipants([username, ...(Array.isArray(body.participants) ? body.participants : [])]);
    if (!username) return sendError(res, 400, "Username is required.");
    if (participants.length < 2) return sendError(res, 400, "Add at least one recipient.");

    const now = new Date().toISOString();
    const data = await store.read();
    const existing = data.conversations.find(
      (conversation) =>
        Array.isArray(conversation.participants) &&
        conversation.participants.length === participants.length &&
        conversation.participants.every((participant, index) => participant === participants[index])
    );

    if (existing) return sendJson(res, 200, { conversation: safeConversation(existing) });

    const conversation = {
      id: crypto.randomUUID(),
      name: String(body.name || "").trim().slice(0, 80),
      type: participants.length === 2 ? "direct" : "group",
      participants,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now
    };
    data.conversations.push(conversation);
    await store.write(data);
    notifyUsers(participants);
    return sendJson(res, 201, { conversation: safeConversation(conversation) });
  }

  const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (messageMatch && req.method === "GET") {
    const conversationId = messageMatch[1];
    const username = normalizeUsername(url.searchParams.get("username"));
    if (!username) return sendError(res, 400, "Username is required.");

    const data = await store.read();
    const conversation = data.conversations.find((item) => item.id === conversationId);
    if (!conversation) return sendError(res, 404, "Conversation not found.");
    if (!Array.isArray(conversation.participants) || !conversation.participants.includes(username)) return sendError(res, 403, "You are not a participant.");

    const messages = data.messages
      .filter((message) => message.conversationId === conversationId)
      .map((message) => decryptForUser(message, username))
      .filter(Boolean);
    return sendJson(res, 200, { conversation: safeConversation(conversation), messages });
  }

  if (messageMatch && req.method === "POST") {
    const conversationId = messageMatch[1];
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const text = String(body.text || "").trim();
    if (!username) return sendError(res, 400, "Username is required.");
    if (!text) return sendError(res, 400, "Message text is required.");
    if (text.length > 4000) return sendError(res, 400, "Message is too long.");

    const data = await store.read();
    const conversation = data.conversations.find((item) => item.id === conversationId);
    if (!conversation) return sendError(res, 404, "Conversation not found.");
    if (!Array.isArray(conversation.participants) || !conversation.participants.includes(username)) return sendError(res, 403, "You are not a participant.");

    const now = new Date().toISOString();
    const aad = buildMessageAad({
      conversationId,
      sender: username,
      participants: conversation.participants
    });
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      sender: username,
      recipients: conversation.participants,
      aad,
      encrypted: encryptMessage(text, encryptionKey, aad),
      createdAt: now
    };
    data.messages.push(message);
    conversation.updatedAt = now;
    conversation.lastMessageAt = now;
    await store.write(data);
    notifyUsers(conversation.participants);
    return sendJson(res, 201, { message: decryptForUser(message, username) });
  }

  sendError(res, 404, "API route not found.");
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await fs.readFile(path.join(publicDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(index);
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendError(res, error.status || 500, error.message || "Unexpected server error.");
  }
});

server.listen(port, () => {
  console.log(`Secure chat app listening on http://localhost:${port}`);
});
