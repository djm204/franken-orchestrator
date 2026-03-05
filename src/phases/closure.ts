import type { BeastContext } from '../context/franken-context.js';
import type { IObserverModule, IHeartbeatModule } from '../deps.js';
import type { BeastResult, TaskOutcome } from '../types.js';
import type { OrchestratorConfig } from '../config/orchestrator-config.js';

/**
 * Beast Loop Phase 4: Closure
 * Finalizes traces, computes token spend, runs optional heartbeat pulse,
 * and assembles the final BeastResult.
 */
export async function runClosure(
  ctx: BeastContext,
  observer: IObserverModule,
  heartbeat: IHeartbeatModule,
  config: OrchestratorConfig,
  taskOutcomes: readonly TaskOutcome[],
): Promise<BeastResult> {
  ctx.phase = 'closure';
  ctx.addAudit('orchestrator', 'phase:start', { phase: 'closure' });

  // Collect token spend
  const spend = await observer.getTokenSpend(ctx.sessionId);
  ctx.tokenSpend = spend;
  ctx.addAudit('observer', 'tokenSpend:collected', spend);

  // Optional heartbeat pulse
  if (config.enableHeartbeat) {
    try {
      const pulseResult = await heartbeat.pulse();
      ctx.addAudit('heartbeat', 'pulse:complete', {
        improvements: pulseResult.improvements.length,
        techDebt: pulseResult.techDebt.length,
      });
    } catch (error) {
      // Heartbeat failure is non-fatal
      ctx.addAudit('heartbeat', 'pulse:failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allSucceeded = taskOutcomes.every(o => o.status === 'success');

  return {
    sessionId: ctx.sessionId,
    projectId: ctx.projectId,
    phase: 'closure',
    status: allSucceeded ? 'completed' : 'failed',
    tokenSpend: ctx.tokenSpend,
    taskResults: taskOutcomes,
    planSummary: ctx.plan
      ? `${ctx.plan.tasks.length} task(s) planned`
      : undefined,
    durationMs: ctx.elapsedMs(),
  };
}
