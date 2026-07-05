import assert from "node:assert/strict";
import test from "node:test";
import { decryptMessage, encryptMessage, getEncryptionKey } from "../src/crypto.js";

test("encrypts and decrypts message content", () => {
  const key = getEncryptionKey("test-secret");
  const encrypted = encryptMessage("hello secure world", key, "conversation-1");

  assert.notEqual(encrypted.ciphertext, "hello secure world");
  assert.equal(decryptMessage(encrypted, key, "conversation-1"), "hello secure world");
});

test("rejects ciphertext when aad changes", () => {
  const key = getEncryptionKey("test-secret");
  const encrypted = encryptMessage("private", key, "conversation-1");

  assert.throws(() => decryptMessage(encrypted, key, "conversation-2"));
});
