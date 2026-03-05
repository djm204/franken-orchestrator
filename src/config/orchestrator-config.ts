import { z } from 'zod';

export const OrchestratorConfigSchema = z.object({
  /** Maximum plan-critique iterations before escalation. */
  maxCritiqueIterations: z.number().int().min(1).max(10).default(3),

  /** Maximum total tokens before budget breaker trips. */
  maxTotalTokens: z.number().int().min(1000).default(100_000),

  /** Maximum execution time in milliseconds. */
  maxDurationMs: z.number().int().min(1000).default(300_000),

  /** Whether to run a heartbeat pulse after execution. */
  enableHeartbeat: z.boolean().default(true),

  /** Whether to emit observability spans. */
  enableTracing: z.boolean().default(true),

  /** Minimum critique score to pass (0-1). */
  minCritiqueScore: z.number().min(0).max(1).default(0.7),
});

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

export function defaultConfig(): OrchestratorConfig {
  return OrchestratorConfigSchema.parse({});
}
