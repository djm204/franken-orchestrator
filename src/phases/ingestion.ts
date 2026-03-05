import type { BeastContext } from '../context/franken-context.js';
import type { IFirewallModule } from '../deps.js';

export class InjectionDetectedError extends Error {
  constructor(
    public readonly violations: readonly { rule: string; severity: string; detail: string }[],
  ) {
    super('Input blocked by firewall: injection detected');
    this.name = 'InjectionDetectedError';
  }
}

/**
 * Beast Loop Phase 1a: Ingestion
 * Sends raw user input through the firewall pipeline.
 * If blocked (injection detected), throws InjectionDetectedError.
 * Otherwise, stores sanitised intent on the context.
 */
export async function runIngestion(
  ctx: BeastContext,
  firewall: IFirewallModule,
): Promise<void> {
  ctx.phase = 'ingestion';
  ctx.addAudit('firewall', 'pipeline:start', { input: ctx.userInput });

  const result = await firewall.runPipeline(ctx.userInput);

  if (result.blocked) {
    ctx.addAudit('firewall', 'pipeline:blocked', { violations: result.violations });
    throw new InjectionDetectedError(result.violations);
  }

  ctx.sanitizedIntent = {
    goal: result.sanitizedText,
  };

  ctx.addAudit('firewall', 'pipeline:clean', {
    sanitizedLength: result.sanitizedText.length,
    warningCount: result.violations.length,
  });
}
