import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../../src/cli/args.js';

describe('parseArgs', () => {
  it('returns defaults with no args', () => {
    const args = parseArgs([]);
    expect(args.subcommand).toBeUndefined();
    expect(args.budget).toBe(10);
    expect(args.provider).toBe('claude');
    expect(args.noPr).toBe(false);
    expect(args.verbose).toBe(false);
    expect(args.reset).toBe(false);
    expect(args.resume).toBe(false);
    expect(args.help).toBe(false);
  });

  it('parses interview subcommand', () => {
    const args = parseArgs(['interview']);
    expect(args.subcommand).toBe('interview');
  });

  it('parses plan subcommand with design-doc', () => {
    const args = parseArgs(['plan', '--design-doc', '/path/to/design.md']);
    expect(args.subcommand).toBe('plan');
    expect(args.designDoc).toBe('/path/to/design.md');
  });

  it('parses run subcommand with resume', () => {
    const args = parseArgs(['run', '--resume']);
    expect(args.subcommand).toBe('run');
    expect(args.resume).toBe(true);
  });

  it('parses global flags without subcommand', () => {
    const args = parseArgs([
      '--base-dir', '/my/project',
      '--base-branch', 'develop',
      '--budget', '25',
      '--provider', 'codex',
      '--no-pr',
      '--verbose',
      '--reset',
    ]);
    expect(args.subcommand).toBeUndefined();
    expect(args.baseDir).toBe('/my/project');
    expect(args.baseBranch).toBe('develop');
    expect(args.budget).toBe(25);
    expect(args.provider).toBe('codex');
    expect(args.noPr).toBe(true);
    expect(args.verbose).toBe(true);
    expect(args.reset).toBe(true);
  });

  it('defaults provider to claude for unknown values', () => {
    const args = parseArgs(['--provider', 'unknown']);
    expect(args.provider).toBe('claude');
  });

  it('parses --design-doc without subcommand', () => {
    const args = parseArgs(['--design-doc', 'plan.md']);
    expect(args.subcommand).toBeUndefined();
    expect(args.designDoc).toBe('plan.md');
  });

  it('parses --plan-dir without subcommand', () => {
    const args = parseArgs(['--plan-dir', './chunks']);
    expect(args.subcommand).toBeUndefined();
    expect(args.planDir).toBe('./chunks');
  });

  it('parses --help', () => {
    const args = parseArgs(['--help']);
    expect(args.help).toBe(true);
  });

  it('parses --config', () => {
    const args = parseArgs(['--config', 'frankenbeast.json']);
    expect(args.config).toBe('frankenbeast.json');
  });
});
