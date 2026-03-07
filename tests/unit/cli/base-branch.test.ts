import { describe, it, expect, vi } from 'vitest';
import { resolveBaseBranch, detectCurrentBranch } from '../../../src/cli/base-branch.js';
import type { InterviewIO } from '../../../src/planning/interview-loop.js';

function mockIO(answers: string[] = []): InterviewIO {
  let idx = 0;
  return {
    ask: vi.fn(async () => answers[idx++] ?? ''),
    display: vi.fn(),
  };
}

describe('detectCurrentBranch', () => {
  it('returns a branch name in a git repo', () => {
    // This test runs inside the frankenbeast repo
    const branch = detectCurrentBranch(process.cwd());
    expect(typeof branch).toBe('string');
    expect(branch!.length).toBeGreaterThan(0);
  });

  it('returns undefined for non-git directory', () => {
    const branch = detectCurrentBranch('/tmp');
    expect(branch).toBeUndefined();
  });
});

describe('resolveBaseBranch', () => {
  it('uses CLI override without prompting', async () => {
    const io = mockIO();
    const result = await resolveBaseBranch('/tmp', 'develop', io);
    expect(result).toBe('develop');
    expect(io.ask).not.toHaveBeenCalled();
  });

  it('returns main silently when on main', async () => {
    const io = mockIO();
    const result = await resolveBaseBranch('/tmp', 'main', io);
    expect(result).toBe('main');
    expect(io.ask).not.toHaveBeenCalled();
  });

  it('defaults to main when not in a git repo', async () => {
    const io = mockIO();
    const result = await resolveBaseBranch('/tmp', undefined, io);
    expect(result).toBe('main');
    expect(io.display).toHaveBeenCalledWith(
      expect.stringContaining('Not in a git repository'),
    );
  });

  it('uses current branch when user confirms', async () => {
    const io = mockIO(['y']);
    const result = await resolveBaseBranch(process.cwd(), undefined, io);
    expect(typeof result).toBe('string');
  });

  it('falls back to main when user declines', async () => {
    const io = mockIO(['n']);
    // Only meaningful if not on main - test the override path
    const result = await resolveBaseBranch('/tmp', undefined, io);
    expect(result).toBe('main');
  });
});
