import { describe, it, expect, vi } from 'vitest';
import { runHydration } from '../../../src/phases/hydration.js';
import { BeastContext } from '../../../src/context/franken-context.js';
import { makeMemory } from '../../helpers/stubs.js';

function ctx(): BeastContext {
  const c = new BeastContext('proj', 'sess', 'input');
  c.sanitizedIntent = { goal: 'build a feature' };
  return c;
}

describe('runHydration', () => {
  it('calls memory.frontload with projectId', async () => {
    const memory = makeMemory();
    const c = ctx();
    await runHydration(c, memory);

    expect(memory.frontload).toHaveBeenCalledWith('proj');
  });

  it('calls memory.getContext with projectId', async () => {
    const memory = makeMemory();
    const c = ctx();
    await runHydration(c, memory);

    expect(memory.getContext).toHaveBeenCalledWith('proj');
  });

  it('enriches sanitizedIntent with memory context', async () => {
    const memory = makeMemory({
      getContext: vi.fn(async () => ({
        adrs: ['ADR-001: Use TypeScript'],
        knownErrors: ['ENOENT for missing config'],
        rules: ['No any types'],
      })),
    });
    const c = ctx();
    await runHydration(c, memory);

    expect(c.sanitizedIntent?.context).toEqual({
      adrs: ['ADR-001: Use TypeScript'],
      knownErrors: ['ENOENT for missing config'],
      rules: ['No any types'],
    });
  });

  it('handles empty memory context', async () => {
    const c = ctx();
    await runHydration(c, makeMemory());

    expect(c.sanitizedIntent?.context).toEqual({
      adrs: [],
      knownErrors: [],
      rules: [],
    });
  });

  it('skips context enrichment if sanitizedIntent is missing', async () => {
    const c = new BeastContext('proj', 'sess', 'input');
    // no sanitizedIntent set
    await runHydration(c, makeMemory());

    expect(c.sanitizedIntent).toBeUndefined();
  });

  it('adds audit entries', async () => {
    const c = ctx();
    await runHydration(c, makeMemory());

    expect(c.audit).toHaveLength(2);
    expect(c.audit[0]!.action).toBe('frontload:start');
    expect(c.audit[1]!.action).toBe('frontload:done');
  });
});
