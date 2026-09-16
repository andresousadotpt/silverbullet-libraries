import { utils } from 'xlsx';
import { MAX_COLS, MAX_ROWS, parseClipboard, SpreadsheetModel } from './model.ts';

type Bridge = EventTarget & {
  syscall(name: string, ...args: unknown[]): Promise<any>;
  sendMessage(type: string, data?: unknown): void;
};
declare global { interface Window { silverbullet: Bridge } }
const bridge = window.silverbullet;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const formula = element<HTMLInputElement>('formula');
const address = element<HTMLInputElement>('address');
const grid = element<HTMLTableElement>('grid');
const notice = element('notice');
const status = element('status');
const ROW_WINDOW = 60, COL_WINDOW = 16;
let model: SpreadsheetModel | undefined;
let sheet = '', filename = '', generation = 0;
let editable = false, writable = false, enabling = false;
let row = 0, col = 0, anchorRow = 0, anchorCol = 0;
let rowStart = 0, colStart = 0;
let permissionReady: Promise<void> = Promise.resolve();

function message(text: string, error = false) {
  notice.textContent = text; notice.classList.toggle('error', error);
}
function report(error: unknown) { message(error instanceof Error ? error.message : String(error), true); }
function cellAddress(r = row, c = col) { return utils.encode_cell({ r, c }); }
function selection() {
  return { top: Math.min(row, anchorRow), bottom: Math.max(row, anchorRow),
    left: Math.min(col, anchorCol), right: Math.max(col, anchorCol) };
}
function updateControls() {
  element<HTMLButtonElement>('enable').disabled = !model || !writable || editable || enabling;
  element<HTMLButtonElement>('enable').textContent = editable ? 'Editing enabled' : enabling ? 'Preparing…' : model?.format === 'xls' ? 'Convert to XLSX' : 'Enable editing';
  element<HTMLButtonElement>('undo').disabled = !editable || !model?.canUndo;
  element<HTMLButtonElement>('redo').disabled = !editable || !model?.canRedo;
  element<HTMLButtonElement>('save').disabled = !editable;
  element<HTMLButtonElement>('apply').disabled = !editable;
  element<HTMLButtonElement>('download').disabled = !model;
  element<HTMLButtonElement>('add-sheet').disabled = !editable || !!model?.textFormat;
  formula.readOnly = !editable;
}
function updateSelection() {
  const range = selection();
  for (const cell of grid.querySelectorAll<HTMLTableCellElement>('td')) {
    const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
    cell.classList.toggle('selected', r >= range.top && r <= range.bottom && c >= range.left && c <= range.right);
    const active = r === row && c === col;
    cell.classList.toggle('active', active); cell.tabIndex = active ? 0 : -1;
    cell.setAttribute('aria-selected', String(cell.classList.contains('selected')));
  }
  address.value = cellAddress();
  formula.value = model?.input(sheet, row, col) ?? '';
  status.textContent = `${sheet} · ${cellAddress(range.top, range.left)}${range.top !== range.bottom || range.left !== range.right ? ':' + cellAddress(range.bottom, range.right) : ''}`;
}
function render() {
  if (!model) return;
  const header = document.createElement('tr');
  header.append(document.createElement('th'));
  for (let c = colStart; c < Math.min(colStart + COL_WINDOW, MAX_COLS); c++) {
    const th = document.createElement('th'); th.textContent = utils.encode_col(c); th.scope = 'col'; header.append(th);
  }
  grid.tHead!.replaceChildren(header);
  const body = document.createDocumentFragment();
  for (let r = rowStart; r < Math.min(rowStart + ROW_WINDOW, MAX_ROWS); r++) {
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.textContent = String(r + 1); th.scope = 'row'; tr.append(th);
    for (let c = colStart; c < Math.min(colStart + COL_WINDOW, MAX_COLS); c++) {
      const td = document.createElement('td');
      td.dataset.row = String(r); td.dataset.col = String(c);
      const value = model.display(sheet, r, c);
      td.textContent = value; td.title = value; td.setAttribute('role', 'gridcell');
      td.setAttribute('aria-label', `${cellAddress(r, c)}${value ? ': ' + value : ''}`);
      const cell = model.sheet(sheet)[cellAddress(r, c)];
      if (cell?.t === 'n') td.classList.add('numeric');
      if (cell?.f) td.classList.add('formula');
      if (value.startsWith('#')) td.classList.add('error-cell');
      tr.append(td);
    }
    body.append(tr);
  }
  grid.tBodies[0].replaceChildren(body);
  const tabs = document.createDocumentFragment();
  for (const name of model.sheetNames) {
    const button = document.createElement('button'); button.textContent = name;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(name === sheet));
    button.onclick = () => {
      if (!commitInput()) return;
      sheet = name; row = col = anchorRow = anchorCol = rowStart = colStart = 0; render();
    };
    tabs.append(button);
  }
  element('sheets').replaceChildren(tabs);
  element('range').textContent = `${cellAddress(rowStart, colStart)}–${cellAddress(Math.min(rowStart + ROW_WINDOW, MAX_ROWS) - 1, Math.min(colStart + COL_WINDOW, MAX_COLS) - 1)}`;
  element<HTMLButtonElement>('prev-rows').disabled = rowStart === 0;
  element<HTMLButtonElement>('prev-cols').disabled = colStart === 0;
  element<HTMLButtonElement>('next-rows').disabled = rowStart + ROW_WINDOW >= MAX_ROWS;
  element<HTMLButtonElement>('next-cols').disabled = colStart + COL_WINDOW >= MAX_COLS;
  updateSelection(); updateControls();
}
function focusCell() { grid.querySelector<HTMLElement>('td.active')?.focus({ preventScroll: true }); }
function select(r: number, c: number, extend = false) {
  row = Math.max(0, Math.min(r, MAX_ROWS - 1)); col = Math.max(0, Math.min(c, MAX_COLS - 1));
  if (!extend) { anchorRow = row; anchorCol = col; }
  if (row < rowStart || row >= rowStart + ROW_WINDOW || col < colStart || col >= colStart + COL_WINDOW) {
    rowStart = Math.floor(row / ROW_WINDOW) * ROW_WINDOW;
    colStart = Math.floor(col / COL_WINDOW) * COL_WINDOW; render();
  } else updateSelection();
  focusCell();
}
function changed(action: () => void) {
  if (!model || !editable) return false;
  try {
    action();
    if (!model.sheetNames.includes(sheet)) sheet = model.sheetNames[0];
    render(); bridge.sendMessage('file-changed'); status.textContent = 'Changes pending save';
    return true;
  } catch (error) { report(error); return false; }
}
function commitInput() {
  if (!model || !editable || formula.value === model.input(sheet, row, col)) return true;
  const value = formula.value;
  return changed(() => model!.setCells(sheet, row, col, [[value]]));
}

