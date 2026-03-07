import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { CliLlmAdapter } from '../../../src/adapters/cli-llm-adapter.js';

// --- Mock spawn infrastructure ---

interface MockSpawnCall {
  cmd: string;
  args: string[];
  options: SpawnOptions;
}

function createMockSpawn(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  neverExit?: boolean;
}): { spawnFn: (cmd: string, args: readonly string[], options: SpawnOptions) => ChildProcess; calls: MockSpawnCall[] } {
  const calls: MockSpawnCall[] = [];

  const spawnFn = (cmd: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    calls.push({ cmd, args: [...args], options });

    const proc = new EventEmitter() as ChildProcess;
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    Object.defineProperty(proc, 'stdout', { value: stdoutStream, writable: false });
    Object.defineProperty(proc, 'stderr', { value: stderrStream, writable: false });
    Object.defineProperty(proc, 'pid', { value: 12345, writable: false });

    const killFn = vi.fn(() => {
      if (!opts.neverExit) {
        setTimeout(() => proc.emit('close', null), 2);
      }
      return true;
    });
    Object.defineProperty(proc, 'kill', { value: killFn, writable: false });

    if (!opts.neverExit) {
      setTimeout(() => {
        if (opts.stdout) stdoutStream.write(opts.stdout);
        stdoutStream.end();
        if (opts.stderr) stderrStream.write(opts.stderr);
        stderrStream.end();
        proc.emit('close', opts.exitCode ?? 0);
      }, opts.delayMs ?? 5);
    }

    return proc;
  };

  return { spawnFn, calls };
}

// --- Tests ---

