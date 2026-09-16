import { syscall } from '@silverbulletmd/silverbullet/syscall';
import { utils, write } from 'xlsx';
import html from './generated/editor.ts';

export function spreadsheetEditor() {
  return { html };
}

export async function newSpreadsheet() {
  if (await syscall('system.getMode') === 'ro' || await syscall('editor.getUiOption', 'forcedROMode')) {
    await syscall('editor.flashNotification', 'This space is read-only.', 'error');
    return;
  }
  let name = await syscall('editor.prompt', 'New spreadsheet path', 'Spreadsheet.xlsx');
  if (!name?.trim()) return;
  name = name.trim();
  if (!name.toLowerCase().endsWith('.xlsx')) name += '.xlsx';
  if (name.startsWith('/') || name.split('/').some((part: string) => part === '..' || !part)) {
    throw new Error('Use a relative space path without empty or parent directory segments.');
  }
  if (await syscall('space.fileExists', name)) {
    await syscall('editor.flashNotification', 'That file already exists. Choose a different name.', 'error');
    return;
  }
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([['']]), 'Sheet1');
  const bytes = new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' }));
  await syscall('space.writeDocument', name, bytes);
  await syscall('editor.navigate', { path: name });
}
