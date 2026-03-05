import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { RalphLoopConfig, IterationResult } from '../../../src/skills/cli-types.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

interface MockChildOpts {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  hang?: boolean;
}

/** Create a mock ChildProcess that emits stdout/stderr then closes. */
function mockChild(opts: MockChildOpts): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: null,
    kill: vi.fn(),
    pid: 12345,
  }) as unknown as ChildProcess;

  if (!opts.hang) {
    process.nextTick(() => {
      if (opts.stdout) (child.stdout as EventEmitter).emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) (child.stderr as EventEmitter).emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.exitCode ?? 0);
    });
  }

  return child;
}

/** Queue a lazy mock — child is created when spawn is called, not at setup time. */
function queueMock(opts: MockChildOpts): void {
  mockSpawn.mockImplementationOnce(() => mockChild(opts));
}

function baseConfig(overrides?: Partial<RalphLoopConfig>): RalphLoopConfig {
  return {
    prompt: 'Implement feature X',
    promiseTag: 'IMPL_X_DONE',
    maxIterations: 3,
    maxTurns: 10,
    provider: 'claude',
    claudeCmd: 'claude',
    codexCmd: 'codex',
    timeoutMs: 30_000,
    workingDir: '/tmp/test-project',
    ...overrides,
  };
}

