/**
 * CLI skill types for RALPH-loop orchestration.
 * Types and interfaces only — no implementation code.
 */

export interface RalphLoopConfig {
  readonly prompt: string;
  readonly promiseTag: string;
  readonly maxIterations: number;
  readonly maxTurns: number;
  readonly provider: 'claude' | 'codex';
  readonly claudeCmd: string;
  readonly codexCmd: string;
  readonly timeoutMs: number;
}

export interface RalphLoopResult {
  readonly completed: boolean;
  readonly iterations: number;
  readonly output: string;
  readonly tokensUsed: number;
}

export interface GitIsolationConfig {
  readonly baseBranch: string;
  readonly branchPrefix: string;
  readonly autoCommit: boolean;
  readonly workingDir: string;
}

export interface CliSkillConfig {
  readonly ralph: RalphLoopConfig;
  readonly git: GitIsolationConfig;
  readonly budgetLimitUsd?: number | undefined;
}
