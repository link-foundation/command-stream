# CI Integration Setup

## GitHub Actions Workflow

Due to OAuth scope limitations, the GitHub Actions workflow file needs to be added manually by a repository maintainer with appropriate permissions.

### Required Workflow File

Create `.github/workflows/benchmarks.yml` with the content provided in this directory.

### Workflow Features

- **Automated benchmarking** on PRs and main branch pushes
- **Weekly regression testing** via cron schedule
- **Manual trigger** with customizable options
- **Baseline comparison** between PR and main branch
- **Results artifacts** with 30-day retention
- **PR comments** with benchmark summaries

### Workflow Permissions

The workflow requires the following permissions:
- `contents: read` - Read repository contents
- `pull-requests: write` - Comment on PRs
- `actions: read` - Access to artifacts

### Triggers

1. **Pull Request**: When changes affect benchmarking code
2. **Push to Main**: After merging changes
3. **Manual Dispatch**: On-demand with custom options
4. **Weekly Schedule**: Every Monday at 6 AM UTC for regression testing

### Outputs

- Benchmark results artifacts
- HTML reports
- Comparison summaries
- Performance regression alerts

## Local CI Simulation

Test the workflow locally:

```bash
# Simulate the benchmark smoke test
npm run benchmark:demo

# Simulate full benchmark suite
npm run benchmark

# Test individual suites
npm run benchmark:features
npm run benchmark:performance
```

## Integration Steps

1. **Add Workflow File**: Copy `benchmarks.yml` to `.github/workflows/`
2. **Test Run**: Trigger manually to verify setup
3. **Configure Alerts**: Set up notifications for regressions
4. **Monitor Results**: Review weekly regression test results