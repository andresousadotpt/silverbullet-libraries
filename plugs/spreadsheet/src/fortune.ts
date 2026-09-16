import type { Cell, Sheet } from '@fortune-sheet/core';
import { utils, type CellObject } from 'xlsx';
import type { SpreadsheetModel } from './model.ts';

// FortuneSheet allocates dense matrices even for sparse input. Refuse oversized
// projections rather than truncating a workbook and later saving missing cells.
export const MAX_GRID_CELLS = 250_000;
export const MAX_GRID_ROWS = 10_000;
export const MAX_GRID_COLS = 1_000;

function dimensions(model: SpreadsheetModel, name: string) {
  const extent = model.extent(name);
  return { row: Math.max(100, extent.rows + 20), column: Math.max(26, extent.cols + 5) };
}

export function assertFortuneLimits(model: SpreadsheetModel) {
  let allocated = 0;
  for (const name of model.sheetNames) {
    const { row, column } = dimensions(model, name);
    allocated += row * column;
    if (row > MAX_GRID_ROWS || column > MAX_GRID_COLS || allocated > MAX_GRID_CELLS) {
      throw new Error('Workbook exceeds the FortuneSheet view limit (250,000 grid cells across all sheets, 10,000 rows or 1,000 columns including editing space). Download the original to open it in a desktop spreadsheet.');
    }
  }
}

export function toFortuneSheets(model: SpreadsheetModel): Sheet[] {
  assertFortuneLimits(model);
  return model.sheetNames.map((name, index) => {
    const { row, column } = dimensions(model, name);
    return {
      id: String(index), name, order: index, row, column,
      celldata: Object.entries(model.sheet(name)).flatMap(([address, cell]) => {
        if (address.startsWith('!')) return [];
        const { r, c } = utils.decode_cell(address);
        const v: Cell = { v: cell.v, m: model.display(name, r, c), ct: { t: cell.t, fa: cell.z || 'General' } };
        if (cell.f) v.f = '=' + cell.f;
        return [{ r, c, v }];
      }),
    };
  });
}

// Never give FortuneSheet formulas to interpret or rewrite. It is a view of the
// authoritative workbook; the formula bar reads the original formula separately.
export function displaySheets(sheets: Sheet[]): Sheet[] {
  return sheets.map(sheet => ({ ...sheet, celldata: sheet.celldata?.map(cell => ({
    ...cell, v: cell.v ? { v: String(cell.v.m ?? cell.v.v ?? ''), m: String(cell.v.m ?? cell.v.v ?? ''), ct: { t: 's', fa: '@' } } : null,
  })) }));
}

// Apply values/formulas from a FortuneSheet snapshot, retaining all untouched
// SheetJS cell metadata. Display caches and selection/layout changes are ignored.
export function applyFortuneSheets(model: SpreadsheetModel, sheets: Sheet[], changedCells?: Map<string, Set<string>>) {
  if (sheets.length !== model.sheetNames.length || sheets.some((sheet, i) => sheet.name !== model.sheetNames[i])) {
    throw new Error('Use the editor sheet command to change workbook structure.');
  }
  const edits: { name: string; row: number; col: number; cell?: CellObject }[] = [];
  for (const sheet of sheets) {
    const cells = new Map<string, Cell>();
    if (sheet.data) {
      sheet.data.forEach((row, r) => row.forEach((v, c) => { if (v) cells.set(utils.encode_cell({ r, c }), v); }));
    } else {
      sheet.celldata?.forEach(({ r, c, v }) => { if (v) cells.set(utils.encode_cell({ r, c }), v); });
    }
    const original = model.sheet(sheet.name);
    // FortuneSheet's complete data snapshot may omit formulas in cells that
    // were not edited. Its operation stream identifies the cells that changed;
    // when available, use that precise set so dependent formulas are retained.
    const changed = changedCells?.get(String(sheet.id));
    const addresses = changed ?? new Set([...Object.keys(original).filter(a => !a.startsWith('!')), ...cells.keys()]);
    for (const address of addresses) {
      const source = cells.get(address), previous = original[address];
      // Empty styled SheetJS stubs are not deletions in an unchanged snapshot.
      if (source && source.v === undefined && !source.f && previous?.v === undefined && !previous?.f) continue;
      let cell: CellObject | undefined;
      if (source && (source.v !== undefined || source.f)) {
        const f = source.f?.replace(/^=/, '');
        if (model.textFormat) {
          cell = { t: 's', v: source.f || String(source.v ?? '') };
        } else if (f) {
          cell = { t: 'n', f };
        } else {
          // FortuneSheet's editable content is text even when the cell's
          // declared type is numeric or boolean. Restore that type before the
          // SheetJS model serializes the native edit.
          const type = source.ct?.t;
          const nativeValue = type === 'n' && typeof source.v === 'string' && source.v.trim() !== '' && Number.isFinite(Number(source.v))
            ? Number(source.v)
            : type === 'b' && typeof source.v === 'string'
              ? source.v.toLowerCase() === 'true'
              : source.v;
          cell = { t: type === 's' ? 's' : type === 'n' ? 'n' : type === 'b' ? 'b' : typeof nativeValue === 'number' ? 'n' : typeof nativeValue === 'boolean' ? 'b' : 's', v: nativeValue };
          if (source.ct?.t === 'e') cell.t = 'e';
        }
      }
      if (previous?.f && cell?.f === previous.f) continue;
      if (!previous?.f && !cell?.f && previous?.v === cell?.v && previous?.t === cell?.t) continue;
      const { r: row, c: col } = utils.decode_cell(address);
      edits.push({ name: sheet.name, row, col, cell });
    }
  }
  if (edits.length) model.setTypedCells(edits);
}
