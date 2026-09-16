import { utils } from 'xlsx';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { applyFortuneSheets, assertFortuneLimits, toFortuneSheets } from './fortune.ts';
import { SpreadsheetModel } from './model.ts';

type Bridge = EventTarget & {
  syscall(name: string, ...args: unknown[]): Promise<any>;
  sendMessage(type: string, data?: unknown): void;
};
declare global { interface Window { silverbullet: Bridge } }
const bridge = window.silverbullet;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const notice = element('notice');
const status = element('status');
const value = element('value');
const root = createRoot(element('viewport'));

let model: SpreadsheetModel | undefined;
let filename = '', generation = 0;
let editable = false, writable = false, enabling = false, viewReady = false;
let permissionReady: Promise<void> = Promise.resolve();
let workbook = React.createRef<WorkbookInstance>();
let viewRevision = 0;
let activeSheet = '', activeRow = 0, activeCol = 0;
let pendingNativeCells: Map<string, Set<string>> | undefined;

function message(text: string, error = false) {
  notice.textContent = text; notice.classList.toggle('error', error);
}
function report(error: unknown) { message(error instanceof Error ? error.message : String(error), true); }
function updateControls() {
  element<HTMLButtonElement>('enable').disabled = !model || !viewReady || !writable || editable || enabling;
  element<HTMLButtonElement>('enable').textContent = editable ? 'Editing enabled' : enabling ? 'Preparing…' : model?.format === 'xls' ? 'Convert to XLSX' : 'Enable editing';
  element<HTMLButtonElement>('editor-undo').disabled = !editable;
  element<HTMLButtonElement>('editor-redo').disabled = !editable;
  element<HTMLButtonElement>('save').disabled = !editable;
  element<HTMLButtonElement>('download').disabled = !model;
}
function updateSelection(sheet: string, row: number, col: number) {
  activeSheet = sheet; activeRow = row; activeCol = col;
  const address = utils.encode_cell({ r: row, c: col });
  value.textContent = model?.display(sheet, row, col) ?? '';
  status.textContent = `${sheet} · ${address}`;
}

// FortuneSheet is the editor. This adapter deliberately owns only SilverBullet
// persistence and the bounded SheetJS model; it does not emulate spreadsheet
// editing, formula entry, selection or undo/redo.
function syncNativeWorkbook(sheets = workbook.current?.getAllSheets(), changedCells = pendingNativeCells) {
  if (!model || !editable || !sheets || !changedCells?.size) return true;
  const revision = model.revision;
  try {
    applyFortuneSheets(model, sheets, changedCells);
    if (model.revision !== revision) {
      bridge.sendMessage('file-changed');
      status.textContent = 'Changes pending save';
    }
    return true;
  } catch (error) {
    report(error);
    // Native edits which cannot be represented safely (protected/array cells,
    // structure changes, or view-limit violations) are discarded by restoring
    // the last serialized model rather than being silently saved.
    render();
    return false;
  }
}
function render() {
  if (!model) return;
  const token = generation, revision = ++viewRevision;
  workbook = React.createRef<WorkbookInstance>();
  pendingNativeCells = undefined;
  const data = toFortuneSheets(model);
  flushSync(() => root.render(React.createElement(Workbook, {
    key: revision, ref: workbook, data, lang: 'en', allowEdit: editable,
    showToolbar: false, showFormulaBar: true, showSheetTabs: true,
    // Structural and formatting UI is outside this plug's round-trip contract.
    // Formula editing, reference selection, navigation, paste and native history
    // remain FortuneSheet features.
    cellContextMenu: [], headerContextMenu: [], sheetTabContextMenu: [],
    hooks: {
      afterSelectionChange: (id, selected) => {
        if (token !== generation || revision !== viewRevision || !model) return;
        const current = data.find(s => s.id === id);
        if (!current) return;
        const row = selected.row_focus ?? selected.row[0];
        const col = selected.column_focus ?? selected.column[0];
        updateSelection(current.name, row, col);
      },
    },
    onChange: sheets => {
      if (token !== generation || revision !== viewRevision) return;
      const changed = pendingNativeCells;
      pendingNativeCells = undefined;
      if (changed?.size) syncNativeWorkbook(sheets, changed);
    },
    onOp: ops => {
      if (token !== generation || revision !== viewRevision) return;
      const changes = pendingNativeCells ??= new Map<string, Set<string>>();
      for (const op of ops) {
        const [section, row, col, field] = op.path;
        // Cell edits are represented as data/<row>/<column> or one of its
        // value/formula/type fields. Formula-cache operations are ignored.
        if (section !== 'data' || !Number.isInteger(row) || !Number.isInteger(col) ||
          (field !== undefined && field !== 'v' && field !== 'f' && field !== 'ct' && field !== 'm')) continue;
        const id = String(op.id ?? '');
        const cells = changes.get(id) ?? new Set<string>();
        cells.add(utils.encode_cell({ r: row as number, c: col as number }));
        changes.set(id, cells);
      }
    },
  })));
  updateControls();
}

