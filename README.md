# CI Failure Triage

Standalone, vendor-neutral CI failure intelligence and triage platform.

## Product direction

The platform will connect to CI/CD systems through provider adapters, normalize pipeline evidence into a common model, and later classify/correlate failures using deterministic rules, history and AI-assisted reasoning.

The core triage engine must remain independent from both CI vendors and test frameworks.

## Phase 0 — Foundation

Current scope:

- TypeScript / Node.js project foundation
- Provider-neutral pipeline and triage contracts
- Standard `CiConnector` interface
- Configuration validation
- Structured logging
- CLI shell
- Contract tests
- Repository CI validation

No GitHub-specific connector, test-framework parsing or AI reasoning is implemented in Phase 0.

## CLI

Install dependencies:

```bash
npm install
```

Check the foundation:

```bash
npm run check
npm test
```

CLI help:

```bash
npm run triage -- --help
```

Phase 0 request shape:

```bash
npm run triage -- analyze \
  --provider github-actions \
  --repository owner/repository \
  --run-id 123456
```

The command intentionally returns `NOT_IMPLEMENTED` until Phase 1 adds real provider connectivity.

## Next — Phase 1

The first provider adapter will be GitHub Actions. It will retrieve and normalize pipeline runs, jobs, steps, logs and artifacts without adding triage code to the target test repository.
