import { decryptNote, encryptNote, isNewEncryptedNote } from './crypto.ts';

type EncryptedNoteBridge = EventTarget & { sendMessage(type: string, data?: unknown): void };
const bridge = (window as unknown as { silverbullet: EncryptedNoteBridge }).silverbullet;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const filename = byId('filename'), state = byId('state'), unlock = byId('unlock'), form = byId<HTMLFormElement>('unlock-form');
const instruction = byId('instruction'), passphrase = byId<HTMLInputElement>('passphrase'), confirm = byId<HTMLInputElement>('confirm');
const confirmLabel = byId('confirm-label'), unlockButton = byId<HTMLButtonElement>('unlock-button'), error = byId('error');
const content = byId<HTMLTextAreaElement>('content'), status = byId('status'), saveButton = byId<HTMLButtonElement>('save'), lockButton = byId<HTMLButtonElement>('lock');

let bytes: Uint8Array | undefined, password = '', writable = false, creating = false, dirty = false, generation = 0, saveTimer: number | undefined;

function setError(message = '') { error.textContent = message; }
function resetLocked(message: string) {
  password = ''; dirty = false; content.value = ''; content.hidden = true; unlock.hidden = false;
  state.textContent = 'Locked'; saveButton.disabled = true; lockButton.disabled = true; status.textContent = message;
}
function setUnlockMode(newNote: boolean) {
  creating = newNote; passphrase.value = ''; confirm.value = ''; setError();
  instruction.textContent = newNote ? 'Choose a strong, unique passphrase. It cannot be recovered.' : 'Enter the passphrase to decrypt this note.';
  confirm.hidden = confirmLabel.hidden = !newNote;
  unlockButton.textContent = newNote ? 'Create encrypted note' : 'Decrypt note';
  passphrase.autocomplete = newNote ? 'new-password' : 'current-password'; passphrase.focus();
}
function setUnlocked(text: string) {
  content.value = text; content.readOnly = !writable; content.hidden = false; unlock.hidden = true;
  state.textContent = writable ? 'Unlocked' : 'Unlocked · read-only'; saveButton.disabled = !writable; lockButton.disabled = false;
  status.textContent = writable ? 'Decrypted locally. Changes are encrypted before saving.' : 'Decrypted locally. This file is read-only.';
  content.focus();
}
async function persist(notify = true) {
  if (!bytes || !password || !writable || !dirty) return;
  const snapshot = content.value;
  status.textContent = 'Encrypting changes locally…'; saveButton.disabled = true;
  try {
    const encrypted = await encryptNote(snapshot, password);
    if (snapshot !== content.value) { status.textContent = 'More changes pending…'; return; }
    bytes = encrypted; dirty = false; status.textContent = 'Changes encrypted; waiting for SilverBullet save.';
    if (notify) bridge.sendMessage('file-changed');
  } catch (cause) { status.textContent = cause instanceof Error ? cause.message : 'Could not encrypt changes.'; }
  finally { saveButton.disabled = !writable; }
}
function queueSave() {
  dirty = true; status.textContent = 'Changes pending encryption…';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void persist(), 900);
}

bridge.addEventListener('file-open', event => {
  const token = ++generation;
  const { data, meta } = (event as CustomEvent).detail;
  bytes = new Uint8Array(data); writable = meta.perm === 'rw'; filename.textContent = meta.name; resetLocked('Passphrase required before this note is shown.');
  const isNew = isNewEncryptedNote(bytes);
  if (isNew && !writable) { setError('A new encrypted note cannot be created in a read-only space.'); return; }
  setUnlockMode(isNew);
  if (token !== generation) return;
});
form.addEventListener('submit', event => { event.preventDefault(); void (async () => {
  if (!bytes) return; const candidate = passphrase.value;
  if (creating && candidate !== confirm.value) { setError('Passphrases do not match.'); return; }
  if (!candidate) { setError('A passphrase is required.'); return; }
  unlockButton.disabled = true; setError();
  try {
    const text = creating ? '' : await decryptNote(bytes, candidate);
    password = candidate; passphrase.value = ''; confirm.value = ''; setUnlocked(text);
    if (creating) { dirty = true; await persist(); }
  } catch { password = ''; setError('Unable to decrypt this note. Check the passphrase.'); }
  finally { unlockButton.disabled = false; }
})(); });
content.addEventListener('input', queueSave);
saveButton.onclick = () => void persist();
lockButton.onclick = () => {
  if (dirty && !window.confirm('Discard unsaved decrypted changes and lock this note?')) return;
  if (saveTimer) clearTimeout(saveTimer); resetLocked('Locked. Passphrase required before this note is shown.'); setUnlockMode(false);
};
bridge.addEventListener('request-save', () => { void (async () => { await persist(false); if (bytes) bridge.sendMessage('file-saved', { data: bytes }); })(); });
bridge.addEventListener('focus', () => (content.hidden ? passphrase : content).focus());
