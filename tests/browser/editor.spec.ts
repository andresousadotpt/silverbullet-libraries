import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
const ui = (page: Page) => page.frameLocator('iframe');
// Playwright runs the browser tests on macOS locally and Linux in CI.
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function select(page: Page, address: string) {
  const frame = ui(page);
  const { r, c } = XLSX.utils.decode_cell(address);
  // FortuneSheet's cell area starts below the column header; its default cells
  // are 73 × 20 px. The test workbook stays within this initial viewport.
  await frame.locator('.fortune-cell-area').click({ position: { x: c * 73 + 36, y: r * 20 + 10 } });
}
async function saved(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__host.saved)).not.toBeNull();
  const bytes = await page.evaluate(() => (window as any).__host.saved as number[]);
  return XLSX.read(new Uint8Array(bytes), { type: 'array' });
}
async function edit(page: Page, address: string, value: string) {
  const frame = ui(page);
  await select(page, address);
  const input = frame.locator('.fortune-fx-input');
  await input.click();
  await input.press(`${primaryModifier}+A`);
  await input.press('Backspace');
  await input.pressSequentially(value);
  await input.press('Enter');
}

async function display(page: Page, address: string, expected: string) {
  const frame = ui(page);
  await select(page, address);
  await expect(frame.getByLabel('Selected cell display')).toHaveText(expected);
}

test('view, edit, calculate, paste, undo and save with an exact original backup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const frame = ui(page);
  await expect(frame.locator('#filename')).toHaveText('Example budget.xlsx');
  await display(page, 'D5', '14');
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'false');
  await page.evaluate(() => (window as any).__host.send('request-save'));
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__host.saved) === JSON.stringify((window as any).__host.original))).toBe(true);
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'true');
  const backup = await page.evaluate(() => {
    const host = (window as any).__host;
    return { name: host.writes[0].name, exact: JSON.stringify(host.writes[0].bytes) === JSON.stringify(host.original) };
  });
  expect(backup).toEqual({ name: 'Example budget.original.xlsx', exact: true });
  await edit(page, 'B2', '10');
  await display(page, 'D5', '38');
  await expect.poll(async () => (await saved(page)).Sheets.Budget.B2.v).toBe(10);
  expect((await saved(page)).Sheets.Budget.D5.f).toBe('SUM(D2:D3)');
  await frame.getByRole('button', { name: 'Undo', exact: true }).click();
  await display(page, 'B2', '2');
  await frame.getByRole('button', { name: 'Redo', exact: true }).click();
  await display(page, 'B2', '10');
  await display(page, 'A7', '');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4179' });
  await page.evaluate(() => navigator.clipboard.writeText('One\t2\nTwo\t3'));
  await frame.locator('.fortune-cell-area').press(`${primaryModifier}+V`);
  await display(page, 'A8', 'Two');
  await frame.locator('.luckysheet-sheets-item-name').filter({ hasText: /^Notes$/ }).click();
  await display(page, 'A2', 'Synthetic example workbook');
  expect(errors).toEqual([]);
});

test('reopening a file and enabling editing again reuses the single original backup', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'true');
  expect(await page.evaluate(() => (window as any).__host.writes.map((w: { name: string }) => w.name)))
    .toEqual(['Example budget.original.xlsx']);
  await page.evaluate(() => (window as any).__host.load());
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'false');
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'true');
  expect(await page.evaluate(() => (window as any).__host.writes)).toHaveLength(1);
  await expect(frame.locator('#notice')).toContainText('Example budget.original.xlsx');
});

