/**
 * BeastLoopDeps — dependency injection interface for the orchestrator.
 * Follows the PulseOrchestratorDeps pattern from franken-heartbeat.
 *
 * All module ports are defined as minimal interfaces so the orchestrator
 * never depends on concrete module implementations.
 */

/** What the orchestrator needs from MOD-01 (Firewall). */
export interface IFirewallModule {
  runPipeline(input: string): Promise<FirewallResult>;
}

export interface FirewallResult {
  readonly sanitizedText: string;
  readonly violations: readonly FirewallViolation[];
  readonly blocked: boolean;
}

export interface FirewallViolation {
  readonly rule: string;
  readonly severity: 'block' | 'warn';
  readonly detail: string;
}

/** What the orchestrator needs from MOD-02 (Skills). */
export interface ISkillsModule {
  hasSkill(skillId: string): boolean;
  getAvailableSkills(): readonly SkillDescriptor[];
}

export interface SkillDescriptor {
  readonly id: string;
  readonly name: string;
  readonly requiresHitl: boolean;
}

/** What the orchestrator needs from MOD-03 (Brain/Memory). */
export interface IMemoryModule {
  frontload(projectId: string): Promise<void>;
  getContext(projectId: string): Promise<MemoryContext>;
  recordTrace(trace: EpisodicEntry): Promise<void>;
}

export interface MemoryContext {
  readonly adrs: readonly string[];
  readonly knownErrors: readonly string[];
  readonly rules: readonly string[];
}

export interface EpisodicEntry {
  readonly taskId: string;
  readonly summary: string;
  readonly outcome: 'success' | 'failure';
  readonly timestamp: string;
}

/** What the orchestrator needs from MOD-04 (Planner). */
export interface IPlannerModule {
  createPlan(intent: PlanIntent): Promise<PlanGraph>;
}

export interface PlanIntent {
  readonly goal: string;
  readonly strategy?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

export interface PlanGraph {
  readonly tasks: readonly PlanTask[];
}

export interface PlanTask {
  readonly id: string;
  readonly objective: string;
  readonly requiredSkills: readonly string[];
  readonly dependsOn: readonly string[];
}

/** What the orchestrator needs from MOD-05 (Observer). */
export interface IObserverModule {
  startTrace(sessionId: string): void;
  startSpan(name: string): SpanHandle;
  getTokenSpend(sessionId: string): Promise<TokenSpendData>;
}

export interface SpanHandle {
  end(metadata?: Record<string, unknown> | undefined): void;
}

export interface TokenSpendData {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
}

/** What the orchestrator needs from MOD-06 (Critique). */
export interface ICritiqueModule {
  reviewPlan(plan: PlanGraph, context?: unknown): Promise<CritiqueResult>;
}

export interface CritiqueResult {
  readonly verdict: 'pass' | 'fail';
  readonly findings: readonly CritiqueFinding[];
  readonly score: number;
}

export interface CritiqueFinding {
  readonly evaluator: string;
  readonly severity: string;
  readonly message: string;
}

/** What the orchestrator needs from MOD-07 (Governor). */
export interface IGovernorModule {
  requestApproval(request: ApprovalPayload): Promise<ApprovalOutcome>;
}

export interface ApprovalPayload {
  readonly taskId: string;
  readonly summary: string;
  readonly skillId?: string | undefined;
  readonly requiresHitl: boolean;
}

export interface ApprovalOutcome {
  readonly decision: 'approved' | 'rejected' | 'abort';
  readonly reason?: string | undefined;
}

/** What the orchestrator needs from MOD-08 (Heartbeat). */
export interface IHeartbeatModule {
  pulse(): Promise<HeartbeatPulseResult>;
}

export interface HeartbeatPulseResult {
  readonly improvements: readonly string[];
  readonly techDebt: readonly string[];
  readonly summary: string;
}

/** Full dependency bag for the Beast Loop. */
export interface BeastLoopDeps {
  readonly firewall: IFirewallModule;
  readonly skills: ISkillsModule;
  readonly memory: IMemoryModule;
  readonly planner: IPlannerModule;
  readonly observer: IObserverModule;
  readonly critique: ICritiqueModule;
  readonly governor: IGovernorModule;
  readonly heartbeat: IHeartbeatModule;
  readonly clock: () => Date;
}