describe('CliLlmAdapter', () => {
  const baseConfig = { provider: 'claude' as const, workingDir: '/tmp/test' };

  describe('transformRequest', () => {
    it('extracts the last user message content and returns maxTurns: 1', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      const result = adapter.transformRequest({
        id: 'req-1',
        provider: 'adapter',
        model: 'adapter',
        messages: [
          { role: 'user', content: 'first message' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'second message' },
        ],
      });
      expect(result).toEqual({ prompt: 'second message', maxTurns: 1 });
    });

    it('returns empty prompt when no user messages exist', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      const result = adapter.transformRequest({
        id: 'req-2',
        provider: 'adapter',
        model: 'adapter',
        messages: [{ role: 'assistant', content: 'hello' }],
      });
      expect(result).toEqual({ prompt: '', maxTurns: 1 });
    });
  });

  describe('execute', () => {
    it('spawns claude binary when provider is claude', async () => {
      const { spawnFn, calls } = createMockSpawn({ stdout: 'hello', exitCode: 0 });
      const adapter = new CliLlmAdapter(baseConfig, spawnFn);
      await adapter.execute({ prompt: 'test', maxTurns: 1 });
      expect(calls[0]!.cmd).toBe('claude');
    });

    it('spawns codex binary when provider is codex', async () => {
      const { spawnFn, calls } = createMockSpawn({ stdout: 'hello', exitCode: 0 });
      const adapter = new CliLlmAdapter({ ...baseConfig, provider: 'codex' }, spawnFn);
      await adapter.execute({ prompt: 'test', maxTurns: 1 });
      expect(calls[0]!.cmd).toBe('codex');
    });

    it('uses custom command names from config', async () => {
      const { spawnFn, calls } = createMockSpawn({ stdout: 'ok', exitCode: 0 });
      const adapter = new CliLlmAdapter(
        { ...baseConfig, claudeCmd: '/usr/local/bin/claude-custom' },
        spawnFn,
      );
      await adapter.execute({ prompt: 'test', maxTurns: 1 });
      expect(calls[0]!.cmd).toBe('/usr/local/bin/claude-custom');
    });

    it('builds correct args for claude provider', async () => {
      const { spawnFn, calls } = createMockSpawn({ stdout: 'ok', exitCode: 0 });
      const adapter = new CliLlmAdapter(baseConfig, spawnFn);
      await adapter.execute({ prompt: 'do something', maxTurns: 1 });

      const args = calls[0]!.args;
      expect(args).toContain('--print');
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--output-format');
      expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
      expect(args).toContain('--verbose');
      expect(args).toContain('do something');
      expect(args).toContain('--max-turns');
      expect(args[args.indexOf('--max-turns') + 1]).toBe('1');
      expect(args).toContain('--plugin-dir');
      expect(args[args.indexOf('--plugin-dir') + 1]).toBe('/dev/null');
      expect(args).toContain('--no-session-persistence');
    });

    it('clears ALL CLAUDE* environment variables from child env', async () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        CLAUDE_CODE_ENTRYPOINT: 'claude-vscode',
        CLAUDE_SESSION_ID: 'abc123',
        CLAUDECODE_PLUGIN: 'some-plugin',
        PATH: '/usr/bin',
        HOME: '/home/test',
      };

      try {
        const { spawnFn, calls } = createMockSpawn({ stdout: 'ok', exitCode: 0 });
        const adapter = new CliLlmAdapter(baseConfig, spawnFn);
        await adapter.execute({ prompt: 'test', maxTurns: 1 });

        const env = calls[0]!.options.env as Record<string, string>;
        expect(env['CLAUDE_CODE_ENTRYPOINT']).toBeUndefined();
        expect(env['CLAUDE_SESSION_ID']).toBeUndefined();
        expect(env['CLAUDECODE_PLUGIN']).toBeUndefined();
        expect(env['PATH']).toBe('/usr/bin');
        expect(env['HOME']).toBe('/home/test');
      } finally {
        process.env = originalEnv;
      }
    });

    it('resolves with stdout string on exit code 0', async () => {
      const { spawnFn } = createMockSpawn({ stdout: 'response text', exitCode: 0 });
      const adapter = new CliLlmAdapter(baseConfig, spawnFn);
      const result = await adapter.execute({ prompt: 'test', maxTurns: 1 });
      expect(result).toBe('response text');
    });

    it('rejects on non-zero exit code with stderr in error message', async () => {
      const { spawnFn } = createMockSpawn({
        stdout: '',
        stderr: 'something went wrong',
        exitCode: 1,
      });
      const adapter = new CliLlmAdapter(baseConfig, spawnFn);

      await expect(adapter.execute({ prompt: 'test', maxTurns: 1 }))
        .rejects.toThrow('something went wrong');
    });

    it('kills child process on timeout and rejects', async () => {
      const { spawnFn } = createMockSpawn({
        neverExit: true,
      });
      const adapter = new CliLlmAdapter(
        { ...baseConfig, timeoutMs: 50 },
        spawnFn,
      );

      await expect(adapter.execute({ prompt: 'test', maxTurns: 1 }))
        .rejects.toThrow(/timeout/i);
    });

    it('sets cwd to config.workingDir', async () => {
      const { spawnFn, calls } = createMockSpawn({ stdout: 'ok', exitCode: 0 });
      const adapter = new CliLlmAdapter(
        { ...baseConfig, workingDir: '/my/project' },
        spawnFn,
      );
      await adapter.execute({ prompt: 'test', maxTurns: 1 });
      expect(calls[0]!.options.cwd).toBe('/my/project');
    });

    it('uses stdio ignore/pipe/pipe', async () => {
      const { spawnFn, calls } = createMockSpawn({ stdout: 'ok', exitCode: 0 });
      const adapter = new CliLlmAdapter(baseConfig, spawnFn);
      await adapter.execute({ prompt: 'test', maxTurns: 1 });
      expect(calls[0]!.options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    });
  });

  describe('transformResponse', () => {
    it('parses stream-json output and extracts text from deltas', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      const streamJson = [
        '{"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[]}}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}',
        '{"type":"message_stop"}',
      ].join('\n');

      const result = adapter.transformResponse(streamJson, 'req-1');
      expect(result.content).toBe('Hello world');
    });

    it('returns plain text as-is when not JSON', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      const result = adapter.transformResponse('just plain text', 'req-1');
      expect(result).toEqual({ content: 'just plain text' });
    });

    it('returns empty string for empty input', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      const result = adapter.transformResponse('', 'req-1');
      expect(result).toEqual({ content: '' });
    });

    it('handles mixed JSON and non-JSON lines', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      const mixed = [
        'Starting...',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"result"}}',
      ].join('\n');

      const result = adapter.transformResponse(mixed, 'req-1');
      expect(result.content).toContain('result');
    });

    it('handles message-level content array with text blocks', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      // Some providers return full message objects in stream
      const json = '{"type":"message","message":{"content":[{"type":"text","text":"full response"}]}}';
      const result = adapter.transformResponse(json, 'req-1');
      expect(result.content).toContain('full response');
    });
  });

  describe('validateCapabilities', () => {
    it('returns true for text-completion', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      expect(adapter.validateCapabilities('text-completion')).toBe(true);
    });

    it('returns false for unsupported capabilities', () => {
      const adapter = new CliLlmAdapter(baseConfig);
      expect(adapter.validateCapabilities('image-generation')).toBe(false);
      expect(adapter.validateCapabilities('embeddings')).toBe(false);
    });
  });

  describe('integration: full flow', () => {
    it('transforms request, executes with mock spawn, and transforms response', async () => {
      const streamOutput = [
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"The answer is 42"}}',
      ].join('\n');

      const { spawnFn } = createMockSpawn({ stdout: streamOutput, exitCode: 0 });
      const adapter = new CliLlmAdapter(baseConfig, spawnFn);

      const request = {
        id: 'req-1',
        provider: 'adapter',
        model: 'adapter',
        messages: [{ role: 'user' as const, content: 'What is the answer?' }],
      };

      // transformRequest
      const transformed = adapter.transformRequest(request);
      expect(transformed).toEqual({ prompt: 'What is the answer?', maxTurns: 1 });

      // execute
      const rawResponse = await adapter.execute(transformed);
      expect(typeof rawResponse).toBe('string');

      // transformResponse
      const response = adapter.transformResponse(rawResponse, 'req-1');
      expect(response.content).toBe('The answer is 42');
    });
  });
});
