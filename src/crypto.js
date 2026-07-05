import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export function getEncryptionKey(secret = process.env.CHAT_MASTER_KEY) {
  const material = secret || "development-only-change-me";
  return crypto.createHash("sha256").update(material).digest();
}

export function buildMessageAad({ conversationId, sender, participants }) {
  const roster = [...new Set((participants || []).map((value) => String(value).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  return JSON.stringify({
    conversationId: String(conversationId || ""),
    sender: String(sender || ""),
    participants: roster
  });
}

export function encryptMessage(plainText, key, aad = "") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final()
  ]);

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptMessage(payload, key, aad = "") {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64")
  );
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
