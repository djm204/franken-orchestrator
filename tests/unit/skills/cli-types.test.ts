import { describe, it, expect, expectTypeOf } from 'vitest';
import type { SkillDescriptor } from '../../../src/deps.js';
import type {
  RalphLoopConfig,
  RalphLoopResult,
  GitIsolationConfig,
  CliSkillConfig,
} from '../../../src/skills/cli-types.js';

describe('SkillDescriptor.executionType', () => {
  it('accepts cli as a valid execution type', () => {
    const descriptor: SkillDescriptor = {
      id: 'cli-skill',
      name: 'CLI Skill',
      requiresHitl: false,
      executionType: 'cli',
    };
    expect(descriptor.executionType).toBe('cli');
  });

  it('still accepts existing execution types', () => {
    const types: SkillDescriptor['executionType'][] = ['llm', 'function', 'mcp', 'cli'];
    expect(types).toHaveLength(4);
  });
});

describe('RalphLoopConfig', () => {
  it('has all required readonly properties (without claudeCmd/codexCmd)', () => {
    const config: RalphLoopConfig = {
      prompt: 'Implement feature X',
      promiseTag: 'IMPL_X_DONE',
      maxIterations: 5,
      maxTurns: 50,
      provider: 'claude',
      timeoutMs: 300_000,
    };

    expect(config.prompt).toBe('Implement feature X');
    expect(config.promiseTag).toBe('IMPL_X_DONE');
    expect(config.maxIterations).toBe(5);
    expect(config.maxTurns).toBe(50);
    expect(config.provider).toBe('claude');
    expect(config.timeoutMs).toBe(300_000);
  });

  it('accepts any string as provider (not union)', () => {
    expectTypeOf<RalphLoopConfig['provider']>().toEqualTypeOf<string>();
    const config: RalphLoopConfig = {
      prompt: 'test',
      promiseTag: 'TEST',
      maxIterations: 1,
      maxTurns: 10,
      provider: 'gemini',
      timeoutMs: 60_000,
    };
    expect(config.provider).toBe('gemini');
  });

  it('has optional command field replacing claudeCmd/codexCmd', () => {
    const withCommand: RalphLoopConfig = {
      prompt: 'test',
      promiseTag: 'TEST',
      maxIterations: 1,
      maxTurns: 10,
      provider: 'aider',
      command: '/usr/local/bin/aider',
      timeoutMs: 60_000,
    };
    expect(withCommand.command).toBe('/usr/local/bin/aider');

    const withoutCommand: RalphLoopConfig = {
      prompt: 'test',
      promiseTag: 'TEST',
      maxIterations: 1,
      maxTurns: 10,
      provider: 'claude',
      timeoutMs: 60_000,
    };
    expect(withoutCommand.command).toBeUndefined();
  });

  it('accepts providers as readonly string array', () => {
    const config: RalphLoopConfig = {
      prompt: 'test',
      promiseTag: 'TEST',
      maxIterations: 1,
      maxTurns: 10,
      provider: 'claude',
      timeoutMs: 60_000,
      providers: ['claude', 'gemini', 'aider'],
    };
    expect(config.providers).toEqual(['claude', 'gemini', 'aider']);
  });

  it('has readonly properties', () => {
    expectTypeOf<RalphLoopConfig>().toHaveProperty('prompt');
    expectTypeOf<Readonly<RalphLoopConfig>>().toEqualTypeOf<RalphLoopConfig>();
  });
});

describe('RalphLoopResult', () => {
  it('has all required readonly properties', () => {
    const result: RalphLoopResult = {
      completed: true,
      iterations: 3,
      output: 'Feature implemented successfully',
      tokensUsed: 12_500,
    };

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.output).toBe('Feature implemented successfully');
    expect(result.tokensUsed).toBe(12_500);
  });

  it('has readonly properties', () => {
    expectTypeOf<Readonly<RalphLoopResult>>().toEqualTypeOf<RalphLoopResult>();
  });
});

describe('GitIsolationConfig', () => {
  it('has all required readonly properties', () => {
    const config: GitIsolationConfig = {
      baseBranch: 'main',
      branchPrefix: 'feat/',
      autoCommit: true,
      workingDir: '/home/user/project',
    };

    expect(config.baseBranch).toBe('main');
    expect(config.branchPrefix).toBe('feat/');
    expect(config.autoCommit).toBe(true);
    expect(config.workingDir).toBe('/home/user/project');
  });

  it('has readonly properties', () => {
    expectTypeOf<Readonly<GitIsolationConfig>>().toEqualTypeOf<GitIsolationConfig>();
  });
});

describe('CliSkillConfig', () => {
  it('has required ralph and git properties', () => {
    const config: CliSkillConfig = {
      ralph: {
        prompt: 'Do the thing',
        promiseTag: 'THING_DONE',
        maxIterations: 3,
        maxTurns: 30,
        provider: 'codex',
        timeoutMs: 60_000,
      },
      git: {
        baseBranch: 'main',
        branchPrefix: 'feat/',
        autoCommit: false,
        workingDir: '.',
      },
    };

    expect(config.ralph.prompt).toBe('Do the thing');
    expect(config.git.baseBranch).toBe('main');
    expect(config.budgetLimitUsd).toBeUndefined();
  });

  it('accepts optional budgetLimitUsd', () => {
    const config: CliSkillConfig = {
      ralph: {
        prompt: 'Do the thing',
        promiseTag: 'THING_DONE',
        maxIterations: 3,
        maxTurns: 30,
        provider: 'claude',
        timeoutMs: 60_000,
      },
      git: {
        baseBranch: 'main',
        branchPrefix: 'feat/',
        autoCommit: true,
        workingDir: '.',
      },
      budgetLimitUsd: 5.0,
    };

    expect(config.budgetLimitUsd).toBe(5.0);
  });

  it('has readonly properties', () => {
    expectTypeOf<Readonly<CliSkillConfig>>().toEqualTypeOf<CliSkillConfig>();
  });
});
