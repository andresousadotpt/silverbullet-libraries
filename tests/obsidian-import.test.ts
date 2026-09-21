import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js/index-native.js';
import { createPlan, extract, limits, openArchive, validatePath } from '../plugs/obsidian-import/src/archive.ts';
import { importPlan, type ImportHost } from '../plugs/obsidian-import/src/importer.ts';

const note = new TextEncoder().encode('---\r\ntags: [example]\r\n---\r\n# Café\r\n[[Other]] ![[image.png]]\r\n');
async function zip(files: Record<string, Uint8Array>) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, useCompressionStream: false });
  for (const [name, bytes] of Object.entries(files)) await writer.add(name, new Uint8ArrayReader(bytes));
  return writer.close();
}
function host(overrides: Partial<ImportHost> = {}) {
  const writes = new Map<string, Uint8Array>();
  return { writes, api: { readOnly: async () => false, exists: async (path: string) => writes.has(path),
    write: async (path: string, bytes: Uint8Array) => { writes.set(path, bytes); }, progress: async () => {}, ...overrides } };
}

test('imports nested Markdown and binary attachments byte-for-byte, skips clutter, supports wrapper choice', async () => {
  const image = new Uint8Array([0, 255, 1, 128]);
  const archive = await openArchive(await zip({ 'Vault/Notes/Sub/Café.md': note, 'Vault/assets/image.png': image,
    'Vault/.obsidian/config.json': note, '__MACOSX/._Vault': note, 'Vault/.trash/old.md': note }));
  try {
    assert.equal(archive.wrapper, 'Vault');
    const plan = createPlan(archive, 'Imported', true, []);
    const { writes, api } = host();
    const result = await importPlan(plan, api);
    assert.equal(result.written.length, 2);
    assert.equal(result.skipped.length, 3);
    assert.deepEqual(writes.get('Imported/Notes/Sub/Café.md'), note);
    assert.deepEqual(writes.get('Imported/assets/image.png'), image);
    assert.equal(createPlan(archive, '', false, []).files[0].path, 'Vault/Notes/Sub/Café.md');
    assert.equal(createPlan(archive, 'Imported', true, [...writes.keys()]).files.length, 0);
  } finally { await archive.close(); }
});

test('rejects unsafe paths and conflicting destinations', async () => {
  for (const path of ['/absolute', '../escape', 'a/../b', 'a//b', 'a\\b', 'C:/a', 'a\0b', 'a#section.md', 'trailing./a']) {
    assert.throws(() => validatePath(path));
  }
  const archive = await openArchive(await zip({ 'a.md': note, 'A.md': note }));
  try { assert.throws(() => createPlan(archive, '', false, []), /case-equivalent/); }
  finally { await archive.close(); }
  const collision = await openArchive(await zip({ 'folder': note, 'folder/note.md': note }));
  try { assert.throws(() => createPlan(collision, '', false, []), /file\/folder/); }
  finally { await collision.close(); }
});

test('skips existing case-equivalent paths and file/folder collisions', async () => {
  const archive = await openArchive(await zip({ 'a.md': note, 'folder/note.md': note, 'assets': note }));
  try {
    const plan = createPlan(archive, '', false, ['A.md', 'folder', 'assets/picture.png']);
    assert.equal(plan.files.length, 0);
    assert.equal(plan.skipped.length, 3);
  } finally { await archive.close(); }
});

test('read-only, late conflicts and write failures preserve existing content and report partial work', async () => {
  const archive = await openArchive(await zip({ 'one.md': note, 'two.md': note, 'three.md': note }));
  try {
    const plan = createPlan(archive, '', false, []);
    const ro = host({ readOnly: async () => true });
    assert.equal((await importPlan(plan, ro.api)).failed.length, 1);
    assert.equal(ro.writes.size, 0);
    const late = host({ exists: async () => true });
    assert.equal((await importPlan(plan, late.api)).skipped.length, 3);
    assert.equal(late.writes.size, 0);
    const failed = host();
    const normalWrite = failed.api.write;
    failed.api.write = async (path, bytes) => { if (path === 'two.md') throw new Error('Disk full'); await normalWrite(path, bytes); };
    const result = await importPlan(plan, failed.api);
    assert.deepEqual(result.written, ['one.md']);
    assert.equal(result.failed[0].reason, 'Disk full');
    assert.match(result.stopped!, /1 remaining/);
    let checks = 0;
    const changed = host({ readOnly: async () => ++checks > 1 });
    await importPlan(plan, changed.api);
    assert.equal(changed.writes.size, 0);
  } finally { await archive.close(); }
});

test('rejects malformed and oversized archives and entry limits', async () => {
  await assert.rejects(openArchive(new Uint8Array([1, 2, 3])));
  await assert.rejects(openArchive(new Uint8Array(limits.archive + 1)), /100 MiB/);
  const previous = limits.entries;
  limits.entries = 1;
  try { await assert.rejects(openArchive(await zip({ 'a.md': note, 'b.md': note })), /entry limit/); }
  finally { limits.entries = previous; }
  const fileLimit = limits.file;
  limits.file = 1;
  try { await assert.rejects(openArchive(await zip({ 'a.md': note })), /per-file/); }
  finally { limits.file = fileLimit; }
});

test('CRC validation rejects corrupted bytes before writing', async () => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await writer.add('note.md', new Uint8ArrayReader(note), { level: 0 });
  const bytes = await writer.close();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataStart = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  bytes[dataStart] ^= 1;
  const archive = await openArchive(bytes);
  try { await assert.rejects(extract(archive.entries[0])); }
  finally { await archive.close(); }
});
