import { parseArgs as nodeParseArgs } from 'node:util';

export interface CliArgs {
  projectId: string;
  config?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  dryRun: boolean;
  verbose: boolean;
  resume?: string | undefined;
  help: boolean;
}

const USAGE = `
Usage: frankenbeast [options]

Options:
  --project-id <id>    Project identifier (required)
  --config <path>      Path to config file (JSON)
  --provider <name>    LLM provider (anthropic, openai, local-ollama)
  --model <name>       Model name
  --dry-run            Plan only, do not execute
  --verbose            Enable verbose logging
  --resume <path>      Resume from saved context snapshot
  --help               Show this help message
`.trim();

export function printUsage(): void {
  console.log(USAGE);
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      'project-id': { type: 'string' },
      config: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      resume: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  return {
    projectId: values['project-id'] ?? '',
    config: values.config,
    provider: values.provider,
    model: values.model,
    dryRun: values['dry-run'] ?? false,
    verbose: values.verbose ?? false,
    resume: values.resume,
    help: values.help ?? false,
  };
}
