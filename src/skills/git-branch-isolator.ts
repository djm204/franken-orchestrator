import { execSync } from 'node:child_process';
import type { GitIsolationConfig } from './cli-types.js';

const SAFE_ID = /^[a-zA-Z0-9_\-./]+$/;

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Unsafe chunkId: "${id}"`);
  }
}

export class GitBranchIsolator {
  private readonly config: GitIsolationConfig;

  constructor(config: GitIsolationConfig) {
    this.config = config;
  }

  private git(cmd: string): string {
    return execSync(`git ${cmd}`, {
      encoding: 'utf-8',
      cwd: this.config.workingDir,
    }).trim();
  }

  private branchName(chunkId: string): string {
    return `${this.config.branchPrefix}${chunkId}`;
  }

  isolate(chunkId: string): void {
    assertSafeId(chunkId);
    const branch = this.branchName(chunkId);
    this.git(`checkout ${this.config.baseBranch}`);
    const exists = this.git(`branch --list ${branch}`);
    if (exists.length > 0) {
      this.git(`checkout ${branch}`);
      return;
    }
    this.git(`checkout -b ${branch}`);
  }

  autoCommit(chunkId: string, stage: string, iteration: number): boolean {
    assertSafeId(chunkId);
    assertSafeId(stage);
    const status = this.git('status --porcelain');
    if (status.length === 0) return false;
    try {
      this.git('add -A');
      this.git(`commit -m "auto: ${stage} ${chunkId} iter ${iteration}"`);
      return true;
    } catch {
      return false;
    }
  }

  merge(chunkId: string): { merged: boolean; commits: number } {
    assertSafeId(chunkId);
    const branch = this.branchName(chunkId);
    const count = parseInt(
      this.git(`rev-list --count ${this.config.baseBranch}..${branch}`),
      10,
    ) || 0;

    if (count === 0) {
      return { merged: false, commits: 0 };
    }

    this.git(`checkout ${this.config.baseBranch}`);
    try {
      this.git(`merge ${branch} --no-edit`);
      return { merged: true, commits: count };
    } catch {
      this.git('merge --abort');
      return { merged: false, commits: count };
    }
  }

  hasMeaningfulChange(previousHead: string): boolean {
    const status = this.git('status --porcelain');
    if (status.length > 0) return true;
    const head = this.git('rev-parse HEAD');
    return head !== previousHead;
  }

  getCurrentHead(): string {
    return this.git('rev-parse HEAD');
  }

  getStatus(): string {
    return this.git('status --porcelain');
  }

  resetHard(commitHash: string): void {
    this.git(`reset --hard ${commitHash}`);
  }

  getWorkingDir(): string {
    return this.config.workingDir;
  }
}
