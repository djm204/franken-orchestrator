/**
 * Gemini CLI provider implementation.
 *
 * NEW provider — follows design doc patterns.
 * Uses stream-json output format like Claude.
 */

import type { ICliProvider, ProviderOpts } from './cli-provider.js';

const RATE_LIMIT_PATTERNS =
  /RESOURCE_EXHAUSTED|rate.?limit|429|too many requests|retry.?after|overloaded|capacity|temporarily unavailable|out of extra usage|usage limit|resets?\s+\d|resets?\s+in\s+\d+\s*s/i;

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

  const nestedKeys = ['delta', 'content', 'parts', 'data', 'result', 'response', 'message', 'content_block'];
  for (const key of nestedKeys) {
    if (obj[key] !== undefined) {
      tryExtractTextFromNode(obj[key], out);
    }
  }
}

export class GeminiProvider implements ICliProvider {
  readonly name = 'gemini';
  readonly command = 'gemini';

  buildArgs(opts: ProviderOpts): string[] {
    const args: string[] = ['-p', '--yolo', '--output-format', 'stream-json'];
    if (opts.extraArgs) {
      args.push(...opts.extraArgs);
    }
    return args;
  }

  normalizeOutput(raw: string): string {
    const lines = raw.split('\n');
    const extracted: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        const obj = JSON.parse(trimmed) as unknown;
        const parts: string[] = [];
        tryExtractTextFromNode(obj, parts);
        if (parts.length > 0) {
          extracted.push(parts.join(''));
        }
      } catch {
        extracted.push(trimmed);
      }
    }

    return extracted.join('\n').trim();
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  isRateLimited(stderr: string): boolean {
    return RATE_LIMIT_PATTERNS.test(stderr);
  }

  parseRetryAfter(stderr: string): number | undefined {
    // "retry-after: 60"
    const retryAfterMatch = stderr.match(/retry.?after:?\s*(\d+)\s*s?/i);
    if (retryAfterMatch?.[1]) {
      return parseInt(retryAfterMatch[1], 10) * 1000;
    }

    // "retry after 25s"
    const retryAfterPatternMatch = stderr.match(/retry.?after\s+(\d+)\s*s?/i);
    if (retryAfterPatternMatch?.[1]) {
      return parseInt(retryAfterPatternMatch[1], 10) * 1000;
    }

    // "resets in 30s"
    const resetsInMatch = stderr.match(/resets?\s+in\s+(\d+)\s*s/i);
    if (resetsInMatch?.[1]) {
      return parseInt(resetsInMatch[1], 10) * 1000;
    }

    return undefined;
  }

  filterEnv(env: Record<string, string>): Record<string, string> {
    const filtered = { ...env };
    for (const key of Object.keys(filtered)) {
      if (key.startsWith('GEMINI') || key.startsWith('GOOGLE')) {
        delete filtered[key];
      }
    }
    return filtered;
  }

  supportsStreamJson(): boolean {
    return true;
  }
}
