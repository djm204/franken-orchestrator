import { execSync } from 'node:child_process';
import type { BeastResult, TaskOutcome } from '../types.js';
import type { ILogger } from '../deps.js';

export interface PrCreatorConfig {
  readonly targetBranch: string;
  readonly disabled: boolean;
  readonly remote: string;
}

type ExecFn = (cmd: string) => string;

const defaultExec: ExecFn = (cmd: string) => execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });

export class PrCreator {
  private readonly config: PrCreatorConfig;
  private readonly exec: ExecFn;

  constructor(config: PrCreatorConfig, exec: ExecFn = defaultExec) {
    this.config = {
      targetBranch: config.targetBranch ?? 'main',
      disabled: config.disabled ?? false,
      remote: config.remote ?? 'origin',
    };
    this.exec = exec;
  }

  async create(result: BeastResult, logger?: ILogger): Promise<{ url: string } | null> {
    if (this.config.disabled) {
      logger?.warn('PrCreator: skipped (disabled)');
      return null;
    }

    const outcomes = result.taskResults ?? [];
    const allSucceeded = outcomes.length > 0 && outcomes.every(o => o.status === 'success');
    if (result.status !== 'completed' || !allSucceeded) {
      logger?.warn('PrCreator: skipped (not all tasks completed)', {
        status: result.status,
        total: outcomes.length,
        succeeded: outcomes.filter(o => o.status === 'success').length,
      });
      return null;
    }

    const branch = this.safeExec('git branch --show-current', logger)?.trim() ?? '';
    if (!branch) {
      logger?.error('PrCreator: unable to resolve current branch');
      return null;
    }

    if (!this.pushBranch(branch, logger)) {
      return null;
    }

    const existing = this.findExistingPr(branch, logger);
    if (existing === null) {
      return null;
    }
    if (existing.length > 0) {
      logger?.info('PrCreator: PR already exists', { branch, url: existing[0]?.url });
      return null;
    }

    const title = buildTitle(result.projectId, outcomes.length);
    const body = buildBody(result, outcomes);

    try {
      const output = this.exec(
        `gh pr create --base ${this.config.targetBranch} --title ${shellEscape(title)} --body ${shellEscape(body)}`,
      );
      const url = output.trim();
      if (!url) {
        logger?.warn('PrCreator: PR created but no URL returned');
        return null;
      }
      logger?.info('PrCreator: PR created', { url });
      return { url };
    } catch (error) {
      if (isGhMissing(error)) {
        logger?.warn('PrCreator: gh CLI not installed');
        return null;
      }
      logger?.error('PrCreator: failed to create PR', { error: stringifyError(error) });
      return null;
    }
  }

  private safeExec(cmd: string, logger?: ILogger): string | null {
    try {
      return this.exec(cmd);
    } catch (error) {
      logger?.error('PrCreator: command failed', { cmd, error: stringifyError(error) });
      return null;
    }
  }

  private pushBranch(branch: string, logger?: ILogger): boolean {
    try {
      this.exec(`git push ${this.config.remote} ${branch}`);
      return true;
    } catch (error) {
      logger?.error('PrCreator: failed to push branch', { branch, error: stringifyError(error) });
      return false;
    }
  }

  private findExistingPr(branch: string, logger?: ILogger): Array<{ url?: string }> | null {
    try {
      const output = this.exec(`gh pr list --head ${branch} --json url --limit 1`);
      const parsed = JSON.parse(output) as Array<{ url?: string }>;
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (isGhMissing(error)) {
        logger?.warn('PrCreator: gh CLI not installed');
        return null;
      }
      logger?.error('PrCreator: failed to list PRs', { error: stringifyError(error) });
      return null;
    }
  }
}

function buildTitle(projectId: string, chunkCount: number): string {
  const prefix = 'feat: ';
  const suffix = ` - ${chunkCount} chunks completed`;
  const maxLength = 70;
  const available = maxLength - prefix.length - suffix.length;
  const trimmedProject = available > 0
    ? (projectId.length > available ? `${projectId.slice(0, Math.max(available - 3, 0))}...` : projectId)
    : projectId.slice(0, Math.max(maxLength - 3, 0)) + '...';
  const title = `${prefix}${trimmedProject}${suffix}`;
  return title.length > maxLength ? title.slice(0, maxLength - 3) + '...' : title;
}

function buildBody(result: BeastResult, outcomes: readonly TaskOutcome[]): string {
  const succeeded = outcomes.filter(o => o.status === 'success').length;
  const failed = outcomes.filter(o => o.status === 'failure').length;
  const skipped = outcomes.filter(o => o.status === 'skipped').length;

  const lines = [
    '## Summary',
    `- Project: ${result.projectId}`,
    `- Status: ${result.status}`,
    `- Tasks: ${succeeded}/${outcomes.length} succeeded (${failed} failed, ${skipped} skipped)`,
    '',
    '## Tasks',
    '| Chunk | Status | Iterations |',
    '| --- | --- | --- |',
  ];

  for (const outcome of outcomes) {
    lines.push(`| ${outcome.taskId} | ${outcome.status} | ${formatIterations(outcome)} |`);
  }

  return lines.join('\n');
}

function formatIterations(outcome: TaskOutcome): string {
  const output = outcome.output as { iterations?: unknown } | undefined;
  if (output && typeof output === 'object' && typeof output.iterations === 'number') {
    return String(output.iterations);
  }
  return '-';
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isGhMissing(error: unknown): boolean {
  const message = stringifyError(error);
  return message.includes('gh: command not found') || message.includes('ENOENT') || message.includes('not found');
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
