import { describe, it, expect } from 'vitest';
import { CliLlmAdapter, type CliLlmAdapterConfig } from '../../../src/adapters/cli-llm-adapter.js';

describe('CliLlmAdapter', () => {
  function makeAdapter(overrides: Partial<CliLlmAdapterConfig> = {}): CliLlmAdapter {
    return new CliLlmAdapter({
      provider: 'claude',
      workingDir: '/tmp',
      ...overrides,
    });
  }

  describe('transformRequest', () => {
    it('extracts last user message content as prompt', () => {
      const adapter = makeAdapter();
      const request = {
        id: 'req-1',
        provider: 'cli',
        model: 'claude',
        messages: [{ role: 'user' as const, content: 'Hello world' }],
      };

      const result = adapter.transformRequest(request);

      expect(result).toEqual({ prompt: 'Hello world' });
    });

    it('handles multi-message conversations (takes last user message)', () => {
      const adapter = makeAdapter();
      const request = {
        id: 'req-2',
        provider: 'cli',
        model: 'claude',
        messages: [
          { role: 'user' as const, content: 'First question' },
          { role: 'assistant' as const, content: 'First answer' },
          { role: 'user' as const, content: 'Follow-up question' },
        ],
      };

      const result = adapter.transformRequest(request);

      expect(result).toEqual({ prompt: 'Follow-up question' });
    });
  });

  describe('transformResponse', () => {
    it('extracts text content from raw CLI output', () => {
      const adapter = makeAdapter();

      const result = adapter.transformResponse('The answer is 42', 'req-1');

      expect(result).toEqual({ content: 'The answer is 42' });
    });

    it('handles stream-json formatted output (strips JSON framing)', () => {
      const adapter = makeAdapter();
      const streamOutput = [
        '{"type":"message","content":[{"type":"text","text":"Hello from CLI"}]}',
      ].join('\n');

      const result = adapter.transformResponse(streamOutput, 'req-2');

      expect(result).toEqual({ content: 'Hello from CLI' });
    });

    it('returns empty string for empty output', () => {
      const adapter = makeAdapter();

      const result = adapter.transformResponse('', 'req-3');

      expect(result).toEqual({ content: '' });
    });
  });

  describe('validateCapabilities', () => {
    it('returns true for text-completion', () => {
      const adapter = makeAdapter();

      expect(adapter.validateCapabilities('text-completion')).toBe(true);
    });

    it('returns false for other capabilities', () => {
      const adapter = makeAdapter();

      expect(adapter.validateCapabilities('tool-use')).toBe(false);
      expect(adapter.validateCapabilities('streaming')).toBe(false);
      expect(adapter.validateCapabilities('vision')).toBe(false);
    });
  });

  describe('config defaults', () => {
    it('defaults claudeCmd to claude', () => {
      const adapter = makeAdapter();
      expect(adapter.config.claudeCmd).toBe('claude');
    });

    it('defaults codexCmd to codex', () => {
      const adapter = makeAdapter();
      expect(adapter.config.codexCmd).toBe('codex');
    });

    it('defaults timeoutMs to 120_000', () => {
      const adapter = makeAdapter();
      expect(adapter.config.timeoutMs).toBe(120_000);
    });
  });

  describe('execute', () => {
    it('throws Not implemented', async () => {
      const adapter = makeAdapter();

      await expect(adapter.execute({ prompt: 'test' })).rejects.toThrow('Not implemented');
    });
  });
});
