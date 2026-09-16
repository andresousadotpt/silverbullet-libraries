const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const magic = encoder.encode('SBENv001');
const marker = encoder.encode('SB encrypted note: create passphrase\n');
const saltLength = 16;
const ivLength = 12;
const headerLength = magic.length + saltLength + ivLength;
export const maxNoteBytes = 10 * 1024 * 1024;
const iterations = 600_000;

export function newEncryptedNoteMarker() {
  return marker.slice();
}

export function isNewEncryptedNote(bytes: Uint8Array) {
  return equal(bytes, marker);
}

export async function encryptNote(text: string, passphrase: string): Promise<Uint8Array> {
  if (!passphrase) throw new Error('A passphrase is required.');
  const plaintext = encoder.encode(text);
  if (plaintext.length > maxNoteBytes) throw new Error('Encrypted notes are limited to 10 MB.');
  const salt = crypto.getRandomValues(new Uint8Array(saltLength));
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const key = await deriveKey(passphrase, salt);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: magic }, key, plaintext as BufferSource,
  ));
  const output = new Uint8Array(headerLength + encrypted.length);
  output.set(magic); output.set(salt, magic.length); output.set(iv, magic.length + saltLength); output.set(encrypted, headerLength);
  return output;
}

export async function decryptNote(bytes: Uint8Array, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('A passphrase is required.');
  if (bytes.length < headerLength + 16 || !equal(bytes.slice(0, magic.length), magic) || bytes.length > maxNoteBytes + headerLength + 16) {
    throw new Error('This is not a supported encrypted note.');
  }
  const salt = bytes.slice(magic.length, magic.length + saltLength);
  const iv = bytes.slice(magic.length + saltLength, headerLength);
  const key = await deriveKey(passphrase, salt);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: magic }, key, bytes.slice(headerLength) as BufferSource,
    );
    return decoder.decode(plaintext);
  } catch {
    // AES-GCM authenticates the ciphertext: never distinguish a wrong
    // passphrase from altered data for the person trying to open it.
    throw new Error('Unable to decrypt this note. Check the passphrase.');
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase) as BufferSource, { name: 'PBKDF2' }, false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

function equal(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
