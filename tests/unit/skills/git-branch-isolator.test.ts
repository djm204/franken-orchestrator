import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitIsolationConfig } from '../../../src/skills/cli-types.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { GitBranchIsolator, parseDirtySubmodules } from '../../../src/skills/git-branch-isolator.js';

const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;

function makeConfig(overrides?: Partial<GitIsolationConfig>): GitIsolationConfig {
  return {
    baseBranch: 'main',
    branchPrefix: 'chunk/',
    autoCommit: true,
    workingDir: '/fake/repo',
    ...overrides,
  };
}

describe('GitBranchIsolator', () => {
  let isolator: GitBranchIsolator;

  beforeEach(() => {
    vi.resetAllMocks();
    mockExecSync.mockReturnValue('');
    isolator = new GitBranchIsolator(makeConfig());
  });

  describe('isolate()', () => {
    it('creates a new branch from baseBranch and checks it out', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git branch --list chunk/03_my_chunk') return '';
        return '';
      });
      isolator.isolate('03_my_chunk');

      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout main',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'git branch --list chunk/03_my_chunk',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout -b chunk/03_my_chunk',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('checks out existing branch when it already exists', () => {
      mockExecSync
        .mockReturnValueOnce('') // git checkout main
        .mockReturnValueOnce('  chunk/03_my_chunk\n') // git branch --list
        .mockReturnValueOnce(''); // git checkout (existing)

      isolator.isolate('03_my_chunk');

      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout chunk/03_my_chunk',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
      expect(mockExecSync).not.toHaveBeenCalledWith(
        'git checkout -b chunk/03_my_chunk',
        expect.anything(),
      );
    });
  });

  describe('autoCommit()', () => {
    it('commits dirty files and returns true', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return ' M src/foo.ts\n';
        return '';
      });

      const committed = isolator.autoCommit('03_my_chunk', 'impl', 2);

      expect(committed).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git add -A',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'git commit -m "auto: impl 03_my_chunk iter 2"',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('returns false with clean working tree (no-op)', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return '';
        return '';
      });

      const committed = isolator.autoCommit('03_my_chunk', 'impl', 1);

      expect(committed).toBe(false);
    });

    it('returns false on commit failure without throwing', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return ' M file.ts\n';
        if (cmd === 'git add -A') return '';
        if (cmd.startsWith('git commit')) throw new Error('commit failed');
        return '';
      });

      const committed = isolator.autoCommit('03_my_chunk', 'impl', 1);

      expect(committed).toBe(false);
    });
  });

  describe('merge()', () => {
    it('merges chunk branch back to baseBranch and returns commit count', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-list --count main..chunk/03_my_chunk') return '3\n';
        return '';
      });

      const result = isolator.merge('03_my_chunk');

      expect(result).toEqual({ merged: true, commits: 3 });
      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout main',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge chunk/03_my_chunk --no-edit',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('skips merge for empty branches (0 commits)', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-list --count main..chunk/03_my_chunk') return '0\n';
        return '';
      });

      const result = isolator.merge('03_my_chunk');

      expect(result).toEqual({ merged: false, commits: 0 });
    });

    it('aborts on merge conflict and returns merged: false', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-list --count main..chunk/03_my_chunk') return '2\n';
        if (cmd === 'git checkout main') return '';
        if (cmd === 'git merge chunk/03_my_chunk --no-edit') {
          throw new Error('CONFLICT (content): Merge conflict');
        }
        return '';
      });

      const result = isolator.merge('03_my_chunk');

      expect(result).toEqual({ merged: false, commits: 2 });
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge --abort',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('uses squash merge when commitMessage is provided', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-list --count main..chunk/03_my_chunk') return '3\n';
        return '';
      });

      const result = isolator.merge('03_my_chunk', 'feat(types): add shared type definitions');

      expect(result).toEqual({ merged: true, commits: 3 });
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge --squash chunk/03_my_chunk',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'git commit -m "feat(types): add shared type definitions"',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('falls back to regular merge when no commitMessage provided', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-list --count main..chunk/03_my_chunk') return '3\n';
        return '';
      });

      const result = isolator.merge('03_my_chunk');

      expect(result).toEqual({ merged: true, commits: 3 });
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge chunk/03_my_chunk --no-edit',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('aborts squash merge on conflict and returns merged: false', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-list --count main..chunk/03_my_chunk') return '2\n';
        if (cmd === 'git checkout main') return '';
        if (cmd === 'git merge --squash chunk/03_my_chunk') {
          throw new Error('CONFLICT');
        }
        return '';
      });

      const result = isolator.merge('03_my_chunk', 'feat(types): add types');

      expect(result).toEqual({ merged: false, commits: 2 });
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge --abort',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('sanitizes commitMessage to prevent shell injection', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-list')) return '1\n';
        return '';
      });

      isolator.merge('03_my_chunk', 'feat(types): add "shared" types');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('feat(types): add \\"shared\\" types'),
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });
  });

  describe('hasMeaningfulChange()', () => {
    it('returns true when working tree is dirty', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return ' M changed.ts\n';
        if (cmd === 'git rev-parse HEAD') return 'abc123';
        return '';
      });

      expect(isolator.hasMeaningfulChange('abc123')).toBe(true);
    });

    it('returns true when HEAD has advanced past previousHead', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return '';
        if (cmd === 'git rev-parse HEAD') return 'def456';
        return '';
      });

      expect(isolator.hasMeaningfulChange('abc123')).toBe(true);
    });

    it('returns false when clean and HEAD unchanged', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return '';
        if (cmd === 'git rev-parse HEAD') return 'abc123';
        return '';
      });

      expect(isolator.hasMeaningfulChange('abc123')).toBe(false);
    });
  });

  describe('getCurrentHead()', () => {
    it('returns the current HEAD commit hash', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return '  abc123def456  \n';
        return '';
      });

      expect(isolator.getCurrentHead()).toBe('abc123def456');
    });
  });

  describe('getDiffStat()', () => {
    it('returns diff stat between base branch and chunk branch', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git diff --stat main..chunk/03_my_chunk') {
          return ' src/foo.ts | 10 +++\n 1 file changed\n';
        }
        return '';
      });

      expect(isolator.getDiffStat('03_my_chunk')).toBe('src/foo.ts | 10 +++\n 1 file changed');
    });
  });

  describe('shell safety', () => {
    it('rejects chunkIds with shell-unsafe characters', () => {
      expect(() => isolator.isolate('chunk; rm -rf /')).toThrow();
      expect(() => isolator.autoCommit('chunk$(evil)', 'impl', 1)).toThrow();
      expect(() => isolator.merge('chunk`whoami`')).toThrow();
    });
  });

  describe('autoCommit() submodule awareness', () => {
    it('commits inside dirty submodules before root commit', () => {
      const calls: Array<{ cmd: string; cwd: string }> = [];
      mockExecSync.mockImplementation((cmd: string, opts?: Record<string, unknown>) => {
        const cwd = (opts?.cwd as string) ?? '?';
        calls.push({ cmd, cwd });
        if (cmd === 'git status --porcelain') return ' m franken-orchestrator\n';
        return '';
      });

      isolator.autoCommit('03_my_chunk', 'impl', 1);

      // Should have committed inside the submodule first
      const subAdd = calls.find(c => c.cmd === 'git add -A' && c.cwd.includes('franken-orchestrator'));
      const subCommit = calls.find(c => c.cmd.startsWith('git commit') && c.cwd.includes('franken-orchestrator'));
      expect(subAdd).toBeDefined();
      expect(subCommit).toBeDefined();

      // Then root repo commit
      const rootAdd = calls.find(c => c.cmd === 'git add -A' && c.cwd === '/fake/repo');
      const rootCommit = calls.find(c => c.cmd.startsWith('git commit -m') && c.cwd === '/fake/repo');
      expect(rootAdd).toBeDefined();
      expect(rootCommit).toBeDefined();

      // Submodule commits happen before root commits
      const subAddIdx = calls.indexOf(subAdd!);
      const rootAddIdx = calls.indexOf(rootAdd!);
      expect(subAddIdx).toBeLessThan(rootAddIdx);
    });

    it('handles multiple dirty submodules', () => {
      const subCwds: string[] = [];
      mockExecSync.mockImplementation((cmd: string, opts?: Record<string, unknown>) => {
        const cwd = (opts?.cwd as string) ?? '';
        if (cmd === 'git add -A' && cwd !== '/fake/repo') {
          subCwds.push(cwd);
        }
        if (cmd === 'git status --porcelain') {
          return ' m franken-orchestrator\n m franken-types\n';
        }
        return '';
      });

      isolator.autoCommit('03_my_chunk', 'impl', 1);

      expect(subCwds).toContain('/fake/repo/franken-orchestrator');
      expect(subCwds).toContain('/fake/repo/franken-types');
    });

    it('skips submodule commit when submodule has nothing to commit', () => {
      mockExecSync.mockImplementation((cmd: string, opts?: { cwd?: string }) => {
        if (cmd === 'git status --porcelain') return ' m franken-orchestrator\n';
        if (cmd.startsWith('git commit') && opts?.cwd?.includes('franken-orchestrator')) {
          throw new Error('nothing to commit');
        }
        return '';
      });

      // Should not throw — submodule failure is caught
      const result = isolator.autoCommit('03_my_chunk', 'impl', 1);
      expect(result).toBe(true);
    });

    it('does not attempt submodule commits when status has no submodule lines', () => {
      const calls: string[] = [];
      mockExecSync.mockImplementation((cmd: string, opts?: { cwd?: string }) => {
        calls.push(`${cmd} @ ${opts?.cwd ?? '?'}`);
        if (cmd === 'git status --porcelain') return ' M src/foo.ts\n';
        return '';
      });

      isolator.autoCommit('03_my_chunk', 'impl', 1);

      // No calls to submodule directories
      const subCalls = calls.filter(c => !c.endsWith('@ /fake/repo') && !c.endsWith('@ ?'));
      expect(subCalls).toEqual([]);
    });
  });
});

