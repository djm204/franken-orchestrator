#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { parseArgs, printUsage } from './args.js';
import type { CliArgs } from './args.js';
import { loadConfig } from './config-loader.js';
import { resolveProjectRoot, getProjectPaths, scaffoldFrankenbeast } from './project-root.js';
import { resolveBaseBranch } from './base-branch.js';
import { Session } from './session.js';
import type { SessionPhase } from './session.js';
import type { InterviewIO } from '../planning/interview-loop.js';
import { BANNER } from '../logging/beast-logger.js';

/**
 * Creates an InterviewIO backed by stdin/stdout.
 */
export function createStdinIO(): InterviewIO {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (question: string) =>
      new Promise<string>((resolve) => rl.question(`${question}\n> `, resolve)),
    display: (message: string) => console.log(message),
  };
}

/**
 * Determines entry phase and exit behavior from CLI args.
 * Subcommand takes precedence, then flags, then default.
 */
export function resolvePhases(args: Pick<CliArgs, 'subcommand' | 'designDoc' | 'planDir'>): {
  entryPhase: SessionPhase;
  exitAfter?: SessionPhase;
} {
  // Subcommand mode
  if (args.subcommand === 'interview') {
    return { entryPhase: 'interview', exitAfter: 'interview' };
  }
  if (args.subcommand === 'plan') {
    return { entryPhase: 'plan', exitAfter: 'plan' };
  }
  if (args.subcommand === 'run') {
    return { entryPhase: 'execute' };
  }

  // Default mode — detect entry from provided files
  if (args.planDir) {
    return { entryPhase: 'execute' };
  }
  if (args.designDoc) {
    return { entryPhase: 'plan' };
  }

  // No files, no subcommand — full interactive flow
  return { entryPhase: 'interview' };
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const config = await loadConfig(args);

  if (args.verbose) {
    console.log('Config:', JSON.stringify(config, null, 2));
  }

  console.log(BANNER);

  // Resolve project root
  const root = resolveProjectRoot(args.baseDir);
  const paths = getProjectPaths(root);
  scaffoldFrankenbeast(paths);

  // Create IO for interactive prompts
  const io = createStdinIO();

  // Resolve base branch
  const baseBranch = await resolveBaseBranch(root, args.baseBranch, io);

  // Determine phases
  const { entryPhase, exitAfter } = resolvePhases(args);

  // Create and run session
  const session = new Session({
    paths,
    baseBranch,
    budget: args.budget,
    provider: args.provider,
    noPr: args.noPr,
    verbose: args.verbose,
    reset: args.reset,
    io,
    entryPhase,
    ...(exitAfter !== undefined ? { exitAfter } : {}),
    ...(args.designDoc !== undefined ? { designDocPath: args.designDoc } : {}),
    ...(args.planDir !== undefined ? { planDirOverride: args.planDir } : {}),
  });

  const result = await session.start();

  if (result && result.status !== 'completed') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
