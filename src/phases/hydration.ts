import type { BeastContext } from '../context/franken-context.js';
import type { IMemoryModule } from '../deps.js';

/**
 * Beast Loop Phase 1b: Hydration
 * Loads project context from memory (ADRs, known errors, rules).
 * Must run after ingestion so sanitizedIntent is available.
 */
export async function runHydration(
  ctx: BeastContext,
  memory: IMemoryModule,
): Promise<void> {
  ctx.addAudit('memory', 'frontload:start', { projectId: ctx.projectId });

  await memory.frontload(ctx.projectId);
  const memoryContext = await memory.getContext(ctx.projectId);

  // Enrich the sanitized intent with project context
  if (ctx.sanitizedIntent) {
    ctx.sanitizedIntent.context = {
      adrs: memoryContext.adrs,
      knownErrors: memoryContext.knownErrors,
      rules: memoryContext.rules,
    };
  }

  ctx.addAudit('memory', 'frontload:done', {
    adrsLoaded: memoryContext.adrs.length,
    knownErrors: memoryContext.knownErrors.length,
    rulesLoaded: memoryContext.rules.length,
  });
}
