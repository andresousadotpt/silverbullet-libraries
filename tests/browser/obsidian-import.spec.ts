import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js/index-native.js';

async function fixture(punctuation = false) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, useCompressionStream: false });
  await writer.add(punctuation ? 'Vault/Notes/What? #1 @work <draft>.md' : 'Vault/Notes/deep/Café.md', new Uint8ArrayReader(new TextEncoder().encode('# Café\r\n[[Other]]')));
  await writer.add('Vault/assets/image.png', new Uint8ArrayReader(new Uint8Array([0, 255, 128])));
  await writer.add('Vault/.obsidian/config.json', new Uint8ArrayReader(new TextEncoder().encode('{}')));
  return Array.from(await writer.close());
}

for (const scenario of ['import', 'read-only', 'cancel', 'failure', 'existing', 'punctuation'] as const) {
  test(`compiled Obsidian import command: ${scenario}`, async ({ page }) => {
    await page.route('**/obsidian-import.plug.js', async route => route.fulfill({ contentType: 'text/javascript', body: await readFile('dist/obsidian-import.plug.js') }));
    await page.goto('/');
    const result = await page.evaluate(({ bytes, scenario }) => new Promise<{
      writes: { path: string; bytes: number[] }[]; notifications: string[]; report: string; previews: string[]; calls: string[];
    }>((resolve, reject) => {
      const worker = new Worker('/obsidian-import.plug.js', { type: 'module' });
      const state = { writes: [] as { path: string; bytes: number[] }[], notifications: [] as string[], report: '', previews: [] as string[], calls: [] as string[] };
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Import timed out')); }, 15000);
      worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = event => {
        const msg = event.data;
        if (msg.type === 'manifest') { worker.postMessage({ type: 'inv', id: 1, name: 'importZip', args: [] }); return; }
        if (msg.type === 'invr') { clearTimeout(timeout); worker.terminate(); if (msg.error) reject(new Error(msg.error)); else resolve(state); return; }
        if (msg.type !== 'sys') return;
        state.calls.push(msg.name);
        let result: unknown, error: string | undefined;
        switch (msg.name) {
          case 'system.getMode': result = scenario === 'read-only' ? 'ro' : 'rw'; break;
          case 'editor.getUiOption': result = false; break;
          case 'editor.uploadFile': result = { name: 'vault.zip', content: new Uint8Array(bytes) }; break;
          case 'editor.prompt': result = 'Imported'; break;
          case 'editor.confirm': state.previews.push(msg.args[0]); result = scenario !== 'cancel' || !msg.args[0].includes('Start import?'); break;
          case 'space.listFiles': result = scenario === 'existing' ? [{ name: 'Imported/Notes/deep/Café.md' }] : []; break;
          case 'space.fileExists': result = false; break;
          case 'space.writeFile':
            if (scenario === 'failure' && state.writes.length === 1) error = 'Synthetic disk failure';
            else state.writes.push({ path: msg.args[0], bytes: Array.from(msg.args[1]) });
            break;
          case 'editor.flashNotification': state.notifications.push(msg.args[0]); break;
          case 'editor.showPanel': state.report = msg.args[2]; break;
          default: error = 'Unexpected syscall: ' + msg.name;
        }
        worker.postMessage({ type: 'sysr', id: msg.id, result, error });
      };
    }), { bytes: await fixture(scenario === 'punctuation'), scenario });
    expect(result.calls).not.toContain('sandboxFetch.fetch');
    if (scenario === 'read-only' || scenario === 'cancel') {
      expect(result.writes).toHaveLength(0);
      if (scenario === 'read-only') expect(result.calls).not.toContain('editor.uploadFile');
    } else if (scenario === 'failure') {
      expect(result.writes).toHaveLength(1);
      expect(result.report).toContain('Synthetic disk failure');
      expect(result.report).toContain('1 imported, 1 skipped, 1 failed');
    } else if (scenario === 'existing') {
      expect(result.writes).toEqual([{ path: 'Imported/assets/image.png', bytes: [0, 255, 128] }]);
      expect(result.report).toContain('1 imported, 2 skipped, 0 failed');
    } else {
      expect(result.writes).toEqual([
        { path: scenario === 'punctuation' ? 'Imported/Notes/What? #1 @work <draft>.md' : 'Imported/Notes/deep/Café.md', bytes: Array.from(new TextEncoder().encode('# Café\r\n[[Other]]')) },
        { path: 'Imported/assets/image.png', bytes: [0, 255, 128] },
      ]);
      expect(result.report).toContain('2 imported, 1 skipped, 0 failed');
      expect(result.previews[1]).toContain('1 Markdown notes, 1 attachments');
      if (scenario === 'punctuation') {
        expect(result.report).toContain('What? #1 @work &lt;draft&gt;.md');
        expect(result.report).not.toContain('<draft>');
      }
    }
  });
}
