import { extract, type Plan, type Skipped } from './archive.ts';

export type ImportHost = {
  readOnly(): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  write(path: string, bytes: Uint8Array): Promise<unknown>;
  progress(done: number, total: number): Promise<unknown>;
};
export type ImportResult = { written: string[]; skipped: Skipped[]; failed: Skipped[]; stopped?: string };

export async function importPlan(plan: Plan, host: ImportHost): Promise<ImportResult> {
  const result: ImportResult = { written: [], skipped: [...plan.skipped], failed: [] };
  for (let index = 0; index < plan.files.length; index++) {
    const { entry, path } = plan.files[index];
    try {
      if (await host.readOnly()) throw new Error('Space became read-only.');
      if (await host.exists(path)) { result.skipped.push({ path, reason: 'File appeared after preview' }); continue; }
      const bytes = await extract(entry);
      if (await host.readOnly()) throw new Error('Space became read-only.');
      if (await host.exists(path)) { result.skipped.push({ path, reason: 'File appeared during extraction' }); continue; }
      await host.write(path, bytes);
      result.written.push(path);
    } catch (error) {
      result.failed.push({ path, reason: String(error instanceof Error ? error.message : error) });
      result.stopped = `${plan.files.length - index - 1} remaining files were not attempted. You can rerun the import; existing files will be skipped.`;
      break;
    }
    if ((index + 1) % 25 === 0) await host.progress(index + 1, plan.files.length).catch(() => {});
  }
  return result;
}
