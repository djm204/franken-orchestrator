import { spawn } from 'node:child_process';
import type { RalphLoopConfig, RalphLoopResult, IterationResult } from './cli-types.js';

const RATE_LIMIT_PATTERNS =
  /rate.?limit|429|too many requests|retry.?after|overloaded|capacity|temporarily unavailable|out of extra usage|usage limit|resets?\s+\d|resets?\s+in\s+\d+\s*s/i;

function isRateLimited(stderr: string): boolean {
  // Only check stderr for rate-limit signals. Checking stdout causes false
  // positives when the model's output contains rate-limit-related text (e.g.
  // implementing rate limiting features).
  return RATE_LIMIT_PATTERNS.test(stderr);
}

export function parseResetTime(stderr: string, stdout: string): { sleepSeconds: number; source: string } {
  const combined = `${stderr}\n${stdout}`;

  // Anthropic "retry-after: 30" header
  const retryAfterHeaderMatch = combined.match(/retry.?after:?\s*(\d+)\s*s?/i);
  if (retryAfterHeaderMatch?.[1]) {
    return { sleepSeconds: parseInt(retryAfterHeaderMatch[1], 10), source: 'retry-after header' };
  }

  // "Please retry after 25s"
  const retryAfterPatternMatch = combined.match(/retry.?after\s+(\d+)\s*s?/i);
  if (retryAfterPatternMatch?.[1]) {
    return { sleepSeconds: parseInt(retryAfterPatternMatch[1], 10), source: 'retry-after header' };
  }

  // "try again in 5 minutes" / "try again in 30 seconds"
  const minutesMatch = combined.match(/try again in (\d+) minute/i);
  if (minutesMatch?.[1]) return { sleepSeconds: parseInt(minutesMatch[1], 10) * 60, source: 'minutes pattern' };
  const secondsMatch = combined.match(/try again in (\d+) second/i);
  if (secondsMatch?.[1]) return { sleepSeconds: parseInt(secondsMatch[1], 10), source: 'seconds pattern' };

  // "rate limit resets at 2026-03-05T20:15:00Z" or epoch timestamp
  const isoMatch = combined.match(/resets?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i);
  if (isoMatch?.[1]) {
    const resetAt = new Date(isoMatch[1]).getTime();
    const now = Date.now();
    if (resetAt > now) return { sleepSeconds: Math.ceil((resetAt - now) / 1000), source: 'reset-at timestamp' };
  }

  // "x-ratelimit-reset: <epoch>" header
  const epochMatch = combined.match(/x-ratelimit-reset:\s*(\d{10,13})/i);
  if (epochMatch?.[1]) {
    const epoch = parseInt(epochMatch[1], 10);
    const resetMs = epoch > 1e12 ? epoch : epoch * 1000;
    const now = Date.now();
    if (resetMs > now) return { sleepSeconds: Math.ceil((resetMs - now) / 1000), source: 'x-ratelimit-reset epoch' };
  }

  // OpenAI / Codex "resets in Ns"
  const resetsInMatch = combined.match(/resets?\s+in\s+(\d+)\s*s/i);
  if (resetsInMatch?.[1]) return { sleepSeconds: parseInt(resetsInMatch[1], 10), source: 'resets-in pattern' };

  // No parseable reset time
  return { sleepSeconds: -1, source: 'unknown' };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(): Error {
  const error = new Error('RalphLoop sleep aborted');
  error.name = 'AbortError';
  return error;
}

function sleepWithAbort(
  ms: number,
  sleepFn: (durationMs: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return sleepFn(ms);
  if (signal.aborted) return Promise.reject(abortError());

  if (sleepFn === defaultSleep) {
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(abortError());
      };

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    sleepFn(ms)
      .then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      })
      .catch((error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
  });
}

function buildClaudeArgs(prompt: string, maxTurns: number): string[] {
  return [
    '--print', '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    '--disable-slash-commands',
    prompt,
    '--max-turns', String(maxTurns),
  ];
}

function buildCodexArgs(prompt: string): string[] {
  return ['exec', '--full-auto', '--json', '--color', 'never', prompt];
}

function tryExtractTextFromNode(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    if (node.trim().length > 0) out.push(node);
    return;
  }
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) tryExtractTextFromNode(item, out);
    return;
  }

  const obj = node as Record<string, unknown>;
  const directKeys = ['text', 'output_text', 'delta', 'output', 'message'];
  for (const key of directKeys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      out.push(value);
    }
  }

  const nestedKeys = ['content', 'parts', 'data', 'result', 'response'];
  for (const key of nestedKeys) {
    if (obj[key] !== undefined) {
      tryExtractTextFromNode(obj[key], out);
    }
  }
}

export function normalizeCodexOutput(stdout: string): string {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const extracted: string[] = [];
  let parsedJsonLines = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      parsedJsonLines++;
      tryExtractTextFromNode(parsed, extracted);
    } catch {
      // Keep non-JSON lines verbatim.
      extracted.push(line);
    }
  }

  // If nothing useful was extracted from JSON, preserve original output.
  if (parsedJsonLines > 0 && extracted.length === 0) return stdout;
  return extracted.join('\n').trim();
}