test('read-only modes and failed backups cannot enable editing', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await expect(frame.getByRole('button', { name: 'Enable editing' })).toBeEnabled();
  await page.evaluate(() => { const host = (window as any).__host; host.mode = 'ro'; host.load(); });
  await expect(frame.locator('#notice')).toContainText('Read-only');
  await expect(frame.getByRole('button', { name: 'Enable editing' })).toBeDisabled();
  await page.evaluate(() => { const host = (window as any).__host; host.mode = 'rw'; host.load('Read only.xlsx', host.original, 'ro'); });
  await expect(frame.locator('#filename')).toHaveText('Read only.xlsx');
  await expect(frame.getByRole('button', { name: 'Enable editing' })).toBeDisabled();
  await page.evaluate(() => { const host = (window as any).__host; host.failBackup = true; host.load(); });
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.locator('#notice')).toHaveText('Backup write failed');
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'false');
  expect(await page.evaluate(() => (window as any).__host.writes)).toEqual([]);
});

test('pending formula input is committed on save; file switching resets edit permissions', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'true');
  await select(page, 'A1');
  await frame.locator('.fortune-fx-input').click();
  await frame.locator('.fortune-fx-input').press(`${primaryModifier}+A`);
  await frame.locator('.fortune-fx-input').press('Backspace');
  await frame.locator('.fortune-fx-input').pressSequentially('Edited heading');
  await frame.locator('.fortune-fx-input').press('Enter');
  await page.evaluate(() => (window as any).__host.send('request-save'));
  await expect.poll(async () => (await saved(page)).Sheets.Budget.A1.v).toBe('Edited heading');
  await page.evaluate(() => (window as any).__host.load('Next.xlsx'));
  await expect(frame.locator('#filename')).toHaveText('Next.xlsx');
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'false');
  await display(page, 'A1', 'Item');
});

test('cell text cannot become executable HTML and native formulas recalculate', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await edit(page, 'A1', '<img src=x onerror="alert(1)">');
  expect(await frame.locator('#viewport img').count()).toBe(0);
  await edit(page, 'C3', '=1+2');
  await display(page, 'C3', '3');
  await expect.poll(async () => (await saved(page)).Sheets.Budget.C3?.v).toBe(3);
  await page.screenshot({ path: 'test-results/editor-light.png' });
  await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({type:'set-theme',internal:true,data:{theme:'dark'}}, '*'));
  await page.screenshot({ path: 'test-results/editor-dark.png' });
});

test('compiled plug loads as a worker and provides its editor manifest and HTML', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => new Promise<{ extensions: string[]; html: string }>((resolve, reject) => {
    const worker = new Worker('/spreadsheet.plug.js', { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Worker initialization timed out')); }, 10_000);
    let extensions: string[];
    worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message)); };
    worker.onmessage = event => {
      if (event.data.type === 'manifest') {
        extensions = event.data.manifest.functions.spreadsheetEditor.editor;
        worker.postMessage({ type: 'inv', id: 1, name: 'spreadsheetEditor', args: [] });
      } else if (event.data.type === 'invr') {
        clearTimeout(timeout); worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve({ extensions, html: event.data.result.html });
      }
    };
  }));
  expect(result.extensions).toEqual(['xlsx', 'xls', 'ods', 'csv', 'tsv']);
  expect(result.html).toContain('Spreadsheet grid');
  const externalScripts = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script[src]').length, result.html);
  expect(externalScripts).toBe(0);
});

test('CSV editing saves UTF-8 text with the original delimiter', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  const bytes = Array.from(new TextEncoder().encode('Name,Code\nOlá,0012\n'));
  await page.evaluate(bytes => (window as any).__host.load('Data.csv', bytes), bytes);
  await expect(frame.locator('#filename')).toHaveText('Data.csv');
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await edit(page, 'A2', 'Olá again');
  await expect.poll(async () => page.evaluate(() => new TextDecoder().decode(new Uint8Array((window as any).__host.saved ?? []))))
    .toContain('Olá again,0012');
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'true');
});

