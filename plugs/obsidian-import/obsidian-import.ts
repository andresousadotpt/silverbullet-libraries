import { syscall } from '@silverbulletmd/silverbullet/syscall';
import { openArchive, createPlan, type Archive } from './src/archive.ts';
import { importPlan, type ImportResult } from './src/importer.ts';

let running = false;
const readOnly = async () => await syscall('system.getMode') === 'ro' || Boolean(await syscall('editor.getUiOption', 'forcedROMode'));
const notify = (message: string, type = 'info') => syscall('editor.flashNotification', message, type);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

async function showReport(result: ImportResult) {
  const summary = `${result.written.length} imported, ${result.skipped.length} skipped, ${result.renamed.length} renamed, ${result.failed.length} failed.`;
  const report = [summary, result.stopped ?? '', ...result.renamed.map(item => `RENAMED ${item.from} → ${item.to}: ${item.reason}`), ...result.failed.map(item => `FAILED ${item.path}: ${item.reason}`),
    ...result.skipped.map(item => `SKIPPED ${item.path}: ${item.reason}`), ...result.written.map(path => `IMPORTED ${path}`)].join('\n');
  await syscall('editor.showPanel', 'rhs', 1, `<style>:root{color-scheme:light dark}body{background:Canvas;color:CanvasText;font:14px system-ui;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h2>Obsidian import report</h2><button id="close">Close</button><pre>${escapeHtml(report)}</pre>`,
    `document.getElementById('close').onclick = () => syscall('editor.hidePanel', 'rhs');`);
  await notify(summary, result.failed.length ? 'error' : 'info');
}

export async function importZip() {
  let archive: Archive | undefined;
  let ownsLock = false;
  try {
    if (running) { await notify('An Obsidian import is already in progress.'); return; }
    if (await readOnly()) { await notify('This space is read-only.', 'error'); return; }
    // Do not lock while the native file picker is open: some browsers do not
    // resolve SilverBullet's upload promise when the picker is cancelled.
    const uploaded = await syscall('editor.uploadFile', '.zip,application/zip') as { name: string; content: Uint8Array } | undefined;
    if (!uploaded) return;
    if (running) { await notify('An Obsidian import is already in progress.'); return; }
    running = ownsLock = true;
    archive = await openArchive(uploaded.content);
    const destination = await syscall('editor.prompt', 'Destination folder (empty for space root)', 'Obsidian import') as string | null | undefined;
    if (destination == null) return;
    const strip = archive.wrapper ? Boolean(await syscall('editor.confirm', `Remove the enclosing “${archive.wrapper}” folder? Subfolders inside it will be preserved. Cancel keeps the enclosing folder.`)) : false;
    const existing = await syscall('space.listFiles') as { name: string }[];
    const plan = createPlan(archive, destination.trim(), strip, existing.map(file => file.name));
    const notes = plan.files.filter(file => file.path.toLowerCase().endsWith('.md')).length;
    const preview = [`Import to ${destination.trim() || 'space root'}:`, `${notes} Markdown notes, ${plan.files.length - notes} attachments; ${plan.skipped.length} skipped.`,
      `${plan.renamed.length} paths will be renamed for SilverBullet compatibility; the report records each mapping. Existing files are skipped. Note contents remain unchanged; Obsidian links, embeds and plugin syntax are not converted.`,
      'Import only a trusted vault: SilverBullet can execute Space Lua in Markdown.',
      ...plan.files.slice(0, 15).map(file => file.path), plan.files.length > 15 ? `…and ${plan.files.length - 15} more files.` : '',
      'Start import?'].filter(Boolean).join('\n');
    if (!plan.files.length) { await showReport({ written: [], skipped: plan.skipped, renamed: plan.renamed, failed: [] }); return; }
    if (!await syscall('editor.confirm', preview)) return;
    await notify(`Importing ${plan.files.length} files…`);
    const result = await importPlan(plan, {
      readOnly,
      exists: path => syscall('space.fileExists', path),
      write: (path, bytes) => syscall('space.writeFile', path, bytes),
      progress: (done, total) => notify(`Obsidian import: ${done}/${total} processed…`),
    });
    await showReport(result);
  } catch (error) { await notify(`Obsidian import: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
  finally { await archive?.close(); if (ownsLock) running = false; }
}
