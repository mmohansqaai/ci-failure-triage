import { z } from 'zod';

export const triageConfigSchema = z.object({
  provider: z.enum(['github-actions', 'jenkins', 'azure-devops', 'gitlab-ci', 'circleci']),
  repository: z.string().min(1),
  runId: z.string().min(1),
  output: z.object({
    format: z.enum(['console', 'json']).default('console'),
    path: z.string().optional()
  }).default({ format: 'console' })
});

export type TriageConfig = z.infer<typeof triageConfigSchema>;

export function parseTriageConfig(input: unknown): TriageConfig {
  return triageConfigSchema.parse(input);
}
