import { readFileSync } from 'node:fs';
import { BeastLoop } from '../beast-loop.js';
import { ChunkFileGraphBuilder } from '../planning/chunk-file-graph-builder.js';
import { LlmGraphBuilder } from '../planning/llm-graph-builder.js';
import { InterviewLoop } from '../planning/interview-loop.js';
import { AdapterLlmClient } from '../adapters/adapter-llm-client.js';
import { ANSI, budgetBar, statusBadge, logHeader } from '../logging/beast-logger.js';
import type { InterviewIO } from '../planning/interview-loop.js';
import type { BeastResult } from '../types.js';
import type { ProjectPaths } from './project-root.js';
import { createCliDeps } from './dep-factory.js';
import { reviewLoop } from './review-loop.js';
import { writeDesignDoc, readDesignDoc, writeChunkFiles } from './file-writer.js';
import type { ChunkDefinition } from './file-writer.js';

export type SessionPhase = 'interview' | 'plan' | 'execute';

export interface SessionConfig {
  paths: ProjectPaths;
  baseBranch: string;
  budget: number;
  provider: 'claude' | 'codex';
  noPr: boolean;
  verbose: boolean;
  reset: boolean;
  io: InterviewIO;
  /** Entry phase — determined by CLI args */
  entryPhase: SessionPhase;
  /** Exit after this phase (subcommand mode) or run to completion (default mode) */
  exitAfter?: SessionPhase;
  /** Pre-existing design doc path (--design-doc flag) */
  designDocPath?: string;
  /** Pre-existing plan dir (--plan-dir flag) */
  planDirOverride?: string;
}

export class Session {
  constructor(private readonly config: SessionConfig) {}

  async start(): Promise<BeastResult | undefined> {
    const { entryPhase, exitAfter } = this.config;
    const phases: SessionPhase[] = ['interview', 'plan', 'execute'];
    const startIdx = phases.indexOf(entryPhase);

    for (let i = startIdx; i < phases.length; i++) {
      const phase = phases[i];

      if (phase === 'interview') {
        await this.runInterview();
        if (exitAfter === 'interview') return undefined;
      }

      if (phase === 'plan') {
        await this.runPlan();
        if (exitAfter === 'plan') return undefined;
      }

      if (phase === 'execute') {
        return this.runExecute();
      }
    }

    return undefined;
  }

  private async runInterview(): Promise<void> {
    const { paths, io } = this.config;
    const { deps } = createCliDeps(this.buildDepOptions());

    // Create LLM client from CLI executor adapter
    const adapterLlm = new AdapterLlmClient(deps.cliExecutor as never);

    // We use InterviewLoop with a capturing graph builder to intercept the
    // design doc before it gets decomposed. The InterviewLoop's internal flow
    // is: gather answers -> generate design doc -> approve -> decompose.
    // By providing a graph builder that captures instead of decomposing,
    // we get the design doc and can write it to disk + run the review loop.
    let capturedDesignDoc = '';
    const capturingGraphBuilder = {
      build: async (intent: { goal: string }) => {
        capturedDesignDoc = intent.goal;
        return { tasks: [] };
      },
    };

    const capturingInterview = new InterviewLoop(adapterLlm, io, capturingGraphBuilder as never);
    await capturingInterview.build({ goal: 'Gather requirements' });

    // Write design doc
    const designPath = writeDesignDoc(paths, capturedDesignDoc);

    // Review loop
    await reviewLoop({
      filePaths: [designPath],
      artifactLabel: 'Design document',
      io,
      onRevise: async (feedback) => {
        const revised = await adapterLlm.complete(
          `Revise this design document based on the following feedback:\n\nFeedback: ${feedback}\n\nCurrent document:\n${capturedDesignDoc}`,
        );
        capturedDesignDoc = revised;
        const path = writeDesignDoc(paths, revised);
        return [path];
      },
    });
  }

  private async runPlan(): Promise<void> {
    const { paths, io, designDocPath } = this.config;
    const { deps } = createCliDeps(this.buildDepOptions());

    // Load design doc
    let designContent: string;
    if (designDocPath) {
      designContent = readFileSync(designDocPath, 'utf-8');
    } else {
      const stored = readDesignDoc(paths);
      if (!stored) {
        throw new Error('No design document found. Run "frankenbeast interview" first, or provide --design-doc.');
      }
      designContent = stored;
    }

    const adapterLlm = new AdapterLlmClient(deps.cliExecutor as never);
    const llmGraphBuilder = new LlmGraphBuilder(adapterLlm);

    io.display('Decomposing design into implementation chunks...\n');

    // Build the plan graph to get chunk definitions
    const planGraph = await llmGraphBuilder.build({ goal: designContent });

    // Extract chunk definitions from the plan graph tasks
    const chunks = this.extractChunkDefinitions(planGraph);

    // Write chunk files
    let chunkPaths = writeChunkFiles(paths, chunks);

    // Review loop
    await reviewLoop({
      filePaths: chunkPaths,
      artifactLabel: 'Chunk files',
      io,
      onRevise: async (feedback) => {
        const revisedGraph = await llmGraphBuilder.build({
          goal: `${designContent}\n\nRevision feedback: ${feedback}`,
        });
        const revisedChunks = this.extractChunkDefinitions(revisedGraph);
        chunkPaths = writeChunkFiles(paths, revisedChunks);
        return chunkPaths;
      },
    });
  }

