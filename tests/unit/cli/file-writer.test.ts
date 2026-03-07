import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getProjectPaths, scaffoldFrankenbeast } from '../../../src/cli/project-root.js';
import { writeDesignDoc, readDesignDoc } from '../../../src/cli/file-writer.js';

describe('file-writer (design doc)', () => {
  const testDir = resolve(tmpdir(), 'fb-test-file-writer');
  let paths: ReturnType<typeof getProjectPaths>;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    paths = getProjectPaths(testDir);
    scaffoldFrankenbeast(paths);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('writeDesignDoc', () => {
    it('writes design doc to plans directory', () => {
      const result = writeDesignDoc(paths, '# My Design');
      expect(result).toBe(paths.designDocFile);
      expect(readFileSync(paths.designDocFile, 'utf-8')).toBe('# My Design');
    });

    it('overwrites existing design doc', () => {
      writeDesignDoc(paths, 'v1');
      writeDesignDoc(paths, 'v2');
      expect(readFileSync(paths.designDocFile, 'utf-8')).toBe('v2');
    });

    it('returns the absolute path', () => {
      const result = writeDesignDoc(paths, 'content');
      expect(result).toContain('.frankenbeast/plans/design.md');
    });
  });

  describe('readDesignDoc', () => {
    it('reads existing design doc', () => {
      writeDesignDoc(paths, '# Existing');
      expect(readDesignDoc(paths)).toBe('# Existing');
    });

    it('returns undefined when no design doc exists', () => {
      expect(readDesignDoc(paths)).toBeUndefined();
    });
  });
});
