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

  it('threads dependency outputs into downstream skill input', async () => {
    const execute = vi.fn(async (skillId: string) => ({
      output: `${skillId}-output`,
      tokensUsed: 2,
    }));
    const skills = makeSkills({
      hasSkill: vi.fn(() => true),
      execute,
    });
    const c = ctx([
      { id: 't1', objective: 'first', requiredSkills: ['alpha'], dependsOn: [] },
      { id: 't2', objective: 'second', requiredSkills: ['beta'], dependsOn: ['t1'] },
    ]);

    await runExecution(c, skills, makeGovernor(), makeMemory(), makeObserver());

    const secondCall = execute.mock.calls[1]!;
    const secondInput = secondCall[1];
    expect(secondInput.dependencyOutputs.get('t1')).toBe('alpha-output');
  });

  it('passes through dependency output when no skills are required', async () => {
    const execute = vi.fn(async (skillId: string) => ({
      output: `${skillId}-output`,
      tokensUsed: 1,
    }));
    const skills = makeSkills({
      hasSkill: vi.fn(() => true),
      execute,
    });
    const c = ctx([
      { id: 't1', objective: 'first', requiredSkills: ['alpha'], dependsOn: [] },
      { id: 't2', objective: 'second', requiredSkills: [], dependsOn: ['t1'] },
    ]);

    const outcomes = await runExecution(c, skills, makeGovernor(), makeMemory(), makeObserver());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcomes[1]!.output).toBe('alpha-output');
  });

  it('fails when a required skill is missing and records failure trace', async () => {
    const memory = makeMemory();
    const skills = makeSkills({
      hasSkill: vi.fn(() => false),
    });
    const c = ctx([
      { id: 't1', objective: 'missing', requiredSkills: ['ghost'], dependsOn: [] },
    ]);

    const outcomes = await runExecution(c, skills, makeGovernor(), memory, makeObserver());

    expect(outcomes[0]!.status).toBe('failure');
    expect(outcomes[0]!.error).toContain('ghost');
    expect(memory.recordTrace).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', outcome: 'failure' }),
    );
  });

  it('aggregates tokensUsed across multiple skills for audit', async () => {
    const skills = makeSkills({
      hasSkill: vi.fn(() => true),
      execute: vi
        .fn()
        .mockResolvedValueOnce({ output: 'first', tokensUsed: 3 })
        .mockResolvedValueOnce({ output: 'second', tokensUsed: 5 }),
    });
    const c = ctx([
      { id: 't1', objective: 'multi', requiredSkills: ['a', 'b'], dependsOn: [] },
    ]);

    await runExecution(c, skills, makeGovernor(), makeMemory(), makeObserver());

    const complete = c.audit.find(a => a.action === 'task:complete');
    expect(complete).toBeDefined();
    expect((complete!.detail as { tokensUsed: number }).tokensUsed).toBe(8);
  });

  it('returns the last skill output when multiple skills run sequentially', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ output: 'alpha-result', tokensUsed: 1 })
      .mockResolvedValueOnce({ output: 'beta-result', tokensUsed: 1 });
    const skills = makeSkills({
      hasSkill: vi.fn(() => true),
      execute,
    });
    const c = ctx([
      { id: 't1', objective: 'multi', requiredSkills: ['alpha', 'beta'], dependsOn: [] },
    ]);

    const outcomes = await runExecution(c, skills, makeGovernor(), makeMemory(), makeObserver());

    expect(execute.mock.calls.map(call => call[0])).toEqual(['alpha', 'beta']);
    expect(outcomes[0]!.output).toBe('beta-result');
  });

  it('uses empty memory context when sanitizedIntent is undefined', async () => {
    const execute = vi.fn(async () => ({ output: 'ok', tokensUsed: 0 }));
    const skills = makeSkills({
      hasSkill: vi.fn(() => true),
      execute,
    });
    const c = ctx([
      { id: 't1', objective: 'no context', requiredSkills: ['alpha'], dependsOn: [] },
    ]);

    await runExecution(c, skills, makeGovernor(), makeMemory(), makeObserver());

    const input = execute.mock.calls[0]![1];
    expect(input.context).toEqual({ adrs: [], knownErrors: [], rules: [] });
  });
});
