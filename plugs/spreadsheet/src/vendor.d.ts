declare module 'fast-formula-parser' {
  type Position = { sheet: string; row: number; col: number };
  type Range = { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } };
  export default class FormulaParser {
    static FormulaError: Record<string, Error>;
    constructor(options: {
      onCell: (ref: Position) => unknown;
      onRange: (ref: Range) => unknown[][];
      onVariable?: (name: string, sheet: string) => unknown;
      functions?: Record<string, (...args: unknown[]) => unknown>;
    });
    parse(formula: string, position: Position): unknown;
  }
}
