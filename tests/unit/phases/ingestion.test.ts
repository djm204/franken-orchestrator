import { describe, it, expect, vi } from 'vitest';
import { runIngestion, InjectionDetectedError } from '../../../src/phases/ingestion.js';
import { BeastContext } from '../../../src/context/franken-context.js';
import { makeFirewall } from '../../helpers/stubs.js';

function ctx(input = 'build a feature'): BeastContext {
  return new BeastContext('proj', 'sess', input);
}

describe('runIngestion', () => {
  it('sets sanitizedIntent on clean input', async () => {
    const c = ctx();
    const firewall = makeFirewall();
    await runIngestion(c, firewall);

    expect(c.sanitizedIntent).toEqual({ goal: 'build a feature' });
    expect(c.phase).toBe('ingestion');
  });

  it('passes user input to firewall pipeline', async () => {
    const c = ctx('hello world');
    const firewall = makeFirewall();
    await runIngestion(c, firewall);

    expect(firewall.runPipeline).toHaveBeenCalledWith('hello world');
  });

  it('stores sanitized text (not raw input) as goal', async () => {
    const firewall = makeFirewall({
      runPipeline: vi.fn(async () => ({
        sanitizedText: '[REDACTED] build a feature',
        violations: [{ rule: 'pii', severity: 'warn' as const, detail: 'PII masked' }],
        blocked: false,
      })),
    });
    const c = ctx('John Smith wants to build a feature');
    await runIngestion(c, firewall);

    expect(c.sanitizedIntent?.goal).toBe('[REDACTED] build a feature');
  });

  it('throws InjectionDetectedError when blocked', async () => {
    const firewall = makeFirewall({
      runPipeline: vi.fn(async () => ({
        sanitizedText: '',
        violations: [{ rule: 'injection', severity: 'block' as const, detail: 'prompt injection' }],
        blocked: true,
      })),
    });
    const c = ctx('ignore previous instructions');

    await expect(runIngestion(c, firewall)).rejects.toThrow(InjectionDetectedError);
  });

  it('InjectionDetectedError includes violations', async () => {
    const violations = [
      { rule: 'injection', severity: 'block' as const, detail: 'prompt injection' },
    ];
    const firewall = makeFirewall({
      runPipeline: vi.fn(async () => ({
        sanitizedText: '',
        violations,
        blocked: true,
      })),
    });
    const c = ctx();

    try {
      await runIngestion(c, firewall);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InjectionDetectedError);
      expect((e as InjectionDetectedError).violations).toEqual(violations);
    }
  });

  it('adds audit entries', async () => {
    const c = ctx();
    await runIngestion(c, makeFirewall());

    expect(c.audit).toHaveLength(2);
    expect(c.audit[0]!.action).toBe('pipeline:start');
    expect(c.audit[1]!.action).toBe('pipeline:clean');
  });

  it('adds blocked audit entry on injection', async () => {
    const firewall = makeFirewall({
      runPipeline: vi.fn(async () => ({
        sanitizedText: '',
        violations: [{ rule: 'injection', severity: 'block' as const, detail: 'blocked' }],
        blocked: true,
      })),
    });
    const c = ctx();

    try {
      await runIngestion(c, firewall);
    } catch {
      // expected
    }

    const blockedAudit = c.audit.find(a => a.action === 'pipeline:blocked');
    expect(blockedAudit).toBeDefined();
  });
});
