import assert from "node:assert/strict";
import test from "node:test";
import { buildMessageAad, decryptMessage, encryptMessage, getEncryptionKey } from "../src/crypto.js";

test("encrypts and decrypts message content", () => {
  const key = getEncryptionKey("test-secret");
  const aad = buildMessageAad({
    conversationId: "conversation-1",
    sender: "alice",
    participants: ["alice", "bob"]
  });
  const encrypted = encryptMessage("hello secure world", key, aad);

  assert.notEqual(encrypted.ciphertext, "hello secure world");
  assert.equal(decryptMessage(encrypted, key, aad), "hello secure world");
});

test("rejects ciphertext when aad changes", () => {
  const key = getEncryptionKey("test-secret");
  const encrypted = encryptMessage(
    "private",
    key,
    buildMessageAad({
      conversationId: "conversation-1",
      sender: "alice",
      participants: ["alice", "bob"]
    })
  );

  assert.throws(() =>
    decryptMessage(
      encrypted,
      key,
      buildMessageAad({
        conversationId: "conversation-1",
        sender: "mallory",
        participants: ["alice", "bob"]
      })
    )
  );
});
