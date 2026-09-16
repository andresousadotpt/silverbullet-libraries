import { utils } from 'xlsx';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { assertFortuneLimits, displaySheets, toFortuneSheets } from './fortune.ts';
import { parseClipboard, SpreadsheetModel } from './model.ts';

type Bridge = EventTarget & {
  syscall(name: string, ...args: unknown[]): Promise<any>;
  sendMessage(type: string, data?: unknown): void;
};
declare global { interface Window { silverbullet: Bridge } }
const bridge = window.silverbullet;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const formula = element<HTMLInputElement>('formula');
const address = element<HTMLInputElement>('address');
const grid = element('viewport');
const notice = element('notice');
const status = element('status');
let model: SpreadsheetModel | undefined;
let sheet = '', filename = '', generation = 0;
let editable = false, writable = false, enabling = false, viewReady = false;
let row = 0, col = 0, anchorRow = 0, anchorCol = 0;
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
  element<HTMLButtonElement>('enable').disabled = !model || !viewReady || !writable || editable || enabling;
  element<HTMLButtonElement>('enable').textContent = editable ? 'Editing enabled' : enabling ? 'Preparing…' : model?.format === 'xls' ? 'Convert to XLSX' : 'Enable editing';
  element<HTMLButtonElement>('editor-undo').disabled = !editable || !model?.canUndo;
  element<HTMLButtonElement>('editor-redo').disabled = !editable || !model?.canRedo;
  element<HTMLButtonElement>('save').disabled = !editable;
  element<HTMLButtonElement>('apply').disabled = !editable;
  element<HTMLButtonElement>('download').disabled = !model;
  element<HTMLButtonElement>('add-sheet').disabled = !editable || !!model?.textFormat;
  formula.readOnly = !editable;
}
let viewRevision = 0;
const root = createRoot(element('viewport'));
let workbook = React.createRef<WorkbookInstance>();
let viewRows = 100, viewCols = 26;
let requestedSelection: { row: number; col: number; anchorRow: number; anchorCol: number } | undefined;
function updateSelection() {
  address.value = cellAddress();
  formula.value = model?.input(sheet, row, col) ?? '';
  element('value').textContent = model?.display(sheet, row, col) ?? '';
  status.textContent = `${sheet} · ${cellAddress()}`;
}
function render() {
  if (!model) return;
  requestedSelection = undefined;
  const data = displaySheets(toFortuneSheets(model));
  const current = data.find(s => s.name === sheet)!;
  viewRows = current.row!; viewCols = current.column!;
  current.status = 1;
  current.luckysheet_select_save = [{ row: [row, row], column: [col, col] }];
  const token = generation, revision = ++viewRevision;
  workbook = React.createRef<WorkbookInstance>();
  flushSync(() => root.render(React.createElement(Workbook, {
    key: revision, ref: workbook, data, lang: 'en', allowEdit: false,
    showToolbar: false, showFormulaBar: false, showSheetTabs: true,
    cellContextMenu: [], headerContextMenu: [], sheetTabContextMenu: [],
    hooks: {
      afterSelectionChange: (id, selected) => {
        if (token !== generation || revision !== viewRevision) return;
        const active = data.find(s => s.id === id)!;
        sheet = active.name; viewRows = active.row!; viewCols = active.column!;
        row = selected.row_focus ?? selected.row[0]; col = selected.column_focus ?? selected.column[0];
        anchorRow = row === selected.row[0] ? selected.row[1] : selected.row[0];
        anchorCol = col === selected.column[0] ? selected.column[1] : selected.column[0];
        const requested = requestedSelection;
        if (requested && selected.row[0] === Math.min(requested.row, requested.anchorRow) &&
          selected.row[1] === Math.max(requested.row, requested.anchorRow) &&
          selected.column[0] === Math.min(requested.col, requested.anchorCol) &&
          selected.column[1] === Math.max(requested.col, requested.anchorCol)) {
          ({ row, col, anchorRow, anchorCol } = requested);
        }
        updateSelection();
      },
    },
  })));
  updateSelection(); updateControls();
}
function focusCell() { element('viewport').focus({ preventScroll: true }); }
function select(r: number, c: number, extend = false) {
  row = Math.max(0, Math.min(r, viewRows - 1)); col = Math.max(0, Math.min(c, viewCols - 1));
  if (!extend) { anchorRow = row; anchorCol = col; }
  const target = { row, col, anchorRow, anchorCol }, revision = viewRevision;
  requestedSelection = target;
  const move = (attempt = 0) => {
    if (revision !== viewRevision || requestedSelection !== target) return;
    // The ref exists before FortuneSheet's initialization effect populates it.
    if (!workbook.current?.getAllSheets().length) {
      if (attempt < 20) requestAnimationFrame(() => move(attempt + 1));
      return;
    }
    ({ row, col, anchorRow, anchorCol } = target);
    workbook.current.setSelection([{ row: [Math.min(row, anchorRow), Math.max(row, anchorRow)], column: [Math.min(col, anchorCol), Math.max(col, anchorCol)] }]);
    workbook.current.scroll({ scrollTop: Math.max(0, row - 3) * 20, scrollLeft: Math.max(0, col - 2) * 73 });
    updateSelection();
  };
  move();
  updateSelection(); focusCell();
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
  model = undefined; editable = writable = enabling = viewReady = false;
  row = col = anchorRow = anchorCol = 0;
  filename = meta.name; element('filename').textContent = filename;
  formula.value = ''; element('value').textContent = ''; ++viewRevision; root.render(null);
  updateControls();
  try {
    model = new SpreadsheetModel(new Uint8Array(data), filename);
    const loaded = model;
    loaded.validateEdit = () => assertFortuneLimits(loaded);
    sheet = model.sheetNames[0];
    element('subtitle').textContent = `${model.format.toUpperCase()} · ${model.sheetNames.length} sheet${model.sheetNames.length === 1 ? '' : 's'} · Preview`;
    message('Checking editing permissions…'); render(); viewReady = true;
  } catch (error) { report(error); updateControls(); return; }
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
  if (!model || !viewReady || !writable || editable || enabling || token !== generation) return;
  enabling = true; updateControls();
  const current = model, path = filename;
  try {
    if (current.format === 'xls') {
      // Deterministic name: reopen and reuse the existing copy instead of
      // creating duplicates or overwriting edits made in the converted copy.
      const target = path.replace(/\.xls$/i, '') + '.converted.xlsx';
      const exists = await bridge.syscall('space.fileExists', target);
      if (token !== generation) return;
      if (!exists) {
        await bridge.syscall('space.writeDocument', target, current.toXlsx());
        if (token !== generation) return;
      }
      await bridge.syscall('editor.navigate', { path: target });
      if (token !== generation) return;
      message(exists
        ? `Opened the existing converted copy ${target}. The original XLS file is unchanged.`
        : `Created ${target}. The original XLS file is unchanged. Open the XLSX copy to edit.`);
      return;
    }
    // One deterministic backup per file. An existing backup is the pristine
    // original: never overwrite it and never create additional copies.
    const extension = path.slice(path.lastIndexOf('.'));
    const backup = path.slice(0, -extension.length) + '.original' + extension;
    if (!(await bridge.syscall('space.fileExists', backup))) {
      if (token !== generation) return;
      await bridge.syscall('space.writeDocument', backup, current.original);
      if (token !== generation) return;
    }
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
  if (position.r >= viewRows || position.c >= viewCols) { message('Cell is outside the current grid. The view includes blank space after the used range.', true); return; }
  select(position.r, position.c);
});
grid.addEventListener('mousedown', () => { requestedSelection = undefined; }, true);
grid.addEventListener('dblclick', event => {
  if ((event.target as HTMLElement).closest('.luckysheet-sheets-item')) {
    event.preventDefault(); event.stopImmediatePropagation(); return;
  }
  if (editable) { formula.focus(); formula.select(); }
}, true);
grid.addEventListener('keydown', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('.luckysheet-sheets-item');
  if (tab && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); tab.click(); return; }
  event.stopPropagation();
  const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, event.shiftKey ? -1 : 1] };
  if (directions[event.key]) {
    event.preventDefault(); const [dr, dc] = directions[event.key];
    select(row + dr, col + dc, event.shiftKey && event.key !== 'Tab'); return;
  }
  if (!editable) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault(); event.stopImmediatePropagation(); const s = selection();
    if ((s.bottom - s.top + 1) * (s.right - s.left + 1) > 10_000) { message('Clear up to 10,000 cells at a time.', true); return; }
    changed(() => model!.setCells(sheet, s.top, s.left, Array.from({ length: s.bottom - s.top + 1 }, () => Array(s.right - s.left + 1).fill('')))); focusCell();
  } else if (event.key === 'F2') { event.preventDefault(); formula.focus(); formula.select(); }
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault(); formula.focus(); formula.value = event.key;
  }
}, true);
grid.addEventListener('paste', (event) => {
  if (!editable || !model) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const text = event.clipboardData?.getData('text/plain');
  if (text === undefined) return;
  if (text.length > 1_000_000) { message('Paste up to 1 MB at a time.', true); return; }
  changed(() => model!.setCells(sheet, row, col, parseClipboard(text))); focusCell();
}, true);
grid.addEventListener('copy', (event) => {
  if (!model) return;
  event.preventDefault(); event.stopImmediatePropagation(); const s = selection();
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
}, true);
element('editor-undo').onclick = () => { if (commitInput()) changed(() => model!.undo()); };
element('editor-redo').onclick = () => { if (commitInput()) changed(() => model!.redo()); };
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
  if (changed(() => model!.addSheet(name))) { sheet = name.trim(); row = col = anchorRow = anchorCol = 0; render(); }
};
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