describe('RalphLoop', () => {
  let RalphLoop: typeof import('../../../src/skills/ralph-loop.js').RalphLoop;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../../../src/skills/ralph-loop.js');
    RalphLoop = mod.RalphLoop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Successful promise detection ──

  it('detects promise tag in stdout and returns completed: true', async () => {
    queueMock({ stdout: 'Working on feature...\n<promise>IMPL_X_DONE</promise>\n', exitCode: 0 });

    const loop = new RalphLoop();
    const result = await loop.run(baseConfig());

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.output).toContain('<promise>IMPL_X_DONE</promise>');
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  // ── 2. Max iterations exhaustion ──

  it('returns completed: false when max iterations reached without promise', async () => {
    for (let i = 0; i < 3; i++) {
      queueMock({ stdout: `Iteration ${i} output without promise tag`, exitCode: 0 });
    }

    const loop = new RalphLoop();
    const result = await loop.run(baseConfig({ maxIterations: 3 }));

    expect(result.completed).toBe(false);
    expect(result.iterations).toBe(3);
    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });

  // ── 3. Timeout handling ──

  it('kills child with SIGTERM on timeout, then SIGKILL after 5s', async () => {
    vi.useFakeTimers();

    const hangingChild = mockChild({ hang: true });
    const killFn = hangingChild.kill as ReturnType<typeof vi.fn>;

    // Make SIGKILL trigger close so the promise resolves
    killFn.mockImplementation((signal: string) => {
      if (signal === 'SIGKILL') {
        process.nextTick(() => hangingChild.emit('close', null));
      }
      return true;
    });

    mockSpawn.mockImplementationOnce(() => hangingChild);
    // Second iteration returns promise so the loop finishes
    queueMock({ stdout: 'done\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    const runPromise = loop.run(baseConfig({ maxIterations: 2, timeoutMs: 5_000 }));

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(5_001);
    expect(killFn).toHaveBeenCalledWith('SIGTERM');

    // Advance past SIGKILL grace period
    await vi.advanceTimersByTimeAsync(5_001);
    expect(killFn).toHaveBeenCalledWith('SIGKILL');

    await runPromise;
    vi.useRealTimers();
  });

  // ── 4. Provider switching — claude CLI args ──

  it('spawns correct CLI args for claude provider', async () => {
    queueMock({ stdout: 'ok\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    await loop.run(baseConfig({ provider: 'claude', claudeCmd: '/usr/bin/claude' }));

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/claude',
      [
        '--print', '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
        'Implement feature X',
        '--max-turns', '10',
      ],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: '/tmp/test-project',
      }),
    );
  });

  // ── 5. Provider switching — codex CLI args ──

  it('spawns correct CLI args for codex provider', async () => {
    queueMock({ stdout: 'ok\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    await loop.run(baseConfig({ provider: 'codex', codexCmd: '/usr/bin/codex' }));

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/codex',
      ['exec', '--full-auto', '--json', '--color', 'never', 'Implement feature X'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: '/tmp/test-project',
      }),
    );
  });

  // ── 6. Non-zero exit code — continues to next iteration ──

  it('continues iteration on non-zero exit code', async () => {
    queueMock({ stdout: 'Error output', exitCode: 1 });
    queueMock({ stdout: 'Success!\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    const result = await loop.run(baseConfig({ maxIterations: 5 }));

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(2);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  // ── 7. Promise-without-changes rejection ──

  it('rejects promise when stdout has no meaningful content beyond the tag', async () => {
    queueMock({ stdout: '  <promise>IMPL_X_DONE</promise>  \n', exitCode: 0 });

    const loop = new RalphLoop();
    const result = await loop.run(baseConfig({ maxIterations: 1 }));

    expect(result.completed).toBe(false);
    expect(result.iterations).toBe(1);
  });

  // ── 8. Rate-limited iterations don't count against maxIterations ──

  it('does not count rate-limited iterations against maxIterations', async () => {
    queueMock({ stderr: '429 Too Many Requests', exitCode: 1 });
    queueMock({ stdout: 'Done!\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    const result = await loop.run(baseConfig({ maxIterations: 1 }));

    // maxIterations is 1, but the rate-limited iteration shouldn't count
    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  // ── 9. Provider fallback on rate limit via onRateLimit callback ──

  it('calls onRateLimit and switches provider on rate limit', async () => {
    const onRateLimit = vi.fn().mockReturnValue('codex');

    queueMock({ stderr: 'rate limit exceeded', exitCode: 1 });
    queueMock({ stdout: 'Codex did it!\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    const result = await loop.run(baseConfig({ maxIterations: 2, onRateLimit }));

    expect(onRateLimit).toHaveBeenCalledWith('claude');
    expect(result.completed).toBe(true);

    // Second call should use codex
    const secondCallArgs = mockSpawn.mock.calls[1] as unknown[];
    expect(secondCallArgs[0]).toBe('codex');
  });

  // ── 10. Strips CLAUDECODE env var for claude provider ──

  it('strips CLAUDECODE env var when spawning claude', async () => {
    process.env['CLAUDECODE'] = 'some-value';

    queueMock({ stdout: 'ok\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    await loop.run(baseConfig({ provider: 'claude' }));

    const spawnEnv = (mockSpawn.mock.calls[0] as unknown[])[2] as { env: Record<string, string> };
    expect(spawnEnv.env).not.toHaveProperty('CLAUDECODE');

    delete process.env['CLAUDECODE'];
  });

  // ── 11. Token estimation ──

  it('estimates tokens as stdout.length / 4 for claude and / 16 for codex', async () => {
    const output = 'x'.repeat(160) + '\n<promise>IMPL_X_DONE</promise>';

    queueMock({ stdout: output, exitCode: 0 });
    const loop = new RalphLoop();
    const claudeResult = await loop.run(baseConfig({ provider: 'claude' }));
    expect(claudeResult.tokensUsed).toBe(Math.ceil(output.length / 4));

    queueMock({ stdout: output, exitCode: 0 });
    const codexResult = await loop.run(baseConfig({ provider: 'codex' }));
    expect(codexResult.tokensUsed).toBe(Math.ceil(output.length / 16));
  });

  // ── 12. onIteration callback ──

  it('calls onIteration callback for each iteration', async () => {
    const onIteration = vi.fn();

    queueMock({ stdout: 'first output', exitCode: 0 });
    queueMock({ stdout: 'second\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

    const loop = new RalphLoop();
    await loop.run(baseConfig({ maxIterations: 5, onIteration }));

    expect(onIteration).toHaveBeenCalledTimes(2);

    const firstCall = onIteration.mock.calls[0] as [number, IterationResult];
    expect(firstCall[0]).toBe(1);
    expect(firstCall[1].stdout).toBe('first output');
    expect(firstCall[1].promiseDetected).toBe(false);

    const secondCall = onIteration.mock.calls[1] as [number, IterationResult];
    expect(secondCall[0]).toBe(2);
    expect(secondCall[1].promiseDetected).toBe(true);
  });

  // ── 13. Rate limit pattern detection ──

  it('detects various rate limit patterns', async () => {
    const patterns = [
      '429 Too Many Requests',
      'rate limit exceeded',
      'too many requests',
      'temporarily unavailable',
      'overloaded',
    ];

    for (const pattern of patterns) {
      vi.resetAllMocks();
      queueMock({ stderr: pattern, exitCode: 1 });
      queueMock({ stdout: 'ok\n<promise>IMPL_X_DONE</promise>', exitCode: 0 });

      const loop = new RalphLoop();
      const result = await loop.run(baseConfig({ maxIterations: 1 }));
      expect(result.completed).toBe(true);
    }
  });
});
