// Translate the common OpenFormula references found in imported workbooks into
// the A1 syntax accepted by our evaluator. Never change the stored formula.
// Reference syntax: https://docs.oasis-open.org/office/OpenDocument/v1.3/cs01/part4-formula/OpenDocument-v1.3-cs01-part4-formula.pdf
const cell = String.raw`\$?[A-Za-z]{1,3}\$?[1-9][0-9]*`;
const sheet = String.raw`\$?(?:'(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_.]*)`;
const endpoint = String.raw`(${sheet})?\.(${cell})`;
const reference = new RegExp(`^${endpoint}(?::${endpoint})?$`, 'u');

function convertReference(content: string): string | undefined {
  const match = reference.exec(content);
  if (!match) return;
  const [, fromSheet, fromCell, toSheet, toCell] = match;
  const cleanSheet = (value: string) => value.replace(/^\$/, '');
  // Cross-sheet / 3D ranges need their own semantics; don't guess.
  if (toSheet && (!fromSheet || cleanSheet(fromSheet) !== cleanSheet(toSheet))) return;
  const qualifier = fromSheet ? cleanSheet(fromSheet) + '!' : '';
  return qualifier + fromCell + (toCell ? ':' + toCell : '');
}

export function formulaForEvaluation(formula: string): string {
  const prefixed = /^(?:of|oooc):=/i.test(formula);
  const source = formula.replace(/^(?:of|oooc):=/i, '').replace(/^=/, '');
  let output = '', quote = '', arrayDepth = 0, converted = prefixed;
  // Record separators and replace them only if we actually recognized ODF
  // syntax. Excel array row separators and text literals must remain intact.
  const separators: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      output += char;
      if (char === quote) {
        if (source[i + 1] === quote) output += source[++i];
        else quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; output += char; continue; }
    if (char === '[') {
      // Consume even unrecognized brackets as one token: don't reinterpret
      // nested structured references or external workbook references.
      let end = i + 1, depth = 1, quoted = false;
      for (; end < source.length; end++) {
        if (source[end] === "'") {
          if (quoted && source[end + 1] === "'") { end++; continue; }
          quoted = !quoted;
        }
        if (quoted) continue;
        if (source[end] === '[') depth++;
        if (source[end] === ']' && --depth === 0) break;
      }
      if (depth === 0) {
        const precededByName = i > 0 && /[\p{L}\p{N}_\].]/u.test(source[i - 1]);
        const replacement = precededByName ? undefined : convertReference(source.slice(i + 1, end));
        output += replacement ?? source.slice(i, end + 1);
        if (replacement !== undefined) converted = true;
        i = end; continue;
      }
    }
    if (char === '{') arrayDepth++;
    if (char === '}') arrayDepth--;
    if (char === ';' && arrayDepth === 0) separators.push(output.length);
    output += char;
  }
  if (converted) {
    const chars = output.split('');
    for (const position of separators) chars[position] = ',';
    return chars.join('');
  }
  return output;
}
