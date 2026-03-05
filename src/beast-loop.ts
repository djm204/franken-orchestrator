import type { BeastLoopDeps } from './deps.js';
import type { BeastInput, BeastResult } from './types.js';
import type { OrchestratorConfig } from './config/orchestrator-config.js';
import { defaultConfig } from './config/orchestrator-config.js';
import { createContext } from './context/context-factory.js';
import { runIngestion, InjectionDetectedError } from './phases/ingestion.js';
import { runHydration } from './phases/hydration.js';
import { runPlanning, CritiqueSpiralError } from './phases/planning.js';
import { runExecution } from './phases/execution.js';
import { runClosure } from './phases/closure.js';

/**
 * The Beast Loop — main orchestrator that wires all 8 modules.
 *
 * Phases:
 * 1. Ingestion — sanitize input via Firewall + hydrate from Memory
 * 2. Planning — create + critique plan via Planner/Critique
 * 3. Execution — run tasks via Skills/Governor
 * 4. Closure — finalize traces, heartbeat pulse
 */
export class BeastLoop {
  private readonly deps: BeastLoopDeps;
  private readonly config: OrchestratorConfig;

  constructor(deps: BeastLoopDeps, config?: Partial<OrchestratorConfig>) {
    this.deps = deps;
    this.config = { ...defaultConfig(), ...config };
  }

  async run(input: BeastInput): Promise<BeastResult> {
    const ctx = createContext(input);

    try {
      // Phase 1: Ingestion + Hydration
      if (this.config.enableTracing) {
        this.deps.observer.startTrace(ctx.sessionId);
      }
      await runIngestion(ctx, this.deps.firewall);
      await runHydration(ctx, this.deps.memory);

      // Phase 2: Planning + Critique
      await runPlanning(ctx, this.deps.planner, this.deps.critique, this.config);

      // Phase 3: Execution
      const outcomes = await runExecution(
        ctx,
        this.deps.skills,
        this.deps.governor,
        this.deps.memory,
        this.deps.observer,
        this.deps.mcp,
      );

      // Phase 4: Closure
      return await runClosure(
        ctx,
        this.deps.observer,
        this.deps.heartbeat,
        this.config,
        outcomes,
      );
    } catch (error) {
      if (error instanceof InjectionDetectedError) {
        return {
          sessionId: ctx.sessionId,
          projectId: ctx.projectId,
          phase: ctx.phase,
          status: 'aborted',
          tokenSpend: ctx.tokenSpend,
          abortReason: error.message,
          error,
          durationMs: ctx.elapsedMs(),
        };
      }

      if (error instanceof CritiqueSpiralError) {
        return {
          sessionId: ctx.sessionId,
          projectId: ctx.projectId,
          phase: ctx.phase,
          status: 'aborted',
          tokenSpend: ctx.tokenSpend,
          abortReason: error.message,
          error,
          durationMs: ctx.elapsedMs(),
        };
      }

      return {
        sessionId: ctx.sessionId,
        projectId: ctx.projectId,
        phase: ctx.phase,
        status: 'failed',
        tokenSpend: ctx.tokenSpend,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: ctx.elapsedMs(),
      };
    }
  }
}
