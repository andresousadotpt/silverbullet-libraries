import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Each folder with a matching manifest becomes a separately installable plug.
await mkdir('dist', { recursive: true });
for (const entry of await readdir('plugs', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const root = `plugs/${entry.name}`;
  const manifest = `${root}/${entry.name}.plug.yaml`;
  try { await readFile(manifest); } catch { continue; }
  // Document editors can supply a browser entry point and an HTML shell.
  const entries = await readdir(root);
  if (entries.includes('editor.html')) {
    const result = await build({
      entryPoints: [`${root}/src/app.ts`], bundle: true, write: false,
      format: 'iife', platform: 'browser', target: 'es2022', minify: true,
      legalComments: 'inline',
    });
    const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const css = await readFile(`${root}/src/style.css`, 'utf8');
    const shell = await readFile(`${root}/editor.html`, 'utf8');
    const html = shell.replace('<!-- STYLE -->', () => `<style>${css}</style>`)
      .replace('<!-- SCRIPT -->', () => `<script>${js}</script>`);
    await mkdir(`${root}/generated`, { recursive: true });
    await writeFile(`${root}/generated/editor.ts`, `export default ${JSON.stringify(html)};\n`);
    await writeFile(`dist/${entry.name}.html`, html);
  }
  execFileSync(process.execPath, [
    resolve('node_modules/@silverbulletmd/silverbullet/dist/plug-compile.js'),
    '--dist', 'dist', manifest,
  ], { stdio: 'inherit' });
  const bundlePath = `dist/${entry.name}.plug.js`;
  const bundle = await readFile(bundlePath, 'utf8');
  await writeFile(bundlePath, bundle.replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
}
