/**
 * CLI skill types for RALPH-loop orchestration.
 * Types and interfaces only — no implementation code.
 */

export interface IterationResult {
  readonly iteration: number;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly rateLimited: boolean;
  readonly promiseDetected: boolean;
  readonly tokensEstimated: number;
  readonly sleepMs: number;
}

export interface RalphLoopConfig {
  readonly prompt: string;
  readonly promiseTag: string;
  readonly maxIterations: number;
  readonly maxTurns: number;
  readonly provider: 'claude' | 'codex';
  readonly claudeCmd: string;
  readonly codexCmd: string;
  readonly timeoutMs: number;
  readonly workingDir?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly providers?: readonly ('claude' | 'codex')[] | undefined;
  readonly onRateLimit?: ((provider: string) => string | undefined) | undefined;
  readonly onIteration?: ((iteration: number, result: IterationResult) => void) | undefined;
  readonly onSleep?: ((durationMs: number, source: string) => void) | undefined;
  /** @internal Injected sleep function for testing — do not use in production. */
  readonly _sleepFn?: ((ms: number) => Promise<void>) | undefined;
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
