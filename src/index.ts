// Beast Loop orchestrator
export { BeastLoop } from './beast-loop.js';

// Dependencies
export type { BeastLoopDeps } from './deps.js';
export type {
  IFirewallModule,
  FirewallResult,
  FirewallViolation,
  ISkillsModule,
  SkillDescriptor,
  IMemoryModule,
  MemoryContext,
  EpisodicEntry,
  IPlannerModule,
  PlanIntent,
  PlanGraph,
  PlanTask,
  IObserverModule,
  SpanHandle,
  TokenSpendData,
  ICritiqueModule,
  CritiqueResult,
  CritiqueFinding,
  IGovernorModule,
  ApprovalPayload,
  ApprovalOutcome,
  IHeartbeatModule,
  HeartbeatPulseResult,
} from './deps.js';

// Types
export type {
  BeastPhase,
  BeastResult,
  BeastInput,
  TaskOutcome,
} from './types.js';

// Config
export { OrchestratorConfigSchema, defaultConfig } from './config/orchestrator-config.js';
export type { OrchestratorConfig } from './config/orchestrator-config.js';

// Context
export { BeastContext } from './context/franken-context.js';
export type { AuditEntry } from './context/franken-context.js';
export { createContext } from './context/context-factory.js';

// Phases
export { runIngestion, InjectionDetectedError } from './phases/ingestion.js';
export { runHydration } from './phases/hydration.js';
export { runPlanning, CritiqueSpiralError } from './phases/planning.js';
export { runExecution, HitlRejectedError } from './phases/execution.js';
export { runClosure } from './phases/closure.js';

// Circuit breakers
export { checkInjection } from './breakers/injection-breaker.js';
export { checkBudget, BudgetExceededError } from './breakers/budget-breaker.js';
export { checkCritiqueSpiral } from './breakers/critique-spiral-breaker.js';

// Resilience
export {
  serializeContext,
  deserializeContext,
  saveContext,
  loadContext,
} from './resilience/context-serializer.js';
export type { ContextSnapshot } from './resilience/context-serializer.js';
export { GracefulShutdown } from './resilience/graceful-shutdown.js';
export type { ShutdownHandler } from './resilience/graceful-shutdown.js';
export { checkModuleHealth, allHealthy } from './resilience/module-initializer.js';
export type { ModuleHealth } from './resilience/module-initializer.js';
