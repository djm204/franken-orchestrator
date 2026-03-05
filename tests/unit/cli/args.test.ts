import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../../src/cli/args.js';

describe('CLI args parser', () => {
  it('parses --project-id', () => {
    const args = parseArgs(['--project-id', 'my-project']);
    expect(args.projectId).toBe('my-project');
  });

  it('parses --dry-run', () => {
    const args = parseArgs(['--project-id', 'p', '--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('parses --verbose', () => {
    const args = parseArgs(['--project-id', 'p', '--verbose']);
    expect(args.verbose).toBe(true);
  });

  it('parses --config', () => {
    const args = parseArgs(['--project-id', 'p', '--config', '/path/to/config.json']);
    expect(args.config).toBe('/path/to/config.json');
  });

  it('parses --provider and --model', () => {
    const args = parseArgs(['--project-id', 'p', '--provider', 'anthropic', '--model', 'claude-3']);
    expect(args.provider).toBe('anthropic');
    expect(args.model).toBe('claude-3');
  });

  it('parses --resume', () => {
    const args = parseArgs(['--resume', '/tmp/snapshot.json']);
    expect(args.resume).toBe('/tmp/snapshot.json');
  });

  it('parses --help', () => {
    const args = parseArgs(['--help']);
    expect(args.help).toBe(true);
  });

  it('defaults dry-run and verbose to false', () => {
    const args = parseArgs(['--project-id', 'p']);
    expect(args.dryRun).toBe(false);
    expect(args.verbose).toBe(false);
  });

  it('defaults projectId to empty string when not provided', () => {
    const args = parseArgs([]);
    expect(args.projectId).toBe('');
  });
});
