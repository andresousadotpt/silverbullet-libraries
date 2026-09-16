import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { formulaForEvaluation } from '../plugs/spreadsheet/src/formulas.ts';
import { SpreadsheetModel } from '../plugs/spreadsheet/src/model.ts';

test('normalizes local OpenFormula references, ranges, and function separators', () => {
  assert.equal(formulaForEvaluation('C2+[.$A$5]'), 'C2+$A$5');
  assert.equal(formulaForEvaluation('SUM([.A1:.$B$3];[.$C$4])'), 'SUM(A1:$B$3,$C$4)');
  assert.equal(formulaForEvaluation('of:=IF([.A1]>0;1;0)'), 'IF(A1>0,1,0)');
  assert.equal(formulaForEvaluation('oooc:=[.A1]+[.B1]'), 'A1+B1');
});

test('supports sheet-qualified references without guessing cross-sheet ranges', () => {
  assert.equal(formulaForEvaluation("[$'Other sheet'.$A$1]"), "'Other sheet'!$A$1");
  assert.equal(formulaForEvaluation("SUM(['Other sheet'.A1:'Other sheet'.B3])"), "SUM('Other sheet'!A1:B3)");
  assert.equal(formulaForEvaluation("['O''Brien'.A1]"), "'O''Brien'!A1");
  assert.equal(formulaForEvaluation('[First.A1:Second.B2]'), '[First.A1:Second.B2]');
});

test('leaves text, structured references, external references and Excel arrays intact', () => {
  for (const formula of ['SUM(Table1[Amount])', 'Table1[.A1]', 'Table1[[.A1]]', '[1]Sheet1!A1', "'Sheet[.A1]'!B1", 'SUM({1,2;3,4})', '"[.A1];""text"']) {
    assert.equal(formulaForEvaluation(formula), formula);
  }
  assert.equal(formulaForEvaluation('IF([.A1];"[.B2];";SUM({1,2;3,4}))'), 'IF(A1,"[.B2];",SUM({1,2;3,4}))');
});

test('imported bracketed formulas recalculate through dependencies and survive saving', () => {
  const workbook = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[12, 8], [5]]);
  ws.C1 = { t: 'n', f: 'A1+[.$B$1]', v: 20 };
  ws.C2 = { t: 'n', f: 'SUM([.A1:.B1];[.A2])', v: 25 };
  ws.D1 = { t: 'n', f: 'C1+[.$A$2]', v: 25 };
  ws.D2 = { t: 'n', f: "['Other sheet'.$A$1]+[.A2]", v: 8 };
  ws['!ref'] = 'A1:D2';
  XLSX.utils.book_append_sheet(workbook, ws, 'Example');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[3]]), 'Other sheet');
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  const model = new SpreadsheetModel(bytes, 'Example.xlsx');
  assert.equal(model.display('Example', 0, 2), '20');
  assert.equal(model.display('Example', 1, 2), '25');
  assert.equal(model.display('Example', 0, 3), '25');
  assert.equal(model.display('Example', 1, 3), '8');
  assert.deepEqual(model.bytes, model.original);
  model.setCells('Example', 0, 1, [['18']]);
  assert.equal(model.display('Example', 0, 2), '30');
  assert.equal(model.display('Example', 0, 3), '35');
  const reopened = new SpreadsheetModel(model.bytes, 'Example.xlsx');
  assert.equal(reopened.sheet('Example').C1.f, 'A1+[.$B$1]');
  assert.equal(reopened.display('Example', 1, 2), '35');
});
