import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Per-attempt originals, including existence. Inverse text replacements are
 * ambiguous when operations overlap or replacement text was already present. */
export class PatchWorkspace {
  readonly originals = new Map<string, string | null>();
  private readonly read: (file: string) => Promise<string>;
  private readonly write: (file: string, content: string) => Promise<void>;

  constructor(private readonly root: string, read?: (file: string) => Promise<string>, write?: (file: string, content: string) => Promise<void>) {
    this.read = read ?? (file => readFile(path.join(root, file), 'utf8'));
    this.write = write ?? (async (file, content) => {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), content, 'utf8');
    });
  }

  private async current(file: string): Promise<string | null> {
    try { return await this.read(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Caller validates the patch scope/path before capturing, and captures
   * before invoking a writer that might throw after a partial mutation. */
  async capture(file: string): Promise<void> {
    if (!this.originals.has(file)) this.originals.set(file, await this.current(file));
  }

  async restore(): Promise<void> {
    const failures: string[] = [];
    for (const [file, original] of [...this.originals].reverse()) {
      try {
        if (await this.current(file) !== original) {
          if (original === null) await rm(path.join(this.root, file), { force: true });
          else await this.write(file, original);
        }
        if (await this.current(file) !== original) throw new Error('Restored content did not match');
      } catch { failures.push(file); }
    }
    // A contaminated attempt must never feed another model iteration or commit.
    if (failures.length) throw new Error(`PATCH_ROLLBACK_FAILED: could not restore ${failures.join(', ')}. Stop this repair and reconcile the workspace before retrying.`);
    this.originals.clear();
  }
}