  private async runExecute(): Promise<BeastResult> {
    const { paths, planDirOverride, budget } = this.config;
    const chunkDir = planDirOverride ?? paths.plansDir;

    const { deps, logger, finalize } = createCliDeps(this.buildDepOptions());

    const graphBuilder = new ChunkFileGraphBuilder(chunkDir);
    const refreshPlanTasks = async () => {
      const latest = await graphBuilder.build({ goal: 'refresh chunk graph' });
      return latest.tasks;
    };

    // Wire graph builder and refresh into deps
    const fullDeps = {
      ...deps,
      graphBuilder,
      refreshPlanTasks,
    };

    const projectId = paths.root.split('/').pop() ?? 'unknown';

    // SIGINT handler
    let stopping = false;
    const sigintHandler = async () => {
      if (stopping) process.exit(1);
      stopping = true;
      logger.warn('SIGINT received. Finishing current iteration then stopping...');
      await finalize();
      process.exit(0);
    };
    process.on('SIGINT', sigintHandler);

    logger.info(`Budget: $${budget} | Provider: ${ANSI.bold}${this.config.provider}${ANSI.reset}`);

    const result = await new BeastLoop(fullDeps).run({
      projectId,
      userInput: `Process chunks in ${chunkDir}`,
    });

    await finalize();
    this.displaySummary(result);
    return result;
  }

  private extractChunkDefinitions(planGraph: {
    tasks: readonly { id: string; objective: string; requiredSkills: readonly string[]; dependsOn: readonly string[] }[];
  }): ChunkDefinition[] {
    // LlmGraphBuilder creates paired impl:/harden: tasks.
    // Extract unique chunk IDs from impl: tasks.
    const implTasks = planGraph.tasks.filter((t) => t.id.startsWith('impl:'));
    return implTasks.map((t) => {
      const chunkId = t.id.replace('impl:', '');
      return {
        id: chunkId,
        objective: t.objective,
        files: [],
        successCriteria: '',
        verificationCommand: '',
        dependencies: t.dependsOn
          .filter((d) => d.startsWith('harden:'))
          .map((d) => d.replace('harden:', '')),
      };
    });
  }

  private displaySummary(result: BeastResult): void {
    const A = ANSI;
    console.log(logHeader('BUILD SUMMARY'));
    console.log(`  ${A.dim}Duration:${A.reset}  ${(result.durationMs / 1000 / 60).toFixed(1)} min`);
    console.log(`  ${A.dim}Budget:${A.reset}    ${budgetBar(result.tokenSpend.estimatedCostUsd, this.config.budget)}`);
    console.log(`  ${A.dim}Status:${A.reset}    ${statusBadge(result.status === 'completed')}`);
    if (result.taskResults?.length) {
      console.log(`\n  ${A.dim}Chunks:${A.reset}`);
      for (const t of result.taskResults) {
        if (t.status === 'skipped') {
          console.log(`    ${A.dim} SKIP ${A.reset} ${A.dim}${t.taskId}${A.reset}`);
        } else {
          console.log(`    ${statusBadge(t.status === 'success')} ${A.bold}${t.taskId}${A.reset}`);
        }
      }
    }
    const passed = result.taskResults?.filter((t) => t.status === 'success').length ?? 0;
    const skipped = result.taskResults?.filter((t) => t.status === 'skipped').length ?? 0;
    const failed = result.taskResults?.filter((t) => t.status !== 'success' && t.status !== 'skipped').length ?? 0;
    const parts = [`${passed} passed`, `${failed} failed`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    console.log(`\n  ${failed === 0 ? A.green : A.red}${A.bold}Result: ${parts.join(', ')}${A.reset}\n`);
  }

  private buildDepOptions() {
    return {
      paths: this.config.paths,
      baseBranch: this.config.baseBranch,
      budget: this.config.budget,
      provider: this.config.provider,
      noPr: this.config.noPr,
      verbose: this.config.verbose,
      reset: this.config.reset,
    };
  }
}
