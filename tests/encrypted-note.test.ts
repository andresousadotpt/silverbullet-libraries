import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptNote, encryptNote, isNewEncryptedNote, newEncryptedNoteMarker } from '../plugs/encrypted-note/src/crypto.ts';

test('encrypted notes authenticate and round-trip Unicode plaintext', async () => {
  const ciphertext = await encryptNote('Private café\nline two', 'correct horse battery staple');
  assert.notEqual(new TextDecoder().decode(ciphertext), 'Private café\nline two');
  assert.equal(await decryptNote(ciphertext, 'correct horse battery staple'), 'Private café\nline two');
  await assert.rejects(() => decryptNote(ciphertext, 'wrong passphrase'), /Unable to decrypt/);
  const altered = ciphertext.slice(); altered[altered.length - 1] ^= 1;
  await assert.rejects(() => decryptNote(altered, 'correct horse battery staple'), /Unable to decrypt/);
});

test('new encrypted note markers contain no user plaintext', () => {
  const marker = newEncryptedNoteMarker();
  assert.equal(isNewEncryptedNote(marker), true);
  assert.equal(isNewEncryptedNote(new TextEncoder().encode('not encrypted')), false);
});
