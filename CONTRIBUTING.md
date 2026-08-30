# Contributing to Electron Converge

Thanks for helping improve Electron Converge. Changes should keep the library small, secure, and consistent across Electron processes.

## Before starting

- Search existing issues and pull requests.
- Open or claim an issue before non-trivial work.
- Keep one issue per branch and one focused concern per pull request.
- Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), never through a public issue.

## Invariants every change must preserve

1. Main owns canonical state; renderers issue commands and maintain revisioned local replicas.
2. An action resolves only after main commits it and the originating renderer installs that committed revision.
3. Renderer reads and React renders use the local replica and perform no Electron IPC.
4. Missing revisions trigger catch-up or authoritative snapshot recovery; they are never silently accepted.
5. Renderer IPC is untrusted, bounded, authorized, and exposed only through the fixed preload bridge.
6. Canonical reducers remain synchronous, deterministic, CPU-bounded, and free of I/O.

Do not add synchronous IPC, renderer authority, automatic command retry, cross-store transactions, persistence guarantees, bulk-data transport, or new adapter infrastructure without an approved issue and design.

## Development setup

Requirements:

- Node.js 24.18.1 or newer
- pnpm 11
- a supported Electron development environment

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:pack
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build JavaScript and declarations |
| `pnpm test` | Run build, Node, type, and real Electron tests |
| `pnpm test:e2e` | Run the real Electron lifecycle test |
| `pnpm test:pack` | Install and verify the packed npm artifact |
| `pnpm bench` | Run the reproducible benchmark harness |

Use `pnpm bench` only for performance work. Record the environment and before/after distributions; do not optimize from one noisy run.

## Branch names

Use:

```text
<type>/<issue-number>-<short-kebab-description>
```

The issue number does not include `#`. Allowed types are `feat`, `fix`, `docs`, `test`, `perf`, `refactor`, `build`, `ci`, and `chore`.

Examples:

```text
feat/12-add-action-methods
fix/23-reject-stale-session
docs/7-add-contribution-standards
```

## Commit messages

Every retained commit must reference its issue:

```text
<type>(optional-scope): <imperative summary> (#<issue-number>)
```

Examples:

```text
feat(renderer): add selector subscriptions (#1)
fix(main): reject stale recovery requests (#23)
docs(repo): add contribution templates (#7)
```

- Use an imperative, lowercase summary without a trailing period.
- Keep commits focused and independently understandable.
- Before review, squash or fix up temporary commits so every retained commit follows the format.
- Do not mix dependency upgrades, refactors, and behavior changes unless the issue requires them together.

## Pull requests

Open pull requests against `main` and use the repository template.

- Use the commit format for the PR title, including `(#<issue-number>)`.
- Put `Closes #<issue-number>` in the PR body so GitHub links and closes the issue when the PR reaches the default branch.
- Explain the behavior and reason, not a file-by-file transcript.
- State the release scope and invariants affected.
- Report every command actually run and its result.
- Distinguish Node simulation, type checks, real Electron E2E, manual checks, and benchmarks.
- Call out Electron, operating-system, reload, crash, or multi-window behavior that remains unverified.
- Update public documentation when behavior, types, errors, compatibility, or guarantees change.

Maintainers may squash a pull request. Keep the PR title suitable for the final squash commit.

## Testing expectations

Add the smallest test that would fail if the changed behavior regressed:

- core behavior: Node unit and type tests;
- ordering, acknowledgement, replay, or recovery: deterministic protocol tests and property tests when appropriate;
- IPC, preload, authorization, navigation, reload, crash, or window lifecycle: real Electron evidence;
- package exports or declarations: packed-consumer verification;
- performance: comparable before/after benchmark distributions.

A type check is not runtime evidence, simulation is not Electron evidence, and a benchmark is not a correctness test.

## Review standards

Reviewers check correctness, simplicity, process boundaries, security, performance, public compatibility, tests, and documentation. Resolve required findings before merge. Keep speculative abstractions, dependencies, and later-roadmap scaffolding out of focused changes.
