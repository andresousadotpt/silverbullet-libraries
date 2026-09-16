import * as XLSX from 'xlsx';
import FormulaParser from 'fast-formula-parser';

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;
const MAX_RANGE_CELLS = 100_000;
const MAX_EVAL_CELLS = 100_000;
const MAX_UNDO = 30;
export type Format = 'xlsx' | 'xls' | 'ods' | 'csv' | 'tsv';
type Scalar = string | number | boolean | null;
type Result = { value: Scalar; error?: string };

export function formatFor(name: string): Format {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(extension ?? '')) {
    throw new Error('Supported formats: XLSX, XLS, ODS, CSV and TSV.');
  }
  return extension as Format;
}

export function parseClipboard(text: string): string[][] {
  // TSV, including quoted tabs/newlines from Excel and other spreadsheets.
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (quoted) {
      if (char === '"' && normalized[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && value === '') quoted = true;
    else if (char === '\t') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else value += char;
  }
  if (value !== '' || row.length || !normalized.endsWith('\n')) {
    row.push(value); rows.push(row);
  }
  return rows.length ? rows : [['']];
}

export class SpreadsheetModel {
  workbook: XLSX.WorkBook;
  readonly format: Format;
  readonly original: Uint8Array;
  bytes: Uint8Array;
  revision = 0;
  private undoStack: XLSX.WorkBook[] = [];
  private redoStack: XLSX.WorkBook[] = [];
  private cache = new Map<string, Result>();
  private evaluating = new Set<string>();
  private parserPool: FormulaParser[] = [];
  private budget = MAX_EVAL_CELLS;

  constructor(data: Uint8Array, name: string) {
    this.format = formatFor(name);
    if (data.byteLength > 20 * 1024 * 1024) throw new Error('This editor supports files up to 20 MB.');
    this.original = data.slice();
    this.bytes = data.slice();
    const textFormat = this.format === 'csv' || this.format === 'tsv';
    const input = textFormat ? new TextDecoder('utf-8', { fatal: true }).decode(data) : data.slice();
    this.workbook = XLSX.read(input, {
      type: textFormat ? 'string' : 'array', raw: true, cellFormula: true, cellNF: true,
      cellStyles: true, bookVBA: true,
      ...(textFormat ? { FS: this.format === 'tsv' ? '\t' : ',' } : {}),
    });
    if (!this.workbook.SheetNames.length) {
      XLSX.utils.book_append_sheet(this.workbook, XLSX.utils.aoa_to_sheet([['']]), 'Sheet1');
    }
  }

  get textFormat() { return this.format === 'csv' || this.format === 'tsv'; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get sheetNames() { return this.workbook.SheetNames; }

  sheet(name: string): XLSX.WorkSheet {
    const sheet = this.workbook.Sheets[name];
    if (!sheet) throw new Error(`Unknown sheet: ${name}`);
    return sheet;
  }

  extent(name: string) {
    const range = XLSX.utils.decode_range(this.sheet(name)['!ref'] || 'A1');
    return { rows: Math.min(range.e.r + 1, MAX_ROWS), cols: Math.min(range.e.c + 1, MAX_COLS) };
  }

  input(name: string, row: number, col: number): string {
    const cell = this.sheet(name)[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell) return '';
    if (cell.f) return '=' + cell.f;
    if (cell.t === 's') {
      const text = String(cell.v ?? '');
      // Quote strings that would otherwise be reinterpreted on edit.
      return !this.textFormat && (/^(?:[=']|[+-]?\d|true$|false$)/i.test(text)) ? "'" + text : text;
    }
    return cell.v == null ? '' : String(cell.v);
  }

  display(name: string, row: number, col: number): string {
    const cell = this.sheet(name)[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell) return '';
    if (cell.f) {
      const result = this.evaluate(name, row, col);
      if (result.error) return result.error;
      if (typeof result.value === 'number' && cell.z) {
        try { return XLSX.SSF.format(cell.z, result.value); } catch { /* show value */ }
      }
      return result.value == null ? '' : String(result.value);
    }
    return XLSX.utils.format_cell(cell);
  }

  private resetEvaluation() {
    this.cache.clear();
    this.evaluating.clear();
    this.budget = MAX_EVAL_CELLS;
  }

  private parser(depth: number) {
    if (!this.parserPool[depth]) {
      this.parserPool[depth] = new FormulaParser({
        onCell: ({ sheet, row, col }) => {
          const result = this.evaluate(sheet, row - 1, col - 1);
          if (result.error) throw new Error(result.error);
          return result.value;
        },
        onRange: ({ sheet, from, to }) => {
          const extent = this.extent(sheet);
          // Bound whole-column / whole-row references by the used range.
          const endRow = Math.min(to.row, extent.rows);
          const endCol = Math.min(to.col, extent.cols);
          if ((endRow - from.row + 1) * (endCol - from.col + 1) > MAX_RANGE_CELLS) {
            throw new Error('#LIMIT!');
          }
          const rows: unknown[][] = [];
          for (let r = from.row; r <= endRow; r++) {
            const cells: unknown[] = [];
            for (let c = from.col; c <= endCol; c++) {
              const result = this.evaluate(sheet, r - 1, c - 1);
              if (result.error) throw new Error(result.error);
              cells.push(result.value);
            }
            rows.push(cells);
          }
          return rows.length ? rows : [[null]];
        },
        onVariable: () => { throw new Error('#NAME?'); },
        // Workbooks must never initiate network requests through formulas.
        functions: { WEBSERVICE: () => { throw new Error('#N/A'); } },
      });
    }
    return this.parserPool[depth];
  }

  private evaluate(name: string, row: number, col: number): Result {
    if (!this.workbook.Sheets[name]) return { value: null, error: '#REF!' };
    const address = XLSX.utils.encode_cell({ r: row, c: col });
    const key = JSON.stringify([name, address]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.evaluating.has(key)) return { value: null, error: '#CYCLE!' };
    if (this.evaluating.size >= 64 || --this.budget < 0) return { value: null, error: '#LIMIT!' };
    const cell = this.sheet(name)[address];
    if (!cell) return { value: null };
    if (!cell.f) {
      return cell.t === 'e'
        ? { value: null, error: XLSX.utils.format_cell(cell) || '#VALUE!' }
        : { value: cell.v as Scalar ?? null };
    }
    const depth = this.evaluating.size;
    this.evaluating.add(key);
    let result: Result;
    try {
      const value = this.parser(depth).parse(cell.f, { sheet: name, row: row + 1, col: col + 1 });
      if (value instanceof Error || (typeof value === 'object' && value !== null)) {
        throw new Error(value instanceof Error ? value.toString() : '#UNSUPPORTED!');
      }
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('#NUM!');
      result = { value: (value ?? null) as Scalar };
    } catch (error) {
      const message = String(error);
      result = { value: null, error: message.match(/#[A-Z0-9/]+[!?]/)?.[0] ?? '#ERROR!' };
    } finally {
      this.evaluating.delete(key);
    }
    this.cache.set(key, result);
    return result;
  }

  toXlsx(): Uint8Array {
    return new Uint8Array(XLSX.write(structuredClone(this.workbook), { type: 'array', bookType: 'xlsx', cellStyles: true, compression: true }));
  }

  private writableCell(name: string, row: number, col: number) {
    if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) {
      throw new Error('Cell is outside spreadsheet limits.');
    }
    const sheet = this.sheet(name);
    if (sheet['!protect']) throw new Error('This sheet is protected.');
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
    if (cell?.F) throw new Error('Array formulas cannot be edited in this editor.');
    for (const merge of sheet['!merges'] ?? []) {
      if (row >= merge.s.r && row <= merge.e.r && col >= merge.s.c && col <= merge.e.c &&
        (row !== merge.s.r || col !== merge.s.c)) {
        throw new Error('Edit the top-left cell of this merged range.');
      }
    }
  }

  setCells(name: string, row: number, col: number, values: string[][]) {
    if (values.reduce((sum, cells) => sum + cells.length, 0) > 10_000) {
      throw new Error('Paste up to 10,000 cells at a time.');
    }
    // Validate the whole paste first: no partially applied edits.
    values.forEach((cells, r) => cells.forEach((_, c) => this.writableCell(name, row + r, col + c)));
    this.change(() => {
      const sheet = this.sheet(name);
      let extent = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      values.forEach((cells, r) => cells.forEach((text, c) => {
        const position = { r: row + r, c: col + c };
        const address = XLSX.utils.encode_cell(position);
        const previous = sheet[address];
        if (text === '') {
          delete sheet[address];
        } else {
          const cell: XLSX.CellObject = { ...previous, t: 's', v: text };
          delete cell.f; delete cell.w; delete cell.h; delete cell.r;
          if (!this.textFormat) {
            if (text.startsWith("'")) cell.v = text.slice(1);
            else if (text.startsWith('=') && text.length > 1) {
              cell.f = text.slice(1); cell.t = 'n'; delete cell.v;
            } else if (/^(true|false)$/i.test(text)) {
              cell.t = 'b'; cell.v = text.toLowerCase() === 'true';
            } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) &&
              !/^[+-]?0\d/.test(text) && Number.isFinite(Number(text)) &&
              text.replace(/[^0-9]/g, '').length <= 15) {
              cell.t = 'n'; cell.v = Number(text);
            }
          }
          sheet[address] = cell;
        }
        extent = {
          s: { r: Math.min(extent.s.r, position.r), c: Math.min(extent.s.c, position.c) },
          e: { r: Math.max(extent.e.r, position.r), c: Math.max(extent.e.c, position.c) },
        };
      }));
      sheet['!ref'] = XLSX.utils.encode_range(extent);
    });
  }

  addSheet(name: string) {
    if (this.textFormat) throw new Error('CSV and TSV support one sheet.');
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 31 || /[\\/?*\[\]:]/.test(trimmed) || /^'|'$/.test(trimmed)) {
      throw new Error('Use a sheet name of 1–31 characters without : \\ / ? * [ ] or surrounding apostrophes.');
    }
    if (this.sheetNames.some(n => n.toLowerCase() === trimmed.toLowerCase())) throw new Error('Sheet name already exists.');
    this.change(() => XLSX.utils.book_append_sheet(this.workbook, XLSX.utils.aoa_to_sheet([['']]), trimmed));
  }

  private serialize(): Uint8Array {
    if (this.textFormat) {
      const sheet = this.sheet(this.sheetNames[0]);
      const text = XLSX.utils.sheet_to_csv(sheet, { FS: this.format === 'tsv' ? '\t' : ',', blankrows: true });
      return new TextEncoder().encode(text);
    }
    // Recalculate supported formula caches; never save old cached results after edits.
    const output = structuredClone(this.workbook);
    for (const name of this.sheetNames) {
      for (const [address, cell] of Object.entries(output.Sheets[name])) {
        if (address.startsWith('!') || !cell.f) continue;
        const position = XLSX.utils.decode_cell(address);
        const result = this.evaluate(name, position.r, position.c);
        delete cell.w;
        if (result.error || result.value === null) { delete cell.v; cell.t = 'n'; }
        else {
          cell.v = result.value;
          cell.t = typeof result.value === 'number' ? 'n' : typeof result.value === 'boolean' ? 'b' : 's';
        }
      }
    }
    return new Uint8Array(XLSX.write(output, {
      type: 'array', bookType: this.format === 'ods' ? 'ods' : 'xlsx',
      cellStyles: true, bookVBA: true, compression: true,
    }));
  }

  private change(action: () => void) {
    if (this.format === 'xls') throw new Error('Convert this legacy XLS workbook to XLSX before editing.');
    const before = structuredClone(this.workbook);
    try {
      action(); this.resetEvaluation();
      const bytes = this.serialize(); // A failed write must not replace the last valid bytes.
      this.bytes = bytes;
      this.undoStack.push(before);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
      this.revision++;
    } catch (error) {
      this.workbook = before; this.resetEvaluation(); throw error;
    }
  }

  undo() { this.restore(this.undoStack, this.redoStack); }
  redo() { this.restore(this.redoStack, this.undoStack); }

  private restore(from: XLSX.WorkBook[], to: XLSX.WorkBook[]) {
    const next = from.at(-1);
    if (!next) return;
    const previous = this.workbook;
    this.workbook = structuredClone(next);
    this.resetEvaluation();
    try {
      const bytes = this.serialize();
      from.pop(); to.push(previous); this.bytes = bytes; this.revision++;
    } catch (error) { this.workbook = previous; this.resetEvaluation(); throw error; }
  }
}
