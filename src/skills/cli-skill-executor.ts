import { execSync } from 'node:child_process';
import type { RalphLoopConfig, RalphLoopResult, IterationResult, CliSkillConfig } from './cli-types.js';
import type { SkillInput, SkillResult, ICheckpointStore, ILogger } from '../deps.js';
import type { RalphLoop } from './ralph-loop.js';
import type { GitBranchIsolator } from './git-branch-isolator.js';

// ── Observer interfaces (no direct @frankenbeast/observer import) ──

export interface Span {
  readonly id: string;
}

export interface Trace {
  readonly id: string;
}

export interface TokenTotals {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface TokenRecord {
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly model?: string;
}

export interface TokenCounter {
  grandTotal(): TokenTotals;
  allModels(): string[];
  totalsFor(model: string): TokenTotals;
}

export interface CostCalculator {
  totalCost(entries: TokenRecord[]): number;
}

export interface CircuitBreakerResult {
  readonly tripped: boolean;
  readonly limitUsd: number;
  readonly spendUsd: number;
}

export interface CircuitBreaker {
  check(spendUsd: number): CircuitBreakerResult;
}

export interface LoopDetector {
  check(spanName: string): { detected: boolean };
}

export interface ObserverDeps {
  readonly trace: Trace;
  readonly counter: TokenCounter;
  readonly costCalc: CostCalculator;
  readonly breaker: CircuitBreaker;
  readonly loopDetector: LoopDetector;
  startSpan(trace: Trace, opts: { name: string; parentSpanId?: string }): Span;
  endSpan(span: Span, opts?: { status?: string; errorMessage?: string }, loopDetector?: LoopDetector): void;
  recordTokenUsage(span: Span, usage: TokenUsage, counter?: TokenCounter): void;
  setMetadata(span: Span, data: Record<string, unknown>): void;
}

// ── Budget error ──

export class BudgetExceededError extends Error {
  readonly spent: number;
  readonly limit: number;

  constructor(spent: number, limit: number) {
    super(`Budget exceeded: $${spent.toFixed(2)} / $${limit.toFixed(2)}`);
    this.name = 'BudgetExceededError';
    this.spent = spent;
    this.limit = limit;
  }
}

// ── CliSkillExecutor ──

export class CliSkillExecutor {
  private readonly ralph: RalphLoop;
  private readonly git: GitBranchIsolator;
  private readonly observer: ObserverDeps;
  private readonly verifyCommand?: string | undefined;
  private readonly logger?: ILogger | undefined;

  constructor(
    ralph: RalphLoop,
    git: GitBranchIsolator,
    observer: ObserverDeps,
    verifyCommand?: string,
    logger?: ILogger,
  ) {
    this.ralph = ralph;
    this.git = git;
    this.observer = observer;
    this.verifyCommand = verifyCommand;
    this.logger = logger;
  }

  async recoverDirtyFiles(
    taskId: string,
    stage: string,
    checkpoint: ICheckpointStore,
    logger?: ILogger,
  ): Promise<'clean' | 'committed' | 'reset'> {
    const status = this.git.getStatus();
    if (status.length === 0) return 'clean';
    const chunkId = this.extractChunkId(taskId);

    if (this.verifyCommand) {
      try {
        execSync(this.verifyCommand, {
          encoding: 'utf-8',
          cwd: this.git.getWorkingDir(),
          stdio: 'pipe',
        });
      } catch {
        // Verification failed — reset to last known good commit
        const lastHash = checkpoint.lastCommit(taskId, stage);
        if (lastHash) {
          this.git.resetHard(lastHash);
          logger?.warn('Recovery: reset to last good commit', { taskId, commitHash: lastHash });
        }
        return 'reset';
      }
    }

    // Verification passed (or no verify command) — auto-commit dirty files
    this.git.autoCommit(chunkId, 'recovery', 0);
    const commitHash = this.git.getCurrentHead();
    checkpoint.recordCommit(taskId, stage, -1, commitHash);
    logger?.info('Recovery: auto-committed dirty files', { taskId });
    return 'committed';
  }

