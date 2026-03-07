import { writeFileSync, readFileSync } from 'node:fs';
import type { ProjectPaths } from './project-root.js';

/**
 * Writes the design document to .frankenbeast/plans/design.md.
 * Overwrites if it already exists (revision case).
 * Returns the absolute path written.
 */
export function writeDesignDoc(paths: ProjectPaths, content: string): string {
  writeFileSync(paths.designDocFile, content, 'utf-8');
  return paths.designDocFile;
}

/**
 * Reads the design document from .frankenbeast/plans/design.md.
 * Returns undefined if not found.
 */
export function readDesignDoc(paths: ProjectPaths): string | undefined {
  try {
    return readFileSync(paths.designDocFile, 'utf-8');
  } catch {
    return undefined;
  }
}
