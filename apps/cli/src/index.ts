#!/usr/bin/env node
import { Command } from 'commander';

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
  .action((options) => {
    console.log(JSON.stringify({
      status: 'NOT_IMPLEMENTED',
      phase: 'PHASE_0',
      message: 'CLI contract is ready. Provider connectivity starts in Phase 1.',
      request: {
        provider: options.provider,
        repository: options.repository,
        runId: options.runId
      }
    }, null, 2));
  });

program.parse();
