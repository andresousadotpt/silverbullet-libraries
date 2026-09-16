import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { SpreadsheetModel } from '../plugs/spreadsheet/src/model.ts';
import { applyFortuneSheets, displaySheets, toFortuneSheets } from '../plugs/spreadsheet/src/fortune.ts';

function example(format: 'xlsx' | 'ods' = 'xlsx') {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[10, 4, '0012', '=literal', true], ['<img src=x onerror=alert(1)>']]);
  sheet.F1 = { t: 'n', f: format === 'ods' ? 'A1+$B$1' : 'A1+[.$B$1]', v: 14 };
  sheet.G1 = { t: 'n', f: format === 'ods' ? 'SUM(A1:B1,F1)' : 'SUM([.A1:.B1];[.F1])', v: 28 };
  sheet['!ref'] = 'A1:G2';
  XLSX.utils.book_append_sheet(book, sheet, 'Main');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Olá']]), 'Notes');
  return new SpreadsheetModel(new Uint8Array(XLSX.write(book, { type: 'array', bookType: format })), `Example.${format}`);
}

test('Fortune snapshots retain exact formulas; unchanged snapshots retain exact original bytes', () => {
  const model = example(), sheets = toFortuneSheets(model), original = model.bytes.slice();
  assert.equal(sheets[0].celldata?.find(c => c.c === 5)?.v?.f, '=A1+[.$B$1]');
  applyFortuneSheets(model, sheets);
  assert.deepEqual(model.bytes, original);
  assert.equal(model.revision, 0);
  const view = displaySheets(sheets);
  assert.equal(view[0].celldata?.find(c => c.c === 5)?.v?.v, '14');
  assert.ok(view.every(s => s.celldata?.every(c => !c.v?.f)));
  assert.equal(sheets[0].celldata?.find(c => c.c === 5)?.v?.f, '=A1+[.$B$1]');
});

for (const format of ['xlsx', 'ods'] as const) test(`${format} Fortune edit round trip preserves formulas, types and other sheets`, () => {
  const model = example(format), sheets = toFortuneSheets(model);
  sheets[0].celldata!.find(c => c.r === 0 && c.c === 1)!.v!.v = 6;
  applyFortuneSheets(model, sheets);
  const reopened = new SpreadsheetModel(model.bytes, `Example.${format}`);
  assert.equal(reopened.sheet('Main').B1.v, 6);
  assert.equal(reopened.sheet('Main').C1.t, 's');
  assert.equal(reopened.sheet('Main').C1.v, '0012');
  assert.equal(reopened.sheet('Main').D1.v, '=literal');
  assert.equal(reopened.sheet('Main').D1.f, undefined);
  assert.equal(reopened.sheet('Main').E1.t, 'b');
  assert.equal(reopened.sheet('Notes').A1.v, 'Olá');
  assert.equal(reopened.display('Main', 0, 5), '16');
  if (format === 'xlsx') assert.equal(reopened.sheet('Main').F1.f, 'A1+[.$B$1]');
  model.undo(); assert.equal(model.sheet('Main').B1.v, 4);
  model.redo(); assert.equal(model.sheet('Main').B1.v, 6);
});

for (const format of ['csv', 'tsv']) test(`${format} remains UTF-8 literal text through the adapter`, () => {
  const delimiter = format === 'csv' ? ',' : '\t';
  const model = new SpreadsheetModel(new TextEncoder().encode(['0012', '=1+2', 'Olá'].join(delimiter)), `Example.${format}`);
  const sheets = toFortuneSheets(model);
  sheets[0].celldata!.find(c => c.c === 2)!.v!.v = 'Again';
  applyFortuneSheets(model, sheets);
  assert.equal(new TextDecoder().decode(model.bytes), ['0012', '=1+2', 'Again'].join(delimiter));
});

test('dense snapshots support clearing cells and retain metadata of unchanged cells', () => {
  const model = example(); model.sheet('Main').A1.z = '0.00';
  model.sheet('Main').I1 = { t: 'z', z: '0.00' };
  const sheets = toFortuneSheets(model);
  for (const sheet of sheets) {
    sheet.data = Array.from({ length: sheet.row! }, () => Array(sheet.column!).fill(null));
    for (const cell of sheet.celldata!) sheet.data[cell.r][cell.c] = cell.v;
  }
  sheets[0].data![0][1] = null;
  applyFortuneSheets(model, sheets);
  assert.equal(model.sheet('Main').B1, undefined);
  assert.equal(model.sheet('Main').A1.z, '0.00');
  assert.deepEqual(model.sheet('Main').I1, { t: 'z', z: '0.00' });
  assert.equal(model.sheet('Main').F1.f, 'A1+[.$B$1]');
});

test('protected and array formula edits fail atomically', () => {
  const model = example(), sheets = toFortuneSheets(model), bytes = model.bytes.slice();
  model.sheet('Main')['!protect'] = {};
  sheets[0].celldata![0].v!.v = 'changed';
  assert.throws(() => applyFortuneSheets(model, sheets), /protected/);
  assert.deepEqual(model.bytes, bytes);
  delete model.sheet('Main')['!protect'];
  model.sheet('Main').A1.F = 'A1:A2';
  assert.throws(() => applyFortuneSheets(model, sheets), /Array formulas/);
  assert.deepEqual(model.bytes, bytes);
});

test('oversized views fail without truncating or changing the original', () => {
  const model = example(), bytes = model.bytes.slice();
  model.sheet('Main')['!ref'] = 'A1:XFD1048576';
  assert.throws(() => toFortuneSheets(model), /view limit/);
  assert.deepEqual(model.bytes, bytes);
});

test('view limits reject edits atomically, preserving saved bytes and undo history', async () => {
  const { assertFortuneLimits } = await import('../plugs/spreadsheet/src/fortune.ts');
  const model = example(), original = model.bytes.slice();
  model.validateEdit = () => assertFortuneLimits(model);
  assert.throws(() => model.setCells('Main', 9999, 0, [['out of view']]), /view limit/);
  assert.deepEqual(model.bytes, original);
  assert.equal(model.canUndo, false);
  assert.equal(model.sheet('Main').A10000, undefined);
});