  async execute(skillId: string, input: SkillInput, config: CliSkillConfig, checkpoint?: ICheckpointStore, taskId?: string): Promise<SkillResult> {
    if (!skillId || skillId.trim().length === 0) {
      throw new Error('skillId must not be empty');
    }

    const chunkId = this.extractChunkId(skillId);
    const chunkSpan = this.observer.startSpan(this.observer.trace, { name: `cli:${chunkId}` });

    // Snapshot pre-chunk tokens for diff
    const preTokens = this.observer.counter.grandTotal();

    // Pre-loop budget check (before each iteration — including the first)
    const preCost = this.computeCurrentCost();
    const preCheck = this.observer.breaker.check(preCost);
    if (preCheck.tripped) {
      this.observer.endSpan(chunkSpan, { status: 'error', errorMessage: 'budget-exceeded' });
      return {
        output: `Budget exceeded: $${preCheck.spendUsd.toFixed(2)} / $${preCheck.limitUsd.toFixed(2)}`,
        tokensUsed: 0,
      };
    }

    // Git isolation
    try {
      this.git.isolate(chunkId);
    } catch (err) {
      this.observer.endSpan(chunkSpan, { status: 'error', errorMessage: String(err) });
      throw new Error(
        `Git isolation failed for chunk "${chunkId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Build ralph config with defaults from input when not explicitly provided
    const isImpl = taskId?.startsWith('impl:') ?? true;
    const defaultPromiseTag = isImpl ? `IMPL_${chunkId}_DONE` : `HARDEN_${chunkId}_DONE`;
    const ralphDefaults: RalphLoopConfig = {
      prompt: input.objective,
      promiseTag: defaultPromiseTag,
      maxIterations: 10,
      maxTurns: 25,
      provider: 'claude',
      claudeCmd: 'claude',
      codexCmd: 'codex',
      timeoutMs: 600_000,
      workingDir: this.git.getWorkingDir(),
    };

    // Wire onIteration for observer integration
    const wrappedConfig: RalphLoopConfig = {
      ...ralphDefaults,
      ...config.ralph,
      onRateLimit: (provider: string) => {
        this.logger?.warn('RalphLoop: provider rate limited', { chunkId, provider });
        return config.ralph?.onRateLimit?.(provider);
      },
      onProviderAttempt: (provider: string, iteration: number) => {
        this.logger?.info('RalphLoop: provider attempt', { chunkId, provider, iteration });
        config.ralph?.onProviderAttempt?.(provider, iteration);
      },
      onProviderSwitch: (fromProvider: string, toProvider: string, reason: 'rate-limit' | 'post-sleep-reset') => {
        this.logger?.warn('RalphLoop: provider switch', { chunkId, fromProvider, toProvider, reason });
        config.ralph?.onProviderSwitch?.(fromProvider, toProvider, reason);
      },
      onSpawnError: (provider: string, error: string) => {
        this.logger?.error('RalphLoop: provider spawn error', { chunkId, provider, error });
        config.ralph?.onSpawnError?.(provider, error);
      },
      onProviderTimeout: (provider: string, timeoutMs: number) => {
        this.logger?.warn('RalphLoop: provider iteration timeout', { chunkId, provider, timeoutMs });
        config.ralph?.onProviderTimeout?.(provider, timeoutMs);
      },
      onSleep: (durationMs: number, source: string) => {
        this.logger?.warn('RalphLoop: sleeping for rate limit reset', {
          chunkId,
          durationMs,
          source,
        });
        config.ralph?.onSleep?.(durationMs, source);
      },
      onIteration: (iteration: number, result: IterationResult) => {
        this.logger?.info('RalphLoop: iteration complete', {
          chunkId,
          iteration,
          exitCode: result.exitCode,
          rateLimited: result.rateLimited,
          promiseDetected: result.promiseDetected,
          sleepMs: result.sleepMs,
        });
        // Full raw output → build.log only (via debug, always captured)
        if (result.stderr) {
          this.logger?.debug(`RalphLoop: iter ${iteration} stderr`, { chunkId, stderr: result.stderr });
        }
        if (result.stdout) {
          this.logger?.debug(`RalphLoop: iter ${iteration} stdout`, { chunkId, stdout: result.stdout.slice(0, 4000) });
        }
        // Surface errors on terminal when iteration fails (non-rate-limit)
        if (result.exitCode !== 0 && !result.rateLimited && result.stderr) {
          const excerpt = result.stderr.trim().split('\n').slice(-5).join('\n');
          this.logger?.warn(`RalphLoop: iter ${iteration} failed`, { chunkId, exitCode: result.exitCode, stderr: excerpt });
        }
        // Create iteration span
        const iterSpan = this.observer.startSpan(this.observer.trace, {
          name: `cli:${chunkId}:iter-${iteration}`,
          parentSpanId: chunkSpan.id,
        });

        // Record token usage
        this.observer.recordTokenUsage(
          iterSpan,
          {
            promptTokens: Math.ceil((config.ralph?.prompt?.length ?? 0) / 4),
            completionTokens: result.tokensEstimated,
          },
          this.observer.counter,
        );

        // End iteration span
        this.observer.endSpan(iterSpan, { status: 'completed' }, this.observer.loopDetector);

        // Auto-commit + per-commit checkpoint recording
        const committed = this.git.autoCommit(chunkId, 'impl', iteration);
        if (committed && checkpoint && taskId) {
          const commitHash = this.git.getCurrentHead();
          checkpoint.recordCommit(taskId, 'impl', iteration, commitHash);
        }

        // Budget check — stops before NEXT iteration
        const currentCost = this.computeCurrentCost();
        const budgetResult = this.observer.breaker.check(currentCost);
        if (budgetResult.tripped) {
          throw new BudgetExceededError(currentCost, budgetResult.limitUsd);
        }

        // Forward to original callback if provided
        config.ralph?.onIteration?.(iteration, result);
      },
    };

    // Run RALPH loop
    let ralphResult: RalphLoopResult;
    try {
      ralphResult = await this.ralph.run(wrappedConfig);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        const postTokens = this.observer.counter.grandTotal();
        this.observer.setMetadata(chunkSpan, {
          budgetExceeded: true,
          spent: err.spent,
          limit: err.limit,
        });
        this.observer.endSpan(chunkSpan, { status: 'error', errorMessage: 'budget-exceeded' });
        return {
          output: `Budget exceeded: $${err.spent.toFixed(2)} / $${err.limit.toFixed(2)}`,
          tokensUsed: postTokens.totalTokens - preTokens.totalTokens,
        };
      }
      this.observer.endSpan(chunkSpan, { status: 'error', errorMessage: String(err) });
      throw new Error(
        `RalphLoop failed for chunk "${chunkId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Git merge
    let mergeResult: { merged: boolean; commits: number };
    try {
      mergeResult = this.git.merge(chunkId);
    } catch (err) {
      // Merge failed (conflict) — still return SkillResult with output
      this.observer.setMetadata(chunkSpan, {
        mergeError: String(err),
      });
      this.observer.endSpan(chunkSpan, {
        status: 'error',
        errorMessage: `merge-failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      const postTokens = this.observer.counter.grandTotal();
      return {
        output: ralphResult.output,
        tokensUsed: postTokens.totalTokens - preTokens.totalTokens,
      };
    }

    // Success
    const postTokens = this.observer.counter.grandTotal();
    this.observer.setMetadata(chunkSpan, {
      iterations: ralphResult.iterations,
      completed: ralphResult.completed,
      merged: mergeResult.merged,
      commits: mergeResult.commits,
    });
    this.observer.endSpan(chunkSpan, {
      status: ralphResult.completed ? 'completed' : 'error',
    });

    return {
      output: ralphResult.output,
      tokensUsed: postTokens.totalTokens - preTokens.totalTokens,
    };
  }

  private extractChunkId(skillId: string): string {
    const parts = skillId.split(':').filter(Boolean);
    if (parts.length === 0) return skillId;

    // Handle both canonical skill IDs (`cli:<chunkId>`) and accidental task IDs
    // (`impl:<chunkId>`, `harden:<chunkId>`, `cli:impl:<chunkId>`).
    if (parts[0] === 'cli' && parts.length >= 2) {
      if ((parts[1] === 'impl' || parts[1] === 'harden') && parts.length >= 3) {
        return parts.slice(2).join(':');
      }
      return parts.slice(1).join(':');
    }
    if ((parts[0] === 'impl' || parts[0] === 'harden') && parts.length >= 2) {
      return parts.slice(1).join(':');
    }

    return parts.length >= 2 ? parts.slice(1).join(':') : parts[0]!;
  }

  private computeCurrentCost(): number {
    const entries = this.observer.counter.allModels().map((m) => {
      const t = this.observer.counter.totalsFor(m);
      return { model: m, promptTokens: t.promptTokens, completionTokens: t.completionTokens };
    });
    return this.observer.costCalc.totalCost(entries);
  }
}
