import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseClipboard, SpreadsheetModel } from '../plugs/spreadsheet/src/model.ts';

function fixture(format: 'xlsx' | 'biff8' | 'ods' = 'xlsx') {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Item', 'Amount', 'Total'], ['Apples', 2], ['Pears', 3]]);
  sheet.C2 = { t: 'n', f: 'SUM(B2:B3)', v: 5 };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Budget');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Other'], [17]]), 'Other');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: format }));
}

test('opening preserves exact original bytes; editing round-trips other sheets and formulas', () => {
  const bytes = fixture();
  const model = new SpreadsheetModel(bytes, 'budget.xlsx');
  assert.deepEqual(model.bytes, bytes);
  assert.equal(model.display('Budget', 1, 2), '5');
  model.setCells('Budget', 1, 1, [['7']]);
  assert.equal(model.display('Budget', 1, 2), '10');
  const saved = XLSX.read(model.bytes, { type: 'array' });
  assert.equal(saved.Sheets.Budget.B2.v, 7);
  assert.equal(saved.Sheets.Budget.C2.f, 'SUM(B2:B3)');
  assert.equal(saved.Sheets.Budget.C2.v, 10);
  assert.equal(saved.Sheets.Other.A2.v, 17);
  assert.deepEqual(model.original, bytes);
});

test('formula references recalculate across sheets and nested formulas', () => {
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  model.setCells('Budget', 3, 0, [["=Other!A2+C2", '=A4*2', '=IF(B4>20,"yes","no")']]);
  assert.equal(model.display('Budget', 3, 0), '22');
  assert.equal(model.display('Budget', 3, 1), '44');
  assert.equal(model.display('Budget', 3, 2), 'yes');
  model.setCells('Other', 1, 0, [['1']]);
  assert.equal(model.display('Budget', 3, 0), '6');
  assert.equal(model.display('Budget', 3, 2), 'no');
});

test('types, literal formulas and identifiers survive save; HTML remains text', () => {
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  model.setCells('Budget', 5, 0, [["'=literal", '00123', '1234567890123456789', 'FALSE', '1.25', '<img src=x onerror=alert(1)>']]);
  const reopened = new SpreadsheetModel(model.bytes, 'budget.xlsx');
  assert.equal(reopened.display('Budget', 5, 0), '=literal');
  assert.equal(reopened.display('Budget', 5, 1), '00123');
  assert.equal(reopened.display('Budget', 5, 2), '1234567890123456789');
  assert.equal(reopened.sheet('Budget').D6.t, 'b');
  assert.equal(reopened.sheet('Budget').E6.v, 1.25);
  assert.equal(reopened.display('Budget', 5, 5), '<img src=x onerror=alert(1)>');
});

test('undo and redo restore actual serialized content and new edits clear redo', () => {
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  model.setCells('Budget', 1, 1, [['10']]);
  model.undo(); assert.equal(XLSX.read(model.bytes).Sheets.Budget.B2.v, 2);
  model.redo(); assert.equal(XLSX.read(model.bytes).Sheets.Budget.B2.v, 10);
  model.undo(); model.setCells('Budget', 1, 1, [['20']]);
  assert.equal(model.canRedo, false);
});

test('paste parses quoted fields and applies a rectangular change as one undo step', () => {
  const rows = parseClipboard('"hello\tworld"\t"line1\nline2"\r\n"a""b"\t42\r\n');
  assert.deepEqual(rows, [['hello\tworld', 'line1\nline2'], ['a"b', '42']]);
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  model.setCells('Budget', 0, 0, rows);
  assert.equal(model.display('Budget', 1, 1), '42');
  model.undo(); assert.equal(model.display('Budget', 0, 0), 'Item');
});

