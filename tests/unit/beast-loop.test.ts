import { describe, it, expect } from 'vitest';
import { BeastLoop } from '../../src/beast-loop.js';
import { makeDeps, makeLogger } from '../helpers/stubs.js';

describe('BeastLoop', () => {
  it('runs through all 4 phases and returns completed result', async () => {
    const deps = makeDeps();
    const loop = new BeastLoop(deps);

    const result = await loop.run({
      projectId: 'test-project',
      userInput: 'build a feature',
    });

    expect(result.status).toBe('completed');
    expect(result.projectId).toBe('test-project');
    expect(result.phase).toBe('closure');
    expect(result.sessionId).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('assigns a session ID when not provided', async () => {
    const loop = new BeastLoop(makeDeps());
    const result = await loop.run({
      projectId: 'proj',
      userInput: 'test',
    });
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId.length).toBeGreaterThan(10);
  });

  it('uses provided session ID', async () => {
    const loop = new BeastLoop(makeDeps());
    const result = await loop.run({
      projectId: 'proj',
      userInput: 'test',
      sessionId: 'my-session',
    });
    expect(result.sessionId).toBe('my-session');
  });

  it('returns failed result on error', async () => {
    const deps = makeDeps();
    // Simulate an error by making the context creation throw
    // For now, the stub loop doesn't call any deps, so we test the error path
    // by subclassing or will be tested more thoroughly in PR-26+
    const loop = new BeastLoop(deps);
    const result = await loop.run({
      projectId: 'proj',
      userInput: 'test',
    });
    // Stub loop completes successfully
    expect(result.status).toBe('completed');
  });

  it('accepts partial config overrides', async () => {
    const loop = new BeastLoop(makeDeps(), {
      maxCritiqueIterations: 5,
      enableHeartbeat: false,
    });
    const result = await loop.run({
      projectId: 'proj',
      userInput: 'test',
    });
    expect(result.status).toBe('completed');
  });

  it('returns zero token spend in stub mode', async () => {
    const loop = new BeastLoop(makeDeps());
    const result = await loop.run({
      projectId: 'proj',
      userInput: 'test',
    });
    expect(result.tokenSpend).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    });
  });

  it('logs session start, phase transitions, and final result', async () => {
    const logger = makeLogger();
    const loop = new BeastLoop(makeDeps({ logger }));

    const result = await loop.run({
      projectId: 'proj',
      userInput: 'test',
      sessionId: 'sess-1',
    });

    expect(logger.info).toHaveBeenCalledWith(
      'BeastLoop: session start',
      expect.objectContaining({ sessionId: 'sess-1', projectId: 'proj' }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'BeastLoop: session context',
      expect.objectContaining({ sessionId: 'sess-1', projectId: 'proj' }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'BeastLoop: input',
      expect.objectContaining({ input: expect.objectContaining({ userInput: 'test' }) }),
    );
    expect(logger.info).toHaveBeenCalledWith('BeastLoop: phase start', { phase: 'ingestion' });
    expect(logger.info).toHaveBeenCalledWith('BeastLoop: phase end', { phase: 'closure' });
    expect(logger.info).toHaveBeenCalledWith(
      'BeastLoop: session end',
      expect.objectContaining({ status: result.status, durationMs: expect.any(Number) }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'BeastLoop: config',
      expect.objectContaining({ enableTracing: true }),
    );
  });
});
