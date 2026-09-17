#!/usr/bin/env node
import { Command } from 'commander';
import { applyAiFallback } from '../../../packages/ai/index.js';
import { GitHubActionsConnector } from '../../../packages/connectors/github-actions/index.js';
import type { CiConnector, CiConnectorContext } from '../../../packages/connectors/src/ci-connector.js';
import { formatTriageReport, triageFailure } from '../../../packages/triage-engine/index.js';

const program = new Command();

program
  .name('triage')
  .description('Vendor-neutral CI failure triage CLI')
  .version('0.1.0');

program
  .command('analyze')
  .description('Analyze a CI pipeline run')
  .requiredOption('--provider <provider>', 'CI provider')
  .requiredOption('--repository <repository>', 'Repository or project identifier')
  .requiredOption('--run-id <runId>', 'Pipeline run identifier')
  .option('--json', 'Emit machine-readable JSON', false)
  .action(async (options: { provider: string; repository: string; runId: string; json?: boolean }) => {
    try {
      const connector = createConnector(options.provider);
      const context: CiConnectorContext = {
        repository: options.repository,
        runId: String(options.runId)
      };

      const [pipelineRun, jobs, logs, artifacts] = await Promise.all([
        connector.getPipelineRun(context),
        connector.getJobs(context),
        connector.getLogs(context),
        connector.getArtifacts(context)
      ]);

      const deterministic = triageFailure({
        pipelineRun: {
          ...pipelineRun,
          jobs
        },
        jobs,
        logs,
        artifacts
      });

      const { result, analysisMode } = await applyAiFallback({
        evidence: deterministic.evidence,
        deterministic: deterministic.result
      });

      if (options.json) {
        console.log(JSON.stringify({
          provider: connector.provider,
          analysisMode,
          pipelineRun: deterministic.evidence.pipelineRun,
          evidence: {
            failedJobs: deterministic.evidence.failedJobs,
            failedSteps: deterministic.evidence.failedSteps,
            testsAppearedToFail: deterministic.evidence.testsAppearedToFail,
            pipelineStageType: deterministic.evidence.pipelineStageType,
            logExcerpts: deterministic.evidence.logExcerpts,
            detectedErrorSignatures: deterministic.evidence.detectedErrorSignatures,
            artifacts: deterministic.evidence.artifacts
          },
          triage: result
        }, null, 2));
        return;
      }

      console.log(formatTriageReport(deterministic.evidence, result, analysisMode));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  });

function createConnector(provider: string): CiConnector {
  if (provider === 'github-actions') {
    return new GitHubActionsConnector();
  }

  throw new Error(`Provider not implemented: ${provider}`);
}

program.parse();