test('legacy XLS conversion creates a separate XLSX workbook', async ({ page }) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Legacy'], [7]]), 'Old');
  const bytes = Array.from(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'biff8' })));
  await page.goto('/'); const frame = ui(page);
  await page.evaluate(bytes => (window as any).__host.load('Legacy.xls', bytes), bytes);
  await frame.getByRole('button', { name: 'Convert to XLSX' }).click();
  await expect(frame.locator('#filename')).toHaveText('Legacy.converted.xlsx');
  await display(page, 'A2', '7');
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'false');
  const writes = await page.evaluate(() => (window as any).__host.writes as {name: string}[]);
  expect(writes).toHaveLength(1);
  expect(writes[0].name).toMatch(/\.xlsx$/);
  // Converting again opens the existing copy instead of writing a duplicate.
  await page.evaluate(bytes => (window as any).__host.load('Legacy.xls', bytes), bytes);
  await frame.getByRole('button', { name: 'Convert to XLSX' }).click();
  await expect(frame.locator('#filename')).toHaveText('Legacy.converted.xlsx');
  expect(await page.evaluate(() => (window as any).__host.writes)).toHaveLength(1);
});

test('Spreadsheet: New creates a valid workbook through the compiled worker', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => new Promise<{ path: string; bytes: number[] }>((resolve, reject) => {
    const worker = new Worker('/spreadsheet.plug.js', { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Command timed out')); }, 10_000);
    let path = '', bytes: number[] = [];
    worker.onmessage = event => {
      const data = event.data;
      if (data.type === 'manifest') worker.postMessage({ type: 'inv', id: 1, name: 'newSpreadsheet', args: [] });
      if (data.type === 'sys') {
        let result: unknown;
        if (data.name === 'system.getMode') result = 'rw';
        if (data.name === 'editor.getUiOption' || data.name === 'space.fileExists') result = false;
        if (data.name === 'editor.prompt') result = 'Example.xlsx';
        if (data.name === 'space.writeDocument') { path = data.args[0]; bytes = Array.from(data.args[1]); }
        worker.postMessage({ type: 'sysr', id: data.id, result });
      }
      if (data.type === 'invr') {
        clearTimeout(timeout); worker.terminate();
        if (data.error) reject(new Error(data.error)); else resolve({ path, bytes });
      }
    };
    worker.onerror = e => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message)); };
  }));
  expect(result.path).toBe('Example.xlsx');
  expect(XLSX.read(new Uint8Array(result.bytes)).SheetNames).toEqual(['Sheet1']);
});

test('imported bracketed references display and recalculate in the compiled editor', async ({ page }) => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[10, 4]]);
  sheet.C1 = { t: 'n', f: 'A1+[.$B$1]', v: 14 };
  sheet.D1 = { t: 'n', f: 'SUM([.A1:.B1];[.C1])', v: 28 };
  sheet['!ref'] = 'A1:D1';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Example');
  const bytes = Array.from(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
  await page.goto('/'); const frame = ui(page);
  await page.evaluate(bytes => (window as any).__host.load('References.xlsx', bytes), bytes);
  await display(page, 'C1', '14');
  await display(page, 'D1', '28');
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await edit(page, 'B1', '6');
  await display(page, 'C1', '16');
  await display(page, 'D1', '32');
  await expect.poll(async () => (await saved(page)).Sheets.Example.C1.v).toBe(16);
  expect((await saved(page)).Sheets.Example.C1.f).toBe('A1+[.$B$1]');
});

test('native formula editor inserts cell references and reopening preserves data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); const frame = ui(page);
  await expect(frame.locator('canvas').first()).toBeVisible();
  await frame.locator('#enable').click();
  await select(page, 'B2');
  const area = frame.locator('.fortune-cell-area');
  const input = frame.locator('.fortune-fx-input');
  await area.press('=');
  await select(page, 'C2');
  await expect(input).toHaveText('=C2');
  await area.press('Enter');
  await expect.poll(async () => (await saved(page)).Sheets.Budget.B2.f).toBe('C2');
  await display(page, 'B2', '3');
  await page.evaluate(() => { const host = (window as any).__host; host.load('Reopened.xlsx', host.saved); });
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'false');
  await display(page, 'B2', '3');
  await display(page, 'D5', '17');
  expect(errors).toEqual([]);
});

