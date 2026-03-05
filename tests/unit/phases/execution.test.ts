import { describe, it, expect, vi } from 'vitest';
import { runExecution } from '../../../src/phases/execution.js';
import { BeastContext } from '../../../src/context/franken-context.js';
import { makeSkills, makeGovernor, makeMemory, makeObserver } from '../../helpers/stubs.js';

function ctx(tasks = [{ id: 't1', objective: 'do it', requiredSkills: [] as string[], dependsOn: [] as string[] }]): BeastContext {
  const c = new BeastContext('proj', 'sess', 'input');
  c.plan = { tasks };
  return c;
}

describe('runExecution', () => {
  it('executes a single task successfully', async () => {
    const c = ctx();
    const outcomes = await runExecution(c, makeSkills(), makeGovernor(), makeMemory(), makeObserver());

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.taskId).toBe('t1');
    expect(outcomes[0]!.status).toBe('success');
  });

  it('executes tasks in topological order', async () => {
    const c = ctx([
      { id: 't1', objective: 'first', requiredSkills: [], dependsOn: [] },
      { id: 't2', objective: 'second', requiredSkills: [], dependsOn: ['t1'] },
    ]);
    const memory = makeMemory();
    const outcomes = await runExecution(c, makeSkills(), makeGovernor(), memory, makeObserver());

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.taskId).toBe('t1');
    expect(outcomes[1]!.taskId).toBe('t2');
  });

  it('records trace for each completed task', async () => {
    const memory = makeMemory();
    const c = ctx();
    await runExecution(c, makeSkills(), makeGovernor(), memory, makeObserver());

    expect(memory.recordTrace).toHaveBeenCalledTimes(1);
    expect(memory.recordTrace).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', outcome: 'success' }),
    );
  });

  it('emits spans for each task', async () => {
    const observer = makeObserver();
    const c = ctx();
    await runExecution(c, makeSkills(), makeGovernor(), makeMemory(), observer);

    expect(observer.startSpan).toHaveBeenCalledWith('task:t1');
  });

  it('skips tasks with unmet dependencies', async () => {
    const c = ctx([
      { id: 't1', objective: 'orphan', requiredSkills: [], dependsOn: ['nonexistent'] },
    ]);
    const outcomes = await runExecution(c, makeSkills(), makeGovernor(), makeMemory(), makeObserver());

    expect(outcomes[0]!.status).toBe('skipped');
    expect(outcomes[0]!.error).toContain('dependencies');
  });

  it('checks HITL requirement and requests governor approval', async () => {
    const skills = makeSkills({
      getAvailableSkills: vi.fn(() => [
        { id: 'deploy', name: 'Deploy', requiresHitl: true },
      ]),
    });
    const governor = makeGovernor();
    const c = ctx([
      { id: 't1', objective: 'deploy app', requiredSkills: ['deploy'], dependsOn: [] },
    ]);

    await runExecution(c, skills, governor, makeMemory(), makeObserver());
    expect(governor.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', requiresHitl: true }),
    );
  });

  it('skips task when governor rejects', async () => {
    const skills = makeSkills({
      getAvailableSkills: vi.fn(() => [
        { id: 'deploy', name: 'Deploy', requiresHitl: true },
      ]),
    });
    const governor = makeGovernor({
      requestApproval: vi.fn(async () => ({
        decision: 'rejected' as const,
        reason: 'too risky',
      })),
    });
    const c = ctx([
      { id: 't1', objective: 'deploy', requiredSkills: ['deploy'], dependsOn: [] },
    ]);

    const outcomes = await runExecution(c, skills, governor, makeMemory(), makeObserver());
    expect(outcomes[0]!.status).toBe('skipped');
  });

  it('throws if plan is missing', async () => {
    const c = new BeastContext('proj', 'sess', 'input');
    await expect(
      runExecution(c, makeSkills(), makeGovernor(), makeMemory(), makeObserver()),
    ).rejects.toThrow('Cannot execute without a plan');
  });

  it('adds execution summary audit', async () => {
    const c = ctx();
    await runExecution(c, makeSkills(), makeGovernor(), makeMemory(), makeObserver());

    const done = c.audit.find(a => a.action === 'execution:done');
    expect(done).toBeDefined();
    expect((done!.detail as { succeeded: number }).succeeded).toBe(1);
  });
});
