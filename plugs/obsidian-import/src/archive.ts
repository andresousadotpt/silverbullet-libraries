import { ZipReader, Uint8ArrayReader, type Entry, type FileEntry } from '@zip.js/zip.js/index-native.js';

const MiB = 1024 * 1024;
export const limits = { archive: 1024 * MiB, total: 2048 * MiB, file: 512 * MiB, entries: 10000 };

export function validateArchiveSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > limits.archive) {
    throw new Error(`ZIP exceeds the ${limits.archive / MiB} MiB archive limit.`);
  }
}
export type Skipped = { path: string; reason: string };
export type Archive = { entries: FileEntry[]; skipped: Skipped[]; wrapper?: string; close: () => Promise<void> };
export type PlannedFile = { entry: FileEntry; path: string };
export type Plan = { files: PlannedFile[]; skipped: Skipped[] };

export function validatePath(path: string): string {
  // Punctuation is valid filename data on Linux/macOS. Preserve it rather than
  // imposing Windows filename rules or interpreting SilverBullet link syntax.
  // Still reject traversal, Windows drive paths, and ambiguous separators.
  if (!path || path.length > 1024 || /[\\\x00-\x1f\x7f]/.test(path) || /^[a-z]:/i.test(path) ||
    path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsupported or unsafe path: ${path}`);
  }
  return path;
}

function skipReason(entry: Entry): string | undefined {
  if (entry.symlink) return 'Symbolic link';
  if (entry.filename.split('/').some(part => part.startsWith('.') || part === '__MACOSX' || part === '_plug')) return 'Hidden/configuration/system file';
  if (entry.filename.toLowerCase().endsWith('.plug.js')) return 'SilverBullet executable plug';
  return undefined;
}

export async function openArchive(bytes: Uint8Array): Promise<Archive> {
  validateArchiveSize(bytes.byteLength);
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false, useCompressionStream: false, checkSignature: true, strictness: 'strict',
  });
  const entries: FileEntry[] = [], skipped: Skipped[] = [];
  let count = 0, total = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > limits.entries) throw new Error('ZIP exceeds the 10,000 entry limit.');
      // Validate even ignored entries: an unsafe archive is rejected as a whole.
      validatePath(entry.filename.replace(/\/$/, ''));
      if (entry.directory) continue;
      const reason = skipReason(entry);
      if (reason) { skipped.push({ path: entry.filename, reason }); continue; }
      if (entry.encrypted) throw new Error('Password-protected ZIP entries are not supported.');
      total += entry.uncompressedSize;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limits.file || total > limits.total) {
        throw new Error(`ZIP exceeds the ${limits.file / MiB} MiB per-file or ${limits.total / MiB} MiB extracted-size limit.`);
      }
      entries.push(entry);
    }
    if (!entries.length) throw new Error('ZIP contains no importable files.');
    const first = entries[0].filename.split('/')[0];
    const wrapper = entries.every(entry => entry.filename.startsWith(first + '/')) ? first : undefined;
    return { entries, skipped, wrapper, close: () => reader.close() };
  } catch (error) { await reader.close(); throw error; }
}

const key = (path: string) => path.normalize('NFC').toLowerCase();
function ancestors(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function createPlan(archive: Archive, destination: string, stripWrapper: boolean, existing: string[]): Plan {
  if (destination) validatePath(destination);
  const files = archive.entries.map(entry => ({ entry, path: validatePath(
    (destination ? destination + '/' : '') + (stripWrapper && archive.wrapper ? entry.filename.slice(archive.wrapper.length + 1) : entry.filename),
  ) }));
  const targets = new Set<string>();
  for (const { path } of files) {
    if (targets.has(key(path))) throw new Error(`Duplicate or case-equivalent ZIP path: ${path}`);
    targets.add(key(path));
  }
  for (const { path } of files) {
    if (ancestors(path).some(parent => targets.has(key(parent)))) throw new Error(`ZIP contains a file/folder collision: ${path}`);
  }
  const existingFiles = new Set(existing.map(key));
  const existingDirectories = new Set(existing.flatMap(ancestors).map(key));
  const skipped = [...archive.skipped];
  return { skipped, files: files.filter(({ path }) => {
    if (existingFiles.has(key(path)) || existingDirectories.has(key(path)) || ancestors(path).some(parent => existingFiles.has(key(parent)))) {
      skipped.push({ path, reason: 'Existing file or file/folder conflict' }); return false;
    }
    return true;
  }) };
}

// Bound actual output as well as the ZIP directory's declared sizes. Verify CRC
// before returning any bytes to the caller, so a corrupt entry cannot be saved.
export async function extract(entry: FileEntry): Promise<Uint8Array> {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limits.file) {
    throw new Error(`File exceeds the ${limits.file / MiB} MiB per-file limit.`);
  }
  // Keep one output buffer instead of retaining every chunk and then allocating
  // another full-file copy. Nothing is returned until size and CRC checks pass.
  const result = new Uint8Array(entry.uncompressedSize);
  let size = 0;
  await entry.getData(new WritableStream<Uint8Array>({
    write(chunk) {
      if (size + chunk.length > result.length) throw new Error('Extracted size exceeds the declared size or file limit.');
      result.set(chunk, size);
      size += chunk.length;
    },
  }), { checkSignature: true });
  if (size !== entry.uncompressedSize) throw new Error('Extracted size does not match the ZIP directory.');
  return result;
}