describe('parseDirtySubmodules()', () => {
  it('extracts submodule paths from porcelain output', () => {
    const status = ' m franken-orchestrator\n M README.md\n?? new-file.ts\n';
    expect(parseDirtySubmodules(status)).toEqual(['franken-orchestrator']);
  });

  it('returns empty array when no dirty submodules', () => {
    expect(parseDirtySubmodules(' M src/foo.ts\n')).toEqual([]);
    expect(parseDirtySubmodules('')).toEqual([]);
  });

  it('handles multiple dirty submodules', () => {
    const status = ' m franken-orchestrator\n m franken-types\n M file.ts\n';
    expect(parseDirtySubmodules(status)).toEqual(['franken-orchestrator', 'franken-types']);
  });

  it('handles trimmed output where first line loses leading space', () => {
    // this.git() calls .trim() which strips the leading space from the first line
    const trimmed = 'm franken-orchestrator\n m franken-types';
    expect(parseDirtySubmodules(trimmed)).toEqual(['franken-orchestrator', 'franken-types']);
  });

  it('does not match regular modified files (capital M)', () => {
    expect(parseDirtySubmodules('M  src/foo.ts\n')).toEqual([]);
    expect(parseDirtySubmodules(' M src/foo.ts\n')).toEqual([]);
  });
});
