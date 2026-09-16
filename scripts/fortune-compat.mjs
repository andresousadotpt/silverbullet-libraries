import { readFile } from 'node:fs/promises';

// FortuneSheet 1.0.4 InputBox unconditionally calls setContext from a layout
// effect in read-only mode, even when forceFormulaRef is false and its recipe
// does nothing. Selection changes can then hit React's maximum update depth.
// Check the same condition before dispatching; no formula/edit behavior changes.
// Keep this exact-match guard so upgrading FortuneSheet requires reviewing it.
export const fortuneReadonlyFix = {
  name: 'fortune-readonly-layout-effect',
  setup(build) {
    build.onLoad({ filter: /@fortune-sheet[\\/]react[\\/]dist[\\/]index\.esm\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const original = 'if (!context.allowEdit) {\n      setContext(function (ctx) {\n        var flowdata = getFlowdata(ctx);';
      if (source.split(original).length !== 2) {
        throw new Error('Review FortuneSheet InputBox compatibility patch for this dependency version.');
      }
      return {
        contents: source.replace(original, original.replace('!context.allowEdit', '!context.allowEdit && context.forceFormulaRef')),
        loader: 'js',
      };
    });
  },
};
