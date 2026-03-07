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

type CommitMessageFn = (diffStat: string, objective: string) => Promise<string | null>;

export class CliSkillExecutor {
  private readonly ralph: RalphLoop;
  private readonly git: GitBranchIsolator;
  private readonly observer: ObserverDeps;
  private readonly verifyCommand?: string | undefined;
  private readonly commitMessageFn?: CommitMessageFn | undefined;

  constructor(ralph: RalphLoop, git: GitBranchIsolator, observer: ObserverDeps, verifyCommand?: string, commitMessageFn?: CommitMessageFn) {
    this.ralph = ralph;
    this.git = git;
    this.observer = observer;
    this.verifyCommand = verifyCommand;
    this.commitMessageFn = commitMessageFn;
  }

  async recoverDirtyFiles(
    taskId: string,
    stage: string,
    checkpoint: ICheckpointStore,
    logger?: ILogger,
  ): Promise<'clean' | 'committed' | 'reset'> {
    const status = this.git.getStatus();
    if (status.length === 0) return 'clean';

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
    this.git.autoCommit(taskId, 'recovery', 0);
    const commitHash = this.git.getCurrentHead();
    checkpoint.recordCommit(taskId, stage, -1, commitHash);
    logger?.info('Recovery: auto-committed dirty files', { taskId });
    return 'committed';
  }

  async execute(skillId: string, _input: SkillInput, config: CliSkillConfig, checkpoint?: ICheckpointStore, taskId?: string): Promise<SkillResult> {
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

    // Wire onIteration for observer integration
    const wrappedConfig: RalphLoopConfig = {
      ...config.ralph,
      onIteration: (iteration: number, result: IterationResult) => {
        // Create iteration span
        const iterSpan = this.observer.startSpan(this.observer.trace, {
          name: `cli:${chunkId}:iter-${iteration}`,
          parentSpanId: chunkSpan.id,
        });

        // Record token usage
        this.observer.recordTokenUsage(
          iterSpan,
          {
            promptTokens: Math.ceil(config.ralph.prompt.length / 4),
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
        config.ralph.onIteration?.(iteration, result);
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

    // Generate commit message for squash merge (if available)
    let commitMessage: string | undefined;
    if (this.commitMessageFn) {
      try {
        const diffStat = this.git.getDiffStat(chunkId);
        const msg = await this.commitMessageFn(diffStat, _input.objective);
        if (msg) commitMessage = msg;
      } catch {
        // Silently fall back to no message — never block the pipeline
      }
    }

    // Git merge
    let mergeResult: { merged: boolean; commits: number };
    try {
      mergeResult = commitMessage
        ? this.git.merge(chunkId, commitMessage)
        : this.git.merge(chunkId);
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
    const colonIndex = skillId.indexOf(':');
    return colonIndex >= 0 ? skillId.slice(colonIndex + 1) : skillId;
  }

  private computeCurrentCost(): number {
    const entries = this.observer.counter.allModels().map((m) => {
      const t = this.observer.counter.totalsFor(m);
      return { model: m, promptTokens: t.promptTokens, completionTokens: t.completionTokens };
    });
    return this.observer.costCalc.totalCost(entries);
  }
}