for (const [format, extension] of [['ods', 'ods']] as const) {
  test(`${extension} edits preserve file format, multiple sheets, and formulas`, () => {
    const model = new SpreadsheetModel(fixture(format), `budget.${extension}`);
    model.setCells('Budget', 1, 1, [['9']]);
    const reopened = new SpreadsheetModel(model.bytes, `budget.${extension}`);
    assert.equal(reopened.display('Budget', 1, 1), '9');
    assert.equal(reopened.sheet('Budget').C2.f, 'SUM(B2:B3)');
    assert.equal(reopened.display('Other', 1, 0), '17');
  });
}

for (const format of ['csv', 'tsv'] as const) {
  test(`${format} preserves quoted text, Unicode, leading zeros and delimiter`, () => {
    const sep = format === 'csv' ? ',' : '\t';
    const model = new SpreadsheetModel(new TextEncoder().encode(`Name${sep}Code\n"Olá, friend"${sep}0012\n`), `data.${format}`);
    model.setCells('Sheet1', 2, 0, [['new\nline', '0013']]);
    const reopened = new SpreadsheetModel(model.bytes, `data.${format}`);
    assert.equal(reopened.display('Sheet1', 1, 0), 'Olá, friend');
    assert.equal(reopened.display('Sheet1', 1, 1), '0012');
    assert.equal(reopened.display('Sheet1', 2, 0), 'new\nline');
    assert.equal(reopened.display('Sheet1', 2, 1), '0013');
    assert.throws(() => model.addSheet('Extra'), /one sheet/);
  });
}

test('adding sheets validates names and is undoable', () => {
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  assert.throws(() => model.addSheet('budget'), /already exists/);
  assert.throws(() => model.addSheet('Bad/name'), /sheet name/);
  model.addSheet('New'); assert.equal(model.sheetNames.length, 3);
  model.undo(); assert.equal(model.sheetNames.length, 2);
  model.redo(); assert.ok(model.sheetNames.includes('New'));
});

test('cyclic and unsupported formulas cannot hang or save stale caches', () => {
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  model.setCells('Budget', 10, 0, [['=B11', '=A11', '=NONEXISTENT(1)', '=SUM(B:B)']]);
  assert.match(model.display('Budget', 10, 0), /^#/);
  assert.match(model.display('Budget', 10, 2), /^#/);
  const saved = XLSX.read(model.bytes, { sheetStubs: true });
  assert.equal(saved.Sheets.Budget.C11.f, 'NONEXISTENT(1)');
  assert.notEqual(saved.Sheets.Budget.C11.v, 5);
});

test('protected and merged cells reject a paste atomically', () => {
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  model.sheet('Budget')['!merges'] = [XLSX.utils.decode_range('A1:B1')];
  const before = model.bytes.slice();
  assert.throws(() => model.setCells('Budget', 0, 0, [['new', 'bad']]), /top-left/);
  assert.equal(model.display('Budget', 0, 0), 'Item');
  assert.deepEqual(model.bytes, before);
  model.sheet('Budget')['!protect'] = {};
  assert.throws(() => model.setCells('Budget', 1, 0, [['new']]), /protected/);
});

test('rejects oversized pastes and unsupported formats without modifying bytes', () => {
  const model = new SpreadsheetModel(fixture(), 'budget.xlsx');
  assert.throws(() => model.setCells('Budget', 0, 0, [Array(10001).fill('x')]), /10,000/);
  assert.deepEqual(model.bytes, model.original);
  assert.throws(() => new SpreadsheetModel(fixture(), 'budget.xlsm'), /Supported formats/);
});


test('legacy XLS stays unchanged and converts to an editable XLSX copy', () => {
  const model = new SpreadsheetModel(fixture('biff8'), 'budget.xls');
  assert.throws(() => model.setCells('Budget', 1, 1, [['9']]), /Convert/);
  assert.deepEqual(model.bytes, model.original);
  const converted = new SpreadsheetModel(model.toXlsx(), 'budget.xlsx');
  converted.setCells('Budget', 1, 1, [['9']]);
  assert.equal(converted.display('Budget', 1, 1), '9');
  assert.equal(converted.display('Other', 1, 0), '17');
});
