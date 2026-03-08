import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { IAdapter } from './adapter-llm-client.js';
import type { ICliProvider } from '../skills/providers/cli-provider.js';

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

export interface CliLlmAdapterOpts {
  workingDir: string;
  timeoutMs?: number;
  commandOverride?: string;
}

export class CliLlmAdapter implements IAdapter {
  private readonly provider: ICliProvider;
  private readonly opts: { workingDir: string; timeoutMs: number; commandOverride?: string };
  private readonly _spawn: SpawnFn;

  constructor(
    provider: ICliProvider,
    opts: CliLlmAdapterOpts,
    _spawnFn?: SpawnFn,
  ) {
    this.provider = provider;
    this.opts = {
      workingDir: opts.workingDir,
      timeoutMs: opts.timeoutMs ?? 120_000,
      ...(opts.commandOverride !== undefined ? { commandOverride: opts.commandOverride } : {}),
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
    const cmd = this.opts.commandOverride ?? this.provider.command;

    const args = this.provider.buildArgs({ maxTurns });
    args.push(prompt);

    const rawEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) rawEnv[key] = value;
    }
    const env = this.provider.filterEnv(rawEnv);

    return new Promise<string>((resolve, reject) => {
      const child = this._spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.opts.workingDir,
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
        settle(() => reject(new Error(`CLI timeout after ${this.opts.timeoutMs}ms`)));
      }, this.opts.timeoutMs);

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

    if (this.provider.supportsStreamJson()) {
      return this.parseStreamJson(raw);
    }

    // Non-stream-json: delegate to provider
    const normalized = this.provider.normalizeOutput(raw);
    return { content: normalized || raw };
  }

  validateCapabilities(feature: string): boolean {
    return feature === 'text-completion';
  }

  private parseStreamJson(raw: string): { content: string | null } {
    // Strip hook output blocks (multi-line formatted JSON containing hookSpecificOutput)
    const cleaned = raw.replace(/\{[\s\S]*?"hookSpecificOutput"[\s\S]*?\n\}/g, '');
    if (cleaned.trim().length === 0) return { content: '' };
    const lines = cleaned.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
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
}
