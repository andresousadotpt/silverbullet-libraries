import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
const ui = (page: Page) => page.frameLocator('iframe');
async function saved(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__host.saved)).not.toBeNull();
  const bytes = await page.evaluate(() => (window as any).__host.saved as number[]);
  return XLSX.read(new Uint8Array(bytes), { type: 'array' });
}
async function edit(page: Page, address: string, value: string) {
  const frame = ui(page);
  await frame.getByLabel('Go to cell').fill(address);
  await frame.getByLabel('Go to cell').press('Enter');
  await frame.getByLabel('Cell value or formula').fill(value);
  await frame.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('view, edit, calculate, paste, undo and save with an exact original backup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const frame = ui(page);
  await expect(frame.getByRole('heading')).toHaveText('Example budget.xlsx');
  await expect(frame.locator('td[data-row="4"][data-col="3"]')).toHaveText('14');
  await expect(frame.getByLabel('Cell value or formula')).toHaveAttribute('readonly', '');
  await page.evaluate(() => (window as any).__host.send('request-save'));
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__host.saved) === JSON.stringify((window as any).__host.original))).toBe(true);
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.getByLabel('Cell value or formula')).not.toHaveAttribute('readonly', '');
  const backupMatches = await page.evaluate(() => JSON.stringify((window as any).__host.writes[0].bytes) === JSON.stringify((window as any).__host.original));
  expect(backupMatches).toBe(true);
  await edit(page, 'B2', '10');
  await expect(frame.locator('td[data-row="4"][data-col="3"]')).toHaveText('38');
  await expect.poll(async () => (await saved(page)).Sheets.Budget.B2.v).toBe(10);
  expect((await saved(page)).Sheets.Budget.D5.f).toBe('SUM(D2:D3)');
  await frame.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(frame.locator('td[data-row="1"][data-col="1"]')).toHaveText('2');
  await frame.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(frame.locator('td[data-row="1"][data-col="1"]')).toHaveText('10');
  await frame.locator('td[data-row="6"][data-col="0"]').click();
  await frame.locator('#grid').evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'One\t2\nTwo\t3');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
  });
  await expect(frame.locator('td[data-row="7"][data-col="0"]')).toHaveText('Two');
  await frame.getByRole('tab', { name: 'Notes', exact: true }).click();
  await expect(frame.locator('td[data-row="1"][data-col="0"]')).toHaveText('Synthetic example workbook');
  expect(errors).toEqual([]);
});

test('read-only modes and failed backups cannot enable editing', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await expect(frame.getByRole('button', { name: 'Enable editing' })).toBeEnabled();
  await page.evaluate(() => { const host = (window as any).__host; host.mode = 'ro'; host.load(); });
  await expect(frame.locator('#notice')).toContainText('Read-only');
  await expect(frame.getByRole('button', { name: 'Enable editing' })).toBeDisabled();
  await page.evaluate(() => { const host = (window as any).__host; host.mode = 'rw'; host.load('Read only.xlsx', host.original, 'ro'); });
  await expect(frame.getByRole('heading')).toHaveText('Read only.xlsx');
  await expect(frame.getByRole('button', { name: 'Enable editing' })).toBeDisabled();
  await page.evaluate(() => { const host = (window as any).__host; host.failBackup = true; host.load(); });
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.locator('#notice')).toHaveText('Backup write failed');
  await expect(frame.getByLabel('Cell value or formula')).toHaveAttribute('readonly', '');
  expect(await page.evaluate(() => (window as any).__host.writes)).toEqual([]);
});

test('pending formula input is committed on save; file switching resets edit permissions', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await expect(frame.getByLabel('Cell value or formula')).not.toHaveAttribute('readonly', '');
  await frame.getByLabel('Cell value or formula').fill('Edited heading');
  await page.evaluate(() => (window as any).__host.send('request-save'));
  await expect.poll(async () => (await saved(page)).Sheets.Budget.A1.v).toBe('Edited heading');
  await page.evaluate(() => (window as any).__host.load('Next.xlsx'));
  await expect(frame.getByRole('heading')).toHaveText('Next.xlsx');
  await expect(frame.getByLabel('Cell value or formula')).toHaveAttribute('readonly', '');
  await expect(frame.locator('td[data-row="0"][data-col="0"]')).toHaveText('Item');
});

test('cell text cannot become executable HTML; sheets can be added and reopened', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await edit(page, 'A1', '<img src=x onerror="alert(1)">');
  expect(await frame.locator('#grid img').count()).toBe(0);
  page.once('dialog', dialog => dialog.accept('Extra'));
  await frame.getByRole('button', { name: '+ Sheet', exact: true }).click();
  await expect(frame.getByRole('tab', { name: 'Extra', exact: true })).toHaveAttribute('aria-selected', 'true');
  await edit(page, 'C3', '=1+2');
  await expect(frame.locator('td[data-row="2"][data-col="2"]')).toHaveText('3');
  await expect.poll(async () => (await saved(page)).Sheets.Extra?.C3?.v).toBe(3);
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
  expect(result.html).toContain('Cell value or formula');
  const externalScripts = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script[src]').length, result.html);
  expect(externalScripts).toBe(0);
});

test('CSV editing saves UTF-8 text with the original delimiter', async ({ page }) => {
  await page.goto('/'); const frame = ui(page);
  const bytes = Array.from(new TextEncoder().encode('Name,Code\nOlá,0012\n'));
  await page.evaluate(bytes => (window as any).__host.load('Data.csv', bytes), bytes);
  await expect(frame.getByRole('heading')).toHaveText('Data.csv');
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await edit(page, 'A2', 'Olá again');
  await expect.poll(async () => page.evaluate(() => new TextDecoder().decode(new Uint8Array((window as any).__host.saved ?? []))))
    .toContain('Olá again,0012');
  await expect(frame.getByRole('button', { name: '+ Sheet', exact: true })).toBeDisabled();
});

test('legacy XLS conversion creates a separate XLSX workbook', async ({ page }) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Legacy'], [7]]), 'Old');
  const bytes = Array.from(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'biff8' })));
  await page.goto('/'); const frame = ui(page);
  await page.evaluate(bytes => (window as any).__host.load('Legacy.xls', bytes), bytes);
  await frame.getByRole('button', { name: 'Convert to XLSX' }).click();
  await expect(frame.getByRole('heading')).toHaveText(/Legacy\.converted-.*\.xlsx/);
  await expect(frame.locator('td[data-row="1"][data-col="0"]')).toHaveText('7');
  await expect(frame.getByLabel('Cell value or formula')).toHaveAttribute('readonly', '');
  const writes = await page.evaluate(() => (window as any).__host.writes as {name: string}[]);
  expect(writes).toHaveLength(1);
  expect(writes[0].name).toMatch(/\.xlsx$/);
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
  await expect(frame.locator('td[data-row="0"][data-col="2"]')).toHaveText('14');
  await expect(frame.locator('td[data-row="0"][data-col="3"]')).toHaveText('28');
  await frame.getByRole('button', { name: 'Enable editing' }).click();
  await edit(page, 'B1', '6');
  await expect(frame.locator('td[data-row="0"][data-col="2"]')).toHaveText('16');
  await expect(frame.locator('td[data-row="0"][data-col="3"]')).toHaveText('32');
  await expect.poll(async () => (await saved(page)).Sheets.Example.C1.v).toBe(16);
  expect((await saved(page)).Sheets.Example.C1.f).toBe('A1+[.$B$1]');
});
