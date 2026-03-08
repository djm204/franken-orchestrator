import { existsSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { BeastLogger } from '../logging/beast-logger.js';
import { RalphLoop } from '../skills/ralph-loop.js';
import { GitBranchIsolator } from '../skills/git-branch-isolator.js';
import { CliSkillExecutor } from '../skills/cli-skill-executor.js';
import { CliLlmAdapter } from '../adapters/cli-llm-adapter.js';
import { CliObserverBridge } from '../adapters/cli-observer-bridge.js';
import { FileCheckpointStore } from '../checkpoint/file-checkpoint-store.js';
import { PrCreator } from '../closure/pr-creator.js';
import { AdapterLlmClient } from '../adapters/adapter-llm-client.js';
import { setupTraceViewer } from './trace-viewer.js';
import type { TraceViewerHandle } from './trace-viewer.js';
import type {
  BeastLoopDeps, IFirewallModule, ISkillsModule, IMemoryModule,
  IPlannerModule, ICritiqueModule, IGovernorModule,
  IHeartbeatModule,
} from '../deps.js';
import type { ProjectPaths } from './project-root.js';

export interface CliDepOptions {
  paths: ProjectPaths;
  baseBranch: string;
  budget: number;
  provider: string;
  noPr: boolean;
  verbose: boolean;
  reset: boolean;
  planDirOverride?: string | undefined;
}

export interface CliDeps {
  deps: BeastLoopDeps;
  cliLlmAdapter: CliLlmAdapter;
  observerBridge: CliObserverBridge;
  logger: BeastLogger;
  finalize: () => Promise<void>;
}

// ── Passthrough Stubs ──

const stubFirewall: IFirewallModule = {
  runPipeline: async (input) => ({ sanitizedText: input, violations: [], blocked: false }),
};
const stubMemory: IMemoryModule = {
  frontload: async () => {},
  getContext: async () => ({ adrs: [], knownErrors: [], rules: [] }),
  recordTrace: async () => {},
};
const stubPlanner: IPlannerModule = {
  createPlan: async () => { throw new Error('Planner not available in CLI mode; use graphBuilder'); },
};
const stubCritique: ICritiqueModule = {
  reviewPlan: async () => ({ verdict: 'pass' as const, findings: [], score: 1.0 }),
};
const stubGovernor: IGovernorModule = {
  requestApproval: async () => ({ decision: 'approved' as const }),
};
const stubHeartbeat: IHeartbeatModule = {
  pulse: async () => ({ improvements: [], techDebt: [], summary: '' }),
};

function createStubSkills(planDir: string): ISkillsModule {
  return {
    hasSkill: (id: string) => id.startsWith('cli:'),
    getAvailableSkills: () => {
      try {
        return readdirSync(planDir)
          .filter((f) => f.endsWith('.md') && !f.startsWith('00_') && /^\d{2}/.test(f))
          .map((f) => ({
            id: `cli:${f.replace('.md', '')}`,
            name: f.replace('.md', ''),
            executionType: 'cli' as const,
            requiresHitl: false,
          }));
      } catch { return []; }
    },
    execute: async () => { throw new Error('No skills in CLI mode'); },
  };
}

export async function createCliDeps(options: CliDepOptions): Promise<CliDeps> {
  const { paths, baseBranch, budget, verbose, noPr, reset } = options;

  // Derive plan name for plan-specific build artifacts
  const planName = options.planDirOverride
    ? basename(options.planDirOverride).replace(/\/$/, '')
    : 'session';
  const checkpointFile = resolve(paths.buildDir, `${planName}.checkpoint`);

  // Reset if requested
  if (reset) {
    for (const f of [checkpointFile, paths.tracesDb]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }

  // Build timestamped log file: .build/<plan-name>-<datetime>-build.log
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-03-08T20-12-05
  const logFile = resolve(paths.buildDir, `${planName}-${ts}-build.log`);
  mkdirSync(paths.buildDir, { recursive: true });

  const logger = new BeastLogger({ verbose, captureForFile: true, logFile });

  // Observer
  const observerBridge = new CliObserverBridge({ budgetLimitUsd: budget });
  observerBridge.startTrace(`cli-session-${Date.now()}`);

  // Trace viewer (verbose mode only)
  let traceViewerHandle: TraceViewerHandle | null = null;
  if (verbose) {
    traceViewerHandle = await setupTraceViewer(paths.tracesDb, logger);
  }

  // CLI execution stack
  const checkpoint = new FileCheckpointStore(checkpointFile);
  const ralph = new RalphLoop();
  const gitIso = new GitBranchIsolator({
    baseBranch,
    branchPrefix: 'feat/',
    autoCommit: true,
    workingDir: paths.root,
  });
  const cliLlmAdapter = new CliLlmAdapter({
    // Cast until cli-llm-adapter.ts is refactored in chunk 04-05
    provider: options.provider as 'claude' | 'codex',
    workingDir: paths.root,
  });

  const adapterLlm = new AdapterLlmClient(cliLlmAdapter);

  // PR creator (wrap adapter as ILlmClient for LLM-powered titles/descriptions)
  const prCreator = noPr ? undefined : new PrCreator(
    { targetBranch: 'main', disabled: false, remote: 'origin' },
    undefined,
    adapterLlm,
  );

  // Commit message generator — delegates to PrCreator's LLM prompt
  const commitMessageFn = prCreator
    ? (diffStat: string, objective: string) => prCreator.generateCommitMessage(diffStat, objective)
    : undefined;

  // Recovery verify command — typecheck as a fast sanity check that
  // dirty files from a crashed run don't break the build
  const verifyCommand = 'npx tsc --noEmit';

  const cliExecutor = new CliSkillExecutor(
    ralph, gitIso, observerBridge.observerDeps,
    verifyCommand, commitMessageFn, logger,
  );

  const finalize = async () => {
    if (traceViewerHandle) {
      await traceViewerHandle.stop();
    }
    // Log entries are now written incrementally by BeastLogger (crash-safe).
    // No batch write needed here.
  };

  const deps: BeastLoopDeps = {
    firewall: stubFirewall,
    skills: createStubSkills(options.planDirOverride ?? paths.plansDir),
    memory: stubMemory,
    planner: stubPlanner,
    observer: observerBridge,
    critique: stubCritique,
    governor: stubGovernor,
    heartbeat: stubHeartbeat,
    logger,
    clock: () => new Date(),
    cliExecutor,
    checkpoint,
    ...(prCreator ? { prCreator } : {}),
  };

  return { deps, cliLlmAdapter, observerBridge, logger, finalize };
}
