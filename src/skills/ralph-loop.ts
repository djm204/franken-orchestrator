import { spawn } from 'node:child_process';
import type { RalphLoopConfig, RalphLoopResult, IterationResult } from './cli-types.js';

const RATE_LIMIT_PATTERNS =
  /rate.?limit|429|too many requests|retry.?after|overloaded|capacity|temporarily unavailable|out of extra usage|usage limit|resets?\s+\d/i;

function isRateLimited(stderr: string, stdout: string, exitCode: number): boolean {
  if (exitCode !== 0 && RATE_LIMIT_PATTERNS.test(stderr)) return true;
  return RATE_LIMIT_PATTERNS.test(stderr) || RATE_LIMIT_PATTERNS.test(stdout);
}

function buildClaudeArgs(prompt: string, maxTurns: number): string[] {
  return [
    '--print', '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    prompt,
    '--max-turns', String(maxTurns),
  ];
}

function buildCodexArgs(prompt: string): string[] {
  return ['exec', '--full-auto', '--json', '--color', 'never', prompt];
}

function spawnIteration(
  config: RalphLoopConfig,
  provider: 'claude' | 'codex',
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const cmd = provider === 'claude' ? config.claudeCmd : config.codexCmd;
    const args = provider === 'claude'
      ? buildClaudeArgs(config.prompt, config.maxTurns)
      : buildCodexArgs(config.prompt);

    const env = { ...process.env };
    if (provider === 'claude') {
      delete env['CLAUDECODE'];
    }

    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: config.workingDir,
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Timeout: SIGTERM first, then SIGKILL after 5s
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5_000);
    }, config.timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class RalphLoop {
  async run(config: RalphLoopConfig): Promise<RalphLoopResult> {
    let iteration = 0;
    let lastOutput = '';
    let totalTokens = 0;
    let activeProvider: 'claude' | 'codex' = config.provider;
    const promiseRegex = new RegExp(`<promise>${escapeRegex(config.promiseTag)}</promise>`);

    while (iteration < config.maxIterations) {
      iteration++;
      const startTime = Date.now();

      let result: { stdout: string; stderr: string; exitCode: number };
      try {
        result = await spawnIteration(config, activeProvider);
      } catch {
        continue;
      }

      const durationMs = Date.now() - startTime;
      lastOutput = result.stdout;

      const tokenDivisor = activeProvider === 'codex' ? 16 : 4;
      const tokensEstimated = Math.ceil(result.stdout.length / tokenDivisor);
      totalTokens += tokensEstimated;

      const rateLimited = isRateLimited(result.stderr, result.stdout, result.exitCode);
      const promiseDetected = promiseRegex.test(result.stdout);

      const iterResult: IterationResult = {
        iteration,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs,
        rateLimited,
        promiseDetected,
        tokensEstimated,
      };

      config.onIteration?.(iteration, iterResult);

      // Rate limit: don't count iteration, optionally switch provider
      if (rateLimited) {
        iteration--;
        if (config.onRateLimit) {
          const fallback = config.onRateLimit(activeProvider);
          if (fallback === 'claude' || fallback === 'codex') {
            activeProvider = fallback;
          }
        }
        continue;
      }

      // Promise detected — verify meaningful output
      if (promiseDetected) {
        const stripped = result.stdout.replace(promiseRegex, '').trim();
        if (stripped.length === 0) {
          // Promise without meaningful changes — reject
          return { completed: false, iterations: iteration, output: lastOutput, tokensUsed: totalTokens };
        }
        return { completed: true, iterations: iteration, output: lastOutput, tokensUsed: totalTokens };
      }
    }

    return { completed: false, iterations: iteration, output: lastOutput, tokensUsed: totalTokens };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
