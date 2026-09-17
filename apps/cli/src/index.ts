#!/usr/bin/env node
import { Command } from 'commander';
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

      const { evidence, result } = triageFailure({
        pipelineRun: {
          ...pipelineRun,
          jobs
        },
        jobs,
        logs,
        artifacts
      });

      if (options.json) {
        console.log(JSON.stringify({
          provider: connector.provider,
          pipelineRun: evidence.pipelineRun,
          evidence: {
            failedJobs: evidence.failedJobs,
            failedSteps: evidence.failedSteps,
            testsAppearedToFail: evidence.testsAppearedToFail,
            pipelineStageType: evidence.pipelineStageType,
            logExcerpts: evidence.logExcerpts,
            detectedErrorSignatures: evidence.detectedErrorSignatures,
            artifacts: evidence.artifacts
          },
          triage: result
        }, null, 2));
        return;
      }

      console.log(formatTriageReport(evidence, result));
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
