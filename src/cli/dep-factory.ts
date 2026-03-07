import { existsSync, unlinkSync, readdirSync, appendFileSync } from 'node:fs';
import { BeastLogger } from '../logging/beast-logger.js';
import { RalphLoop } from '../skills/ralph-loop.js';
import { GitBranchIsolator } from '../skills/git-branch-isolator.js';
import { CliSkillExecutor } from '../skills/cli-skill-executor.js';
import { CliLlmAdapter } from '../adapters/cli-llm-adapter.js';
import { CliObserverBridge } from '../adapters/cli-observer-bridge.js';
import { FileCheckpointStore } from '../checkpoint/file-checkpoint-store.js';
import { PrCreator } from '../closure/pr-creator.js';
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
  provider: 'claude' | 'codex';
  noPr: boolean;
  verbose: boolean;
  reset: boolean;
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

export function createCliDeps(options: CliDepOptions): CliDeps {
  const { paths, baseBranch, budget, verbose, noPr, reset } = options;

  // Reset if requested
  if (reset) {
    for (const f of [paths.checkpointFile, paths.tracesDb]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }

  const logger = new BeastLogger({ verbose, captureForFile: true });

  // Observer
  const observerBridge = new CliObserverBridge({ budgetLimitUsd: budget });
  observerBridge.startTrace(`cli-session-${Date.now()}`);

  // CLI execution stack
  const checkpoint = new FileCheckpointStore(paths.checkpointFile);
  const ralph = new RalphLoop();
  const gitIso = new GitBranchIsolator({
    baseBranch,
    branchPrefix: 'feat/',
    autoCommit: true,
    workingDir: paths.root,
  });
  const cliLlmAdapter = new CliLlmAdapter({
    provider: options.provider,
    workingDir: paths.root,
  });

  const cliExecutor = new CliSkillExecutor(
    ralph, gitIso, observerBridge.observerDeps,
    undefined, undefined, logger,
  );

  // PR creator
  const prCreator = noPr ? undefined : new PrCreator({
    targetBranch: 'main',
    disabled: false,
    remote: 'origin',
  });

  const finalize = async () => {
    for (const e of logger.getLogEntries()) {
      appendFileSync(paths.logFile, e + '\n');
    }
  };

  const deps: BeastLoopDeps = {
    firewall: stubFirewall,
    skills: createStubSkills(paths.plansDir),
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