bridge.addEventListener('file-open', (event) => {
  const token = ++generation;
  const { data, meta } = (event as CustomEvent).detail;
  model = undefined; editable = writable = enabling = false;
  row = col = anchorRow = anchorCol = rowStart = colStart = 0;
  filename = meta.name; element('filename').textContent = filename;
  formula.value = ''; grid.tBodies[0].replaceChildren(); grid.tHead!.replaceChildren(); element('sheets').replaceChildren();
  updateControls();
  try {
    model = new SpreadsheetModel(new Uint8Array(data), filename);
    sheet = model.sheetNames[0];
    element('subtitle').textContent = `${model.format.toUpperCase()} · ${model.sheetNames.length} sheet${model.sheetNames.length === 1 ? '' : 's'} · Preview`;
    message('Checking editing permissions…'); render();
  } catch (error) { report(error); return; }
  permissionReady = (async () => {
    try {
      const [mode, forcedRO] = await Promise.all([
        bridge.syscall('system.getMode'), bridge.syscall('editor.getUiOption', 'forcedROMode'),
      ]);
      if (token !== generation) return;
      writable = meta.perm === 'rw' && mode !== 'ro' && forcedRO !== true;
      message(writable
        ? model?.format === 'xls'
          ? 'Legacy XLS preview. Convert to an XLSX copy to edit; the original remains unchanged. Advanced workbook features may not survive conversion.'
          : 'Preview mode. Enable editing to create an original backup first. Workbook layout, charts and advanced Excel features may change on save.'
        : 'Read-only file or space. You can browse and download this spreadsheet.');
    } catch (error) { if (token === generation) report(error); }
    if (token === generation) updateControls();
  })();
});
bridge.addEventListener('request-save', () => {
  if (!model) return;
  const committed = commitInput();
  // Serialization already succeeded before file-changed was sent. Respond immediately.
  bridge.sendMessage('file-saved', { data: model.bytes });
  status.textContent = committed ? 'Changes sent to SilverBullet' : 'Cell edit failed; last committed changes sent';
});
bridge.addEventListener('focus', focusCell);