function spawnIteration(
  config: RalphLoopConfig,
  provider: 'claude' | 'codex',
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
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
    let settled = false;
    let timedOut = false;

    const finish = (result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let lineBuffer = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      // Stream output to terminal so the user can see Claude working
      if (provider === 'claude') {
        lineBuffer += text;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? ''; // keep incomplete last line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            const parts: string[] = [];
            tryExtractTextFromNode(obj, parts);
            if (parts.length > 0) process.stdout.write(parts.join(''));
          } catch {
            // Not JSON — show as-is (error messages, startup banners, etc.)
            process.stdout.write(trimmed + '\n');
          }
        }
      } else {
        process.stdout.write(text);
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // stderr is captured for build.log via onIteration callback — not piped
      // to terminal (too noisy with --verbose). Errors surface via logger.
    });

    // Timeout: SIGTERM first, then SIGKILL after 5s
    const timer = setTimeout(() => {
      timedOut = true;
      config.onProviderTimeout?.(provider, config.timeoutMs);
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5_000);
      // Hard fail-safe: if process still hasn't closed, force resolution.
      setTimeout(() => {
        finish({
          stdout,
          stderr: `${stderr}\n[RalphLoop] iteration timed out after ${config.timeoutMs}ms`,
          exitCode: 124,
          timedOut: true,
        });
      }, 7_000);
    }, config.timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class RalphLoop {
  async run(config: RalphLoopConfig): Promise<RalphLoopResult> {
    const configuredProviders = config.providers?.filter((provider): provider is 'claude' | 'codex' =>
      provider === 'claude' || provider === 'codex');
    const providers: readonly ('claude' | 'codex')[] =
      configuredProviders && configuredProviders.length > 0
        ? configuredProviders
        : ['claude', 'codex'];
    const sleepFn = config._sleepFn ?? defaultSleep;
    const initialProvider = config.provider;

    let iteration = 0;
    let lastOutput = '';
    let totalTokens = 0;
    let activeProvider: 'claude' | 'codex' = config.provider;
    let pendingSleepMs = 0;
    const promiseRegex = new RegExp(`<promise>${escapeRegex(config.promiseTag)}</promise>`);

    // Provider exhaustion tracking
    const exhaustedProviders = new Map<string, { stderr: string; stdout: string }>();

    while (iteration < config.maxIterations) {
      iteration++;
      const startTime = Date.now();
      config.onProviderAttempt?.(activeProvider, iteration);

      let result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean };
      try {
        result = await spawnIteration(config, activeProvider);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        config.onSpawnError?.(activeProvider, msg);
        continue;
      }

      const durationMs = Date.now() - startTime;
      const normalizedStdout = activeProvider === 'codex'
        ? normalizeCodexOutput(result.stdout)
        : result.stdout;
      lastOutput = normalizedStdout;

      const tokenDivisor = activeProvider === 'codex' ? 16 : 4;
      const tokensEstimated = Math.ceil(normalizedStdout.length / tokenDivisor);
      totalTokens += tokensEstimated;

      // Never treat timed-out iterations as rate-limited — the timeout killed the
      // process, any "rate limit" text in stdout is the model's code, not an API error.
      const rateLimited = !result.timedOut && isRateLimited(result.stderr);
      const promiseDetected = promiseRegex.test(normalizedStdout);

      const iterResult: IterationResult = {
        iteration,
        exitCode: result.exitCode,
        stdout: normalizedStdout,
        stderr: result.stderr,
        durationMs,
        rateLimited,
        promiseDetected,
        tokensEstimated,
        sleepMs: pendingSleepMs,
      };

      // Reset pendingSleepMs after reporting it
      pendingSleepMs = 0;

      config.onIteration?.(iteration, iterResult);

      // Rate limit: provider fallback chain
      if (rateLimited) {
        iteration--;

        // Notify via legacy callback (non-controlling)
        config.onRateLimit?.(activeProvider);

        // Track this provider as exhausted
        exhaustedProviders.set(activeProvider, { stderr: result.stderr, stdout: normalizedStdout });

        // Find next non-exhausted provider
        const nextProvider = providers.find(p => !exhaustedProviders.has(p));

        if (nextProvider) {
          // Switch to next provider, retry immediately
          config.onProviderSwitch?.(activeProvider, nextProvider, 'rate-limit');
          activeProvider = nextProvider;
          continue;
        }

        // All providers exhausted — parse reset times and sleep
        let shortestSleep = Infinity;
        let shortestSource = 'unknown';

        for (const [, data] of exhaustedProviders) {
          const parsed = parseResetTime(data.stderr, data.stdout);
          if (parsed.sleepSeconds >= 0 && parsed.sleepSeconds < shortestSleep) {
            shortestSleep = parsed.sleepSeconds;
            shortestSource = parsed.source;
          }
        }

        let sleepMs: number;
        let sleepSource: string;

        if (shortestSleep === Infinity) {
          // No parseable reset time — fallback to 120s
          sleepMs = 120_000;
          sleepSource = 'unknown';
          // Log warning with raw stderr so user can see what the API said
          const rawStderrs = [...exhaustedProviders.entries()]
            .map(([p, d]) => `${p}: ${d.stderr}`)
            .join(' | ');
          console.warn(`[RalphLoop] Rate limit reset time could not be determined. Raw stderr: ${rawStderrs}`);
        } else {
          sleepMs = shortestSleep * 1000;
          sleepSource = shortestSource;
        }

        // Fire onSleep before sleeping
        config.onSleep?.(sleepMs, sleepSource);

        // Sleep until reset (abort-aware so SIGINT can interrupt long waits)
        await sleepWithAbort(sleepMs, sleepFn, config.abortSignal);

        // Track the sleep duration for the next iteration's report
        pendingSleepMs = sleepMs;

        // Clear exhausted state, reset to original provider
        exhaustedProviders.clear();
        if (activeProvider !== initialProvider) {
          config.onProviderSwitch?.(activeProvider, initialProvider, 'post-sleep-reset');
        }
        activeProvider = initialProvider;
        continue;
      }

      // Promise detected — verify meaningful output
      if (promiseDetected) {
        const stripped = normalizedStdout.replace(promiseRegex, '').trim();
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
