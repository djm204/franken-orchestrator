import type { IAdapter } from './adapter-llm-client.js';

export interface CliLlmAdapterConfig {
  provider: 'claude' | 'codex';
  claudeCmd: string;
  codexCmd: string;
  workingDir: string;
  timeoutMs: number;
}

type CliTransformed = { prompt: string };

export class CliLlmAdapter implements IAdapter {
  readonly config: Required<CliLlmAdapterConfig>;

  constructor(config: Partial<CliLlmAdapterConfig> & Pick<CliLlmAdapterConfig, 'provider' | 'workingDir'>) {
    this.config = {
      provider: config.provider,
      claudeCmd: config.claudeCmd ?? 'claude',
      codexCmd: config.codexCmd ?? 'codex',
      workingDir: config.workingDir,
      timeoutMs: config.timeoutMs ?? 120_000,
    };
  }

  transformRequest(request: unknown): CliTransformed {
    const req = request as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessages = req.messages.filter((m) => m.role === 'user');
    const last = userMessages[userMessages.length - 1];
    return { prompt: last?.content ?? '' };
  }

  async execute(_providerRequest: unknown): Promise<unknown> {
    throw new Error('Not implemented');
  }

  transformResponse(providerResponse: unknown, _requestId: string): { content: string | null } {
    const raw = providerResponse as string;
    if (!raw) {
      return { content: '' };
    }

    // Try to parse stream-json format
    try {
      const parsed = JSON.parse(raw) as {
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
      if (parsed.type === 'message' && Array.isArray(parsed.content)) {
        const textBlock = parsed.content.find((b) => b.type === 'text');
        if (textBlock?.text !== undefined) {
          return { content: textBlock.text };
        }
      }
    } catch {
      // Not JSON — treat as plain text
    }

    return { content: raw };
  }

  validateCapabilities(feature: string): boolean {
    return feature === 'text-completion';
  }
}
