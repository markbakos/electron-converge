## Summary

<!-- What changes, and why is it needed? -->

## Related issue

Closes #

<!-- Branch: <type>/<issue-number>-<short-kebab-description> -->

## Change type

- [ ] Feature
- [ ] Bug fix
- [ ] Documentation
- [ ] Test or quality improvement
- [ ] Performance change backed by measurements
- [ ] Build, CI, or release maintenance

## Scope and invariants

<!-- State the active release scope and which invariants or public contracts are affected. -->

- Main remains the only canonical state owner: yes / no / not applicable
- Successful actions still wait for main commit and source-replica installation: yes / no / not applicable
- Renderer reads and framework renders remain local with zero IPC: yes / no / not applicable
- Revision ordering, gap detection, and recovery remain intact: yes / no / not applicable
- IPC authorization, validation, serialization, and lifecycle boundaries remain intact: yes / no / not applicable

## Verification

| Command or check | Result |
| --- | --- |
| `pnpm check` | not run |
| `pnpm test:pack` | not run |
| Real Electron/manual/benchmark evidence | not run / not applicable |

<!-- Replace every entry with what actually ran. A type check is not runtime evidence, simulation is not Electron evidence, and a benchmark is not a correctness test. -->

## Unverified behavior

<!-- List skipped or environment-dependent Electron versions, operating systems, windows, reload/crash paths, manual checks, or benchmarks. Write "None" only when the full relevant matrix ran. -->

## Checklist

- [ ] The branch is named `<type>/<issue-number>-<short-kebab-description>`.
- [ ] The PR title and every retained commit use `<type>(optional-scope): summary (#<issue-number>)`.
- [ ] The PR body uses `Closes #<issue-number>` for the primary issue.
- [ ] The change is focused and contains no speculative scaffolding or unrelated refactor.
- [ ] Tests would fail if the changed behavior regressed.
- [ ] Public APIs, errors, compatibility, or guarantees are documented where affected.
- [ ] No raw IPC, secrets, private state, sensitive paths, stacks, or authorization details are exposed.
- [ ] New dependencies, lockfile changes, and install scripts are justified and reviewed.
