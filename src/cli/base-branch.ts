import { execSync } from 'node:child_process';
import type { InterviewIO } from '../planning/interview-loop.js';

/**
 * Detects the current git branch in the given directory.
 * Returns undefined if not in a git repository.
 */
export function detectCurrentBranch(dir: string): string | undefined {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the base branch from CLI args, git detection, or defaults to 'main'.
 * If a branch is detected and differs from 'main', prompts the user to confirm.
 */
export async function resolveBaseBranch(
  root: string,
  cliOverride: string | undefined,
  io: InterviewIO,
): Promise<string> {
  // CLI override takes precedence — no prompting needed
  if (cliOverride) {
    return cliOverride;
  }

  const detected = detectCurrentBranch(root);

  if (!detected) {
    io.display('Not in a git repository. Defaulting to base branch: main');
    return 'main';
  }

  if (detected === 'main' || detected === 'master') {
    return detected;
  }

  // On a non-main branch — ask user to confirm
  const answer = await io.ask(
    `Detected branch: ${detected}. Use as base branch? (y/n)`,
  );

  if (answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes') {
    return detected;
  }

  return 'main';
}