element('enable').onclick = async () => {
  const token = generation;
  await permissionReady;
  if (!model || !writable || editable || enabling || token !== generation) return;
  enabling = true; updateControls();
  const current = model, path = filename;
  try {
    if (current.format === 'xls') {
      const target = path.replace(/\.xls$/i, '') + `.converted-${crypto.randomUUID()}.xlsx`;
      if (await bridge.syscall('space.fileExists', target)) throw new Error('Target already exists. Try again.');
      if (token !== generation) return;
      await bridge.syscall('space.writeDocument', target, current.toXlsx());
      if (token !== generation) return;
      await bridge.syscall('editor.navigate', { path: target });
      if (token !== generation) return;
      message(`Created ${target}. The original XLS file is unchanged. Open the XLSX copy to edit.`);
      return;
    }
    const extension = path.slice(path.lastIndexOf('.'));
    const backup = path.slice(0, -extension.length) + `.original-${crypto.randomUUID()}` + extension;
    if (await bridge.syscall('space.fileExists', backup)) throw new Error('Backup path already exists. Try again.');
    if (token !== generation) return;
    await bridge.syscall('space.writeDocument', backup, current.original);
    if (token !== generation) return;
    editable = true;
    message(`Original backup: ${backup}. Edits save automatically. Advanced workbook formatting may not be preserved.`);
    element('subtitle').textContent = `${current.format.toUpperCase()} · Editing · ${current.textFormat ? 'Text values' : 'Values and formulas'}`;
    formula.placeholder = current.textFormat ? 'Enter a value' : 'Enter a value or =SUM(A1:A10)';
  } catch (error) { if (token === generation) report(error); }
  finally { if (token === generation) { enabling = false; updateControls(); } }
};
element('apply').onclick = () => { if (commitInput()) focusCell(); };
formula.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); if (commitInput()) select(row + (event.shiftKey ? -1 : 1), col); }
  if (event.key === 'Escape') { formula.value = model?.input(sheet, row, col) ?? ''; focusCell(); }
});
formula.addEventListener('change', () => { commitInput(); });
address.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (!commitInput()) return;
  const ref = address.value.toUpperCase().trim();
  if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(ref)) { message('Enter a cell address such as A1 or AA200.', true); return; }
  const position = utils.decode_cell(ref);
  if (position.r >= MAX_ROWS || position.c >= MAX_COLS) { message('Cell is outside spreadsheet limits.', true); return; }
  select(position.r, position.c);
});
grid.addEventListener('click', (event) => {
  const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>('td');
  if (!cell || !commitInput()) return;
  select(Number(cell.dataset.row), Number(cell.dataset.col), event.shiftKey);
});
grid.addEventListener('dblclick', () => { if (editable) { formula.focus(); formula.select(); } });
grid.addEventListener('keydown', (event) => {
  const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, event.shiftKey ? -1 : 1] };
  if (directions[event.key]) {
    event.preventDefault(); const [dr, dc] = directions[event.key];
    select(row + dr, col + dc, event.shiftKey && event.key !== 'Tab'); return;
  }
  if (!editable) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault(); const s = selection();
    if ((s.bottom - s.top + 1) * (s.right - s.left + 1) > 10_000) { message('Clear up to 10,000 cells at a time.', true); return; }
    changed(() => model!.setCells(sheet, s.top, s.left, Array.from({ length: s.bottom - s.top + 1 }, () => Array(s.right - s.left + 1).fill('')))); focusCell();
  } else if (event.key === 'F2') { event.preventDefault(); formula.focus(); formula.select(); }
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault(); formula.focus(); formula.value = event.key;
  }
});
grid.addEventListener('paste', (event) => {
  if (!editable || !model) return;
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain');
  if (text === undefined) return;
  if (text.length > 1_000_000) { message('Paste up to 1 MB at a time.', true); return; }
  changed(() => model!.setCells(sheet, row, col, parseClipboard(text))); focusCell();
});
grid.addEventListener('copy', (event) => {
  if (!model) return;
  event.preventDefault(); const s = selection();
  if ((s.bottom - s.top + 1) * (s.right - s.left + 1) > 10_000) { message('Copy up to 10,000 cells at a time.', true); return; }
  const rows: string[] = [];
  for (let r = s.top; r <= s.bottom; r++) {
    const cells: string[] = [];
    for (let c = s.left; c <= s.right; c++) {
      let value = model.display(sheet, r, c);
      if (/[\t\n\r"]/.test(value)) value = '"' + value.replaceAll('"', '""') + '"';
      cells.push(value);
    }
    rows.push(cells.join('\t'));
  }
  event.clipboardData?.setData('text/plain', rows.join('\n'));
});
element('undo').onclick = () => { if (commitInput()) changed(() => model!.undo()); };
element('redo').onclick = () => { if (commitInput()) changed(() => model!.redo()); };
element('save').onclick = () => { if (commitInput() && editable) bridge.sendMessage('file-changed'); };
element('download').onclick = () => {
  if (!commitInput() || !model) return;
  const url = URL.createObjectURL(new Blob([model.bytes.slice().buffer]));
  const link = document.createElement('a'); link.href = url; link.download = filename.split('/').pop()!;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
element('add-sheet').onclick = async () => {
  if (!commitInput() || !editable || !model) return;
  const token = generation;
  const name = await bridge.syscall('editor.prompt', 'New sheet name', `Sheet${model.sheetNames.length + 1}`);
  if (token !== generation || !name) return;
  if (changed(() => model!.addSheet(name))) { sheet = name.trim(); row = col = anchorRow = anchorCol = rowStart = colStart = 0; render(); }
};
for (const [id, dr, dc] of [['prev-rows', -ROW_WINDOW, 0], ['next-rows', ROW_WINDOW, 0], ['prev-cols', 0, -COL_WINDOW], ['next-cols', 0, COL_WINDOW]] as const) {
  element(id).onclick = () => { if (commitInput() && model) select(rowStart + dr, colStart + dc); };
}
// Handle spreadsheet shortcuts when the host has not already consumed them.
window.addEventListener('keydown', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (commitInput() && editable) bridge.sendMessage('file-changed');
  } else if ((key === 'z' || key === 'y') && document.activeElement !== formula && document.activeElement !== address) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (editable) changed(() => event.shiftKey || key === 'y' ? model!.redo() : model!.undo());
    focusCell();
  }
}, true);
