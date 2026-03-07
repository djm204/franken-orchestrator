import { describe, it, expect, vi } from 'vitest';
import { PrCreator } from '../../src/closure/pr-creator.js';
import type { BeastResult, TaskOutcome } from '../../src/types.js';

const baseResult: BeastResult = {
  sessionId: 'sess',
  projectId: 'proj-123',
  phase: 'closure',
  status: 'completed',
  tokenSpend: {
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    estimatedCostUsd: 0.01,
  },
  taskResults: [
    { taskId: 'chunk-01', status: 'success' },
    { taskId: 'chunk-02', status: 'success' },
  ],
  durationMs: 100,
};

function makeLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('PrCreator', () => {
  it('skips when disabled', async () => {
    const exec = vi.fn(() => { throw new Error('should not call'); });
    const creator = new PrCreator({ targetBranch: 'main', disabled: true, remote: 'origin' }, exec);
    const logger = makeLogger();

    const result = await creator.create(baseResult, logger);

    expect(result).toBeNull();
    expect(exec).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips when not all tasks completed', async () => {
    const exec = vi.fn(() => '');
    const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);
    const logger = makeLogger();
    const failed: BeastResult = {
      ...baseResult,
      status: 'failed',
      taskResults: [
        { taskId: 'chunk-01', status: 'success' },
        { taskId: 'chunk-02', status: 'failure', error: 'boom' },
      ],
    };

    const result = await creator.create(failed, logger);

    expect(result).toBeNull();
    expect(exec).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('pushes branch and creates PR when no existing PR', async () => {
    const calls: string[] = [];
    const exec = vi.fn((cmd: string) => {
      calls.push(cmd);
      if (cmd.startsWith('git branch --show-current')) return 'feature/branch\n';
      if (cmd.startsWith('git push')) return '';
      if (cmd.startsWith('gh pr list')) return '[]';
      if (cmd.startsWith('gh pr create')) return 'https://example.com/pr/1\n';
      return '';
    });

    const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);
    const logger = makeLogger();
    const result = await creator.create(baseResult, logger);

    expect(result?.url).toBe('https://example.com/pr/1');
    expect(calls[0]).toContain('git branch --show-current');
    expect(calls[1]).toContain('git push origin feature/branch');
    expect(calls[2]).toContain('gh pr list --head feature/branch');
    expect(calls[3]).toContain('gh pr create --base main');

    const createCmd = calls[3] ?? '';
    expect(createCmd).toContain('feat: proj-123');
    expect(createCmd).toContain('| Chunk | Status | Iterations |');
  });

  it('trims PR title to stay under 70 characters', async () => {
    const calls: string[] = [];
    const exec = vi.fn((cmd: string) => {
      calls.push(cmd);
      if (cmd.startsWith('git branch --show-current')) return 'feature/branch\n';
      if (cmd.startsWith('git push')) return '';
      if (cmd.startsWith('gh pr list')) return '[]';
      if (cmd.startsWith('gh pr create')) return 'https://example.com/pr/2\n';
      return '';
    });

    const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);
    const longResult: BeastResult = {
      ...baseResult,
      projectId: 'project-with-a-super-long-identifier-that-should-be-trimmed-for-title-length',
    };

    await creator.create(longResult, makeLogger());

    const createCmd = calls.find(c => c.startsWith('gh pr create')) ?? '';
    const titleMatch = createCmd.match(/--title\s+('.*?'|".*?")/);
    expect(titleMatch).toBeTruthy();
    const rawTitle = titleMatch?.[1] ?? '';
    const title = rawTitle.slice(1, -1);
    expect(title.length).toBeLessThanOrEqual(70);
  });

  it('skips when PR already exists', async () => {
    const exec = vi.fn((cmd: string) => {
      if (cmd.startsWith('git branch --show-current')) return 'feature/branch\n';
      if (cmd.startsWith('git push')) return '';
      if (cmd.startsWith('gh pr list')) return '[{"url":"https://example.com/pr/99"}]';
      return '';
    });

    const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);
    const result = await creator.create(baseResult, makeLogger());

    expect(result).toBeNull();
    expect(exec).toHaveBeenCalledWith(expect.stringContaining('gh pr list --head feature/branch'));
  });

  it('handles missing gh gracefully', async () => {
    const exec = vi.fn((cmd: string) => {
      if (cmd.startsWith('git branch --show-current')) return 'feature/branch\n';
      if (cmd.startsWith('git push')) return '';
      if (cmd.startsWith('gh pr list')) throw new Error('gh: command not found');
      return '';
    });

    const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);
    const logger = makeLogger();
    const result = await creator.create(baseResult, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('handles push failure gracefully', async () => {
    const exec = vi.fn((cmd: string) => {
      if (cmd.startsWith('git branch --show-current')) return 'feature/branch\n';
      if (cmd.startsWith('git push')) throw new Error('push failed');
      return '';
    });

    const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);
    const logger = makeLogger();
    const result = await creator.create(baseResult, logger);

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  describe('generateCommitMessage()', () => {
    it('generates a commit message from LLM when client is provided', async () => {
      const llm = { complete: vi.fn().mockResolvedValue('feat(auth): add JWT validation') };
      const exec = vi.fn(() => '');
      const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec, llm);

      const msg = await creator.generateCommitMessage('src/auth.ts | 42 +++ 3 ---', 'Add JWT authentication');

      expect(msg).toBe('feat(auth): add JWT validation');
      expect(llm.complete).toHaveBeenCalledWith(expect.stringContaining('Add JWT authentication'));
      expect(llm.complete).toHaveBeenCalledWith(expect.stringContaining('src/auth.ts'));
    });

    it('falls back to null when LLM is not provided', async () => {
      const exec = vi.fn(() => '');
      const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);

      const msg = await creator.generateCommitMessage('src/auth.ts | 5 +++', 'Add auth');

      expect(msg).toBeNull();
    });

    it('falls back to null when LLM call fails', async () => {
      const llm = { complete: vi.fn().mockRejectedValue(new Error('rate limited')) };
      const exec = vi.fn(() => '');
      const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec, llm);

      const msg = await creator.generateCommitMessage('src/auth.ts | 5 +++', 'Add auth');

      expect(msg).toBeNull();
    });

    it('trims and strips backticks from LLM response', async () => {
      const llm = { complete: vi.fn().mockResolvedValue('```\nfeat(auth): add JWT\n```\n') };
      const exec = vi.fn(() => '');
      const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec, llm);

      const msg = await creator.generateCommitMessage('diff stat', 'objective');

      expect(msg).toBe('feat(auth): add JWT');
    });

    it('truncates messages longer than 72 chars', async () => {
      const longMsg = 'feat(auth): ' + 'a'.repeat(100);
      const llm = { complete: vi.fn().mockResolvedValue(longMsg) };
      const exec = vi.fn(() => '');
      const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec, llm);

      const msg = await creator.generateCommitMessage('diff stat', 'objective');

      expect(msg!.length).toBeLessThanOrEqual(72);
    });
  });

  it('uses iteration count from output when provided', async () => {
    const exec = vi.fn((cmd: string) => {
      if (cmd.startsWith('git branch --show-current')) return 'feature/branch\n';
      if (cmd.startsWith('git push')) return '';
      if (cmd.startsWith('gh pr list')) return '[]';
      if (cmd.startsWith('gh pr create')) return 'https://example.com/pr/3\n';
      return '';
    });

    const creator = new PrCreator({ targetBranch: 'main', disabled: false, remote: 'origin' }, exec);
    const resultWithIterations: BeastResult = {
      ...baseResult,
      taskResults: [
        { taskId: 'chunk-01', status: 'success', output: { iterations: 3 } },
      ] as TaskOutcome[],
    };

    await creator.create(resultWithIterations, makeLogger());

    const createCmd = exec.mock.calls.find(call => call[0].startsWith('gh pr create'))?.[0] ?? '';
    expect(createCmd).toContain('| chunk-01 | success | 3 |');
  });
});
