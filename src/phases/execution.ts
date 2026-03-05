import type { BeastContext } from '../context/franken-context.js';
import type {
  ISkillsModule,
  IGovernorModule,
  IMemoryModule,
  IObserverModule,
  PlanTask,
  SkillInput,
  IMcpModule,
} from '../deps.js';
import type { TaskOutcome } from '../types.js';

export class HitlRejectedError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly reason: string,
  ) {
    super(`Task ${taskId} rejected by governor: ${reason}`);
    this.name = 'HitlRejectedError';
  }
}

/**
 * Beast Loop Phase 3: Validated Execution
 * Executes tasks from the plan in topological order.
 * For each task: check HITL → governor approval → execute → record trace → emit span.
 */
export async function runExecution(
  ctx: BeastContext,
  skills: ISkillsModule,
  governor: IGovernorModule,
  memory: IMemoryModule,
  observer: IObserverModule,
  mcp?: IMcpModule,
): Promise<readonly TaskOutcome[]> {
  ctx.phase = 'execution';
  ctx.addAudit('orchestrator', 'phase:start', { phase: 'execution' });

  if (!ctx.plan) {
    throw new Error('Cannot execute without a plan — planning phase incomplete');
  }

  const outcomes: TaskOutcome[] = [];
  const completed = new Set<string>();
  const completedOutputs = new Map<string, unknown>();

  // Simple topological execution: iterate tasks, skip those with unmet deps
  const pending = [...ctx.plan.tasks];
  let iterations = 0;
  const maxIterations = pending.length * 2; // safety guard

  while (pending.length > 0 && iterations < maxIterations) {
    iterations++;
    const readyIndex = pending.findIndex(t =>
      t.dependsOn.every(dep => completed.has(dep)),
    );

    if (readyIndex === -1) {
      // All remaining tasks have unmet dependencies — deadlock
      for (const task of pending) {
        outcomes.push({
          taskId: task.id,
          status: 'skipped',
          error: 'Unmet dependencies',
        });
      }
      break;
    }

    const task = pending.splice(readyIndex, 1)[0]!;
    const outcome = await executeTask(
      task,
      skills,
      governor,
      memory,
      observer,
      ctx,
      completedOutputs,
      mcp,
    );
    outcomes.push(outcome);

    if (outcome.status === 'success') {
      completed.add(task.id);
      completedOutputs.set(task.id, outcome.output);
    }
  }

  ctx.addAudit('orchestrator', 'execution:done', {
    total: outcomes.length,
    succeeded: outcomes.filter(o => o.status === 'success').length,
    failed: outcomes.filter(o => o.status === 'failure').length,
    skipped: outcomes.filter(o => o.status === 'skipped').length,
  });

  return outcomes;
}

async function executeTask(
  task: PlanTask,
  skills: ISkillsModule,
  governor: IGovernorModule,
  memory: IMemoryModule,
  observer: IObserverModule,
  ctx: BeastContext,
  completedOutputs: ReadonlyMap<string, unknown>,
  _mcp?: IMcpModule,
): Promise<TaskOutcome> {
  const span = observer.startSpan(`task:${task.id}`);

  try {
    // Check HITL requirement
    const requiresHitl = task.requiredSkills.some(s => {
      const available = skills.getAvailableSkills();
      const skill = available.find(sk => sk.id === s);
      return skill?.requiresHitl ?? false;
    });

    if (requiresHitl) {
      const approval = await governor.requestApproval({
        taskId: task.id,
        summary: task.objective,
        requiresHitl: true,
      });

      if (approval.decision === 'rejected' || approval.decision === 'abort') {
        ctx.addAudit('governor', 'task:rejected', { taskId: task.id, reason: approval.reason });
        return { taskId: task.id, status: 'skipped', error: approval.reason ?? 'Rejected' };
      }
    }

    // Execute (placeholder — real execution calls skill registry)
    ctx.addAudit('executor', 'task:start', { taskId: task.id, objective: task.objective });

    const dependencyOutputs = new Map<string, unknown>();
    for (const dep of task.dependsOn) {
      if (completedOutputs.has(dep)) {
        dependencyOutputs.set(dep, completedOutputs.get(dep));
      }
    }

    const memoryContext = ctx.sanitizedIntent?.context ?? {
      adrs: [],
      knownErrors: [],
      rules: [],
    };

    const baseInput: SkillInput = {
      objective: task.objective,
      context: memoryContext,
      dependencyOutputs,
      sessionId: ctx.sessionId,
      projectId: ctx.projectId,
    };

    if (task.requiredSkills.length === 0) {
      const passthroughOutput =
        dependencyOutputs.size === 1
          ? dependencyOutputs.values().next().value
          : dependencyOutputs;

      await memory.recordTrace({
        taskId: task.id,
        summary: task.objective,
        outcome: 'success',
        timestamp: new Date().toISOString(),
      });

      ctx.addAudit('executor', 'task:complete', {
        taskId: task.id,
        tokensUsed: 0,
        output: passthroughOutput,
      });

      return { taskId: task.id, status: 'success', output: passthroughOutput };
    }

    for (const skillId of task.requiredSkills) {
      if (!skills.hasSkill(skillId)) {
        throw new Error(`Missing required skill: ${skillId}`);
      }
    }

    let output: unknown;
    let tokensUsed = 0;

    for (const skillId of task.requiredSkills) {
      const result = await skills.execute(skillId, baseInput);
      output = result.output;
      tokensUsed += result.tokensUsed ?? 0;
    }

    // Record trace
    await memory.recordTrace({
      taskId: task.id,
      summary: task.objective,
      outcome: 'success',
      timestamp: new Date().toISOString(),
    });

    ctx.addAudit('executor', 'task:complete', { taskId: task.id, tokensUsed, output });
    return { taskId: task.id, status: 'success', output };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    ctx.addAudit('executor', 'task:failed', { taskId: task.id, error: errorMsg });
    await memory.recordTrace({
      taskId: task.id,
      summary: task.objective,
      outcome: 'failure',
      timestamp: new Date().toISOString(),
    });
    return { taskId: task.id, status: 'failure', error: errorMsg };
  } finally {
    span.end({ taskId: task.id });
  }
}
