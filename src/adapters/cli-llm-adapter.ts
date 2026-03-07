import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { IAdapter } from './adapter-llm-client.js';

export interface CliLlmAdapterConfig {
  provider: 'claude' | 'codex';
  claudeCmd: string;
  codexCmd: string;
  workingDir: string;
  timeoutMs: number;
}

type CliTransformed = { prompt: string; maxTurns: number };

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

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
  const directKeys = ['text', 'output_text', 'output'];
  for (const key of directKeys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      out.push(value);
    }
  }

  // message and content_block in nestedKeys per MEMORY.md
  const nestedKeys = ['delta', 'content', 'parts', 'data', 'result', 'response', 'message', 'content_block'];
  for (const key of nestedKeys) {
    if (obj[key] !== undefined) {
      tryExtractTextFromNode(obj[key], out);
    }
  }
}

export class CliLlmAdapter implements IAdapter {
  readonly config: Required<CliLlmAdapterConfig>;
  private readonly _spawn: SpawnFn;

  constructor(
    config: Partial<CliLlmAdapterConfig> & Pick<CliLlmAdapterConfig, 'provider' | 'workingDir'>,
    _spawnFn?: SpawnFn,
  ) {
    this.config = {
      provider: config.provider,
      claudeCmd: config.claudeCmd ?? 'claude',
      codexCmd: config.codexCmd ?? 'codex',
      workingDir: config.workingDir,
      timeoutMs: config.timeoutMs ?? 120_000,
    };
    this._spawn = _spawnFn ?? (nodeSpawn as SpawnFn);
  }

  transformRequest(request: unknown): CliTransformed {
    const req = request as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessages = req.messages.filter((m) => m.role === 'user');
    const last = userMessages[userMessages.length - 1];
    return { prompt: last?.content ?? '', maxTurns: 1 };
  }

  async execute(providerRequest: unknown): Promise<string> {
    const { prompt, maxTurns } = providerRequest as CliTransformed;
    const cmd = this.config.provider === 'claude'
      ? this.config.claudeCmd
      : this.config.codexCmd;

    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
      prompt,
      '--max-turns', String(maxTurns),
      '--plugin-dir', '/dev/null',
      '--no-session-persistence',
    ];

    const env = { ...process.env };
    // CRITICAL: Clear ALL CLAUDE* env vars to prevent freeze bug
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE')) {
        delete env[key];
      }
    }

    return new Promise<string>((resolve, reject) => {
      const child = this._spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.config.workingDir,
        env,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      child.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5_000);
        killTimer.unref();
        settle(() => reject(new Error(`CLI timeout after ${this.config.timeoutMs}ms`)));
      }, this.config.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          settle(() => reject(new Error(`CLI exited with code ${code}: ${stderr}`)));
        } else {
          settle(() => resolve(stdout));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        settle(() => reject(err));
      });
    });
  }

  transformResponse(providerResponse: unknown, _requestId: string): { content: string | null } {
    const raw = providerResponse as string;
    if (!raw) {
      return { content: '' };
    }

    // Parse stream-json: newline-delimited JSON events
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const extracted: string[] = [];
    let parsedJsonLines = 0;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        parsedJsonLines++;
        tryExtractTextFromNode(parsed, extracted);
      } catch {
        // Not JSON — keep as-is
        extracted.push(line);
      }
    }

    if (parsedJsonLines > 0 && extracted.length === 0) return { content: raw };
    if (extracted.length === 0) return { content: raw };

    return { content: extracted.join('') };
  }

  validateCapabilities(feature: string): boolean {
    return feature === 'text-completion';
  }
}
