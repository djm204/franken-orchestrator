#!/usr/bin/env node

import { parseArgs, printUsage } from './args.js';
import { loadConfig } from './config-loader.js';

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

  // Subcommand routing will be implemented in later chunks.
  // For now, display what was parsed.
  console.log('Subcommand:', args.subcommand ?? 'none (full flow)');
  console.log('Provider:', args.provider);
  console.log('Budget:', args.budget);
  console.error('Error: Full execution requires later CLI chunks. Use --help for usage.');
  process.exit(1);
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
