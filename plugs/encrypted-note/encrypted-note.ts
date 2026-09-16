import { syscall } from '@silverbulletmd/silverbullet/syscall';
import html from './generated/editor.ts';
import { newEncryptedNoteMarker } from './src/crypto.ts';

const extension = '.sben';

export function encryptedNoteEditor() {
  return { html };
}

export async function newEncryptedNote() {
  if (await syscall('system.getMode') === 'ro' || await syscall('editor.getUiOption', 'forcedROMode')) {
    await syscall('editor.flashNotification', 'This space is read-only.', 'error');
    return;
  }
  let name = await syscall('editor.prompt', 'New encrypted note path', 'Private note.sben') as string | undefined;
  if (!name?.trim()) return;
  name = name.trim();
  if (!name.toLowerCase().endsWith(extension)) name += extension;
  if (name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) {
    await syscall('editor.flashNotification', 'Use a relative space path without empty or parent directory segments.', 'error');
    return;
  }
  if (await syscall('space.fileExists', name)) {
    await syscall('editor.flashNotification', 'That encrypted note already exists.', 'error');
    return;
  }
  // This marker carries no user content. The document editor replaces it with
  // authenticated ciphertext after the user chooses a passphrase.
  await syscall('space.writeDocument', name, newEncryptedNoteMarker());
  await syscall('editor.navigate', name, false, false);
}

export async function openEncryptedNote() {
  const files = await syscall('space.listFiles') as Array<{ name: string }>;
  const options = files.filter(file => file.name.toLowerCase().endsWith(extension))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(file => ({ name: file.name, value: file.name }));
  const selected = await syscall('editor.filterBox', 'Open encrypted note:', options, 'Choose an encrypted note', 'Search encrypted notes') as { value?: string } | undefined;
  if (selected?.value) await syscall('editor.navigate', selected.value, false, false);
}