bridge.addEventListener('file-open', (event) => {
  const token = ++generation;
  const { data, meta } = (event as CustomEvent).detail;
  model = undefined; editable = writable = enabling = viewReady = false;
  activeSheet = ''; activeRow = activeCol = 0;
  filename = meta.name; element('filename').textContent = filename;
  value.textContent = ''; status.textContent = 'Ready'; ++viewRevision; root.render(null);
  updateControls();
  try {
    model = new SpreadsheetModel(new Uint8Array(data), filename);
    const loaded = model;
    loaded.validateEdit = () => assertFortuneLimits(loaded);
    activeSheet = model.sheetNames[0];
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
  syncNativeWorkbook();
  bridge.sendMessage('file-saved', { data: model.bytes });
  status.textContent = 'Changes sent to SilverBullet';
});
bridge.addEventListener('focus', () => workbook.current?.setSelection([{ row: [activeRow, activeRow], column: [activeCol, activeCol] }]));

element('enable').onclick = async () => {
  const token = generation;
  await permissionReady;
  if (!model || !viewReady || !writable || editable || enabling || token !== generation) return;
  enabling = true; updateControls();
  const current = model, path = filename;
  try {
    if (current.format === 'xls') {
      const target = path.replace(/\.xls$/i, '') + '.converted.xlsx';
      const exists = await bridge.syscall('space.fileExists', target);
      if (token !== generation) return;
      if (!exists) {
        await bridge.syscall('space.writeDocument', target, current.toXlsx());
        if (token !== generation) return;
      }
      await bridge.syscall('editor.navigate', { path: target });
      if (token !== generation) return;
      message(exists ? `Opened the existing converted copy ${target}. The original XLS file is unchanged.` : `Created ${target}. The original XLS file is unchanged. Open the XLSX copy to edit.`);
      return;
    }
    const extension = path.slice(path.lastIndexOf('.'));
    const backup = path.slice(0, -extension.length) + '.original' + extension;
    if (!(await bridge.syscall('space.fileExists', backup))) {
      if (token !== generation) return;
      await bridge.syscall('space.writeDocument', backup, current.original);
      if (token !== generation) return;
    }
    editable = true;
    element('subtitle').textContent = `${current.format.toUpperCase()} · Editing · ${current.textFormat ? 'Text values' : 'Values and formulas'}`;
    message(`Original backup: ${backup}. Edits save automatically. Formula entry and cell-reference selection are provided by FortuneSheet.`);
    render();
  } catch (error) { if (token === generation) report(error); }
  finally { if (token === generation) { enabling = false; updateControls(); } }
};
element('editor-undo').onclick = () => { if (editable) workbook.current?.handleUndo(); };
element('editor-redo').onclick = () => { if (editable) workbook.current?.handleRedo(); };
element('save').onclick = () => { if (editable && syncNativeWorkbook()) bridge.sendMessage('file-changed'); };
element('download').onclick = () => {
  if (!model || !syncNativeWorkbook()) return;
  const url = URL.createObjectURL(new Blob([model.bytes.slice().buffer]));
  const link = document.createElement('a'); link.href = url; link.download = filename.split('/').pop()!;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
