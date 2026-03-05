#!/usr/bin/env node

import { parseArgs, printUsage } from './args.js';
import { loadConfig } from './config-loader.js';
import { loadContext } from '../resilience/context-serializer.js';

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.projectId && !args.resume) {
    console.error('Error: --project-id is required (or use --resume to continue a saved session)');
    printUsage();
    process.exit(1);
  }

  const config = await loadConfig(args);

  if (args.verbose) {
    console.log('Config:', JSON.stringify(config, null, 2));
  }

  // Resume from saved context
  if (args.resume) {
    const ctx = await loadContext(args.resume);
    console.log(`Resumed session ${ctx.sessionId} from phase: ${ctx.phase}`);
    console.log(`Project: ${ctx.projectId}`);
    console.log(`Intent: ${ctx.sanitizedIntent?.goal ?? ctx.userInput}`);
    if (ctx.plan) {
      console.log(`Plan: ${ctx.plan.tasks.length} task(s)`);
    }
    // Full resume execution would require re-wiring deps + continuing from the saved phase.
    // For now, display the snapshot info.
    return;
  }

  // Dry run: plan only, then print the plan
  if (args.dryRun) {
    console.log(`# Dry Run — Project: ${args.projectId}`);
    console.log();
    console.log('Configuration:');
    console.log(`  Max critique iterations: ${config.maxCritiqueIterations}`);
    console.log(`  Max total tokens: ${config.maxTotalTokens}`);
    console.log(`  Max duration: ${config.maxDurationMs}ms`);
    console.log(`  Heartbeat: ${config.enableHeartbeat ? 'enabled' : 'disabled'}`);
    console.log(`  Tracing: ${config.enableTracing ? 'enabled' : 'disabled'}`);
    console.log(`  Min critique score: ${config.minCritiqueScore}`);
    console.log();
    console.log('Provider:', args.provider ?? 'not specified');
    console.log('Model:', args.model ?? 'not specified');
    console.log();
    console.log('> To run for real, remove the --dry-run flag.');
    return;
  }

  // Full execution requires concrete module implementations,
  // which would be wired up in a production entry point.
  console.log(`Starting Beast Loop for project: ${args.projectId}`);
  console.log('Provider:', args.provider ?? 'default');
  console.log('Model:', args.model ?? 'default');
  console.error('Error: Full execution requires module implementations. Use --dry-run for now.');
  process.exit(1);
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
