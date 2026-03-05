import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitIsolationConfig } from '../../../src/skills/cli-types.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { GitBranchIsolator } from '../../../src/skills/git-branch-isolator.js';

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
      isolator.isolate('03_my_chunk');

      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout main',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout -b chunk/03_my_chunk',
        expect.objectContaining({ cwd: '/fake/repo' }),
      );
    });

    it('checks out existing branch if creation fails', () => {
      mockExecSync
        .mockReturnValueOnce('') // git checkout main
        .mockImplementationOnce(() => {
          throw new Error('branch already exists');
        }) // git checkout -b fails
        .mockReturnValueOnce(''); // git checkout (existing)

      isolator.isolate('03_my_chunk');

      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout chunk/03_my_chunk',
        expect.objectContaining({ cwd: '/fake/repo' }),
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

  describe('shell safety', () => {
    it('rejects chunkIds with shell-unsafe characters', () => {
      expect(() => isolator.isolate('chunk; rm -rf /')).toThrow();
      expect(() => isolator.autoCommit('chunk$(evil)', 'impl', 1)).toThrow();
      expect(() => isolator.merge('chunk`whoami`')).toThrow();
    });
  });
});