test('oversized views preserve original bytes and cannot enable editing', async ({ page }) => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Small content, huge extent']]);
  sheet['!ref'] = 'A1:ZZ10000';
  XLSX.utils.book_append_sheet(book, sheet, 'Large');
  const bytes = Array.from(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
  await page.goto('/'); const frame = ui(page);
  await page.evaluate(bytes => (window as any).__host.load('Large.xlsx', bytes), bytes);
  await expect(frame.locator('#notice')).toContainText('view limit');
  await expect(frame.locator('#enable')).toBeDisabled();
  await expect(frame.locator('#download')).toBeEnabled();
  await page.evaluate(() => (window as any).__host.send('request-save'));
  await expect.poll(() => page.evaluate(() => (window as any).__host.saved)).toEqual(bytes);
});

test('forced read-only prevents keyboard edits and preview emits no change events', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await page.evaluate(() => { const host = (window as any).__host; host.forcedRO = true; host.messages = []; host.load(); });
  await expect(frame.locator('#notice')).toContainText('Read-only');
  await expect(frame.locator('#enable')).toBeDisabled();
  await frame.locator('#viewport').press('Delete');
  await frame.locator('#viewport').press('a');
  await frame.locator('.luckysheet-sheets-item-name').filter({ hasText: /^Notes$/ }).click();
  await expect(frame.getByLabel('Selected cell display')).toHaveText('Notes');
  expect(await page.evaluate(() => (window as any).__host.messages.filter((m: string) => m === 'file-changed'))).toEqual([]);
});

test('a backup completing after a file switch never unlocks the next file', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await page.evaluate(() => { (window as any).__host.pauseBackup = true; });
  await frame.locator('#enable').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__host.releaseBackup)).toBe('function');
  await page.evaluate(() => { const host = (window as any).__host; host.load('Next.xlsx'); host.releaseBackup(); });
  await expect(frame.locator('#filename')).toHaveText('Next.xlsx');
  await expect(frame.locator('#enable')).toHaveText('Enable editing');
  await expect(frame.locator('.fortune-fx-input')).toHaveAttribute('contenteditable', 'false');
  await page.evaluate(() => (window as any).__host.send('request-save'));
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__host.saved) === JSON.stringify((window as any).__host.original))).toBe(true);
  expect(await page.evaluate(() => (window as any).__host.writes.map((w: { name: string }) => w.name))).toEqual(['Example budget.original.xlsx']);
});

test('cyclic and network formulas are bounded and workbook content causes no network requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4179')) external.push(req.url()); });
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['<img src="https://example.invalid/image" onerror="alert(1)">']]);
  sheet.B1 = { t: 'n', f: 'B1+1', v: 10 };
  sheet.C1 = { t: 's', f: 'WEBSERVICE("https://example.invalid/")', v: 'cached' };
  sheet['!ref'] = 'A1:C1';
  XLSX.utils.book_append_sheet(book, sheet, 'Safety');
  const bytes = Array.from(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
  await page.goto('/'); const frame = ui(page);
  await page.evaluate(bytes => (window as any).__host.load('Safety.xlsx', bytes), bytes);
  await display(page, 'B1', '#ERROR!');
  await display(page, 'C1', '#ERROR!');
  await frame.locator('#enable').click();
  await edit(page, 'D1', 'saved');
  expect((await saved(page)).Sheets.Safety.B1.f).toBe('B1+1');
  expect((await saved(page)).Sheets.Safety.C1.f).toBe('WEBSERVICE("https://example.invalid/")');
  expect(await frame.locator('#viewport img').count()).toBe(0);
  expect(external).toEqual([]);
});
