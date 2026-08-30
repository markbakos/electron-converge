# Security policy

Electron Converge treats renderer IPC, session identity, authorization, serialization, resource bounds, and lifecycle cleanup as security boundaries.

## Supported versions

| Version | Security support |
| --- | --- |
| Latest `1.x` release | Supported |
| Earlier releases | Upgrade to the latest `1.x` release first |
| Pre-`1.0` releases | Not supported |

Security fixes are released on the latest supported line. This table will be updated before support moves to another major line.

## Report a vulnerability privately

Do not open a public issue, pull request, discussion, or proof-of-concept for a suspected vulnerability.

[Report a private security vulnerability](https://github.com/markbakos/electron-converge/security/advisories/new) through GitHub Security Advisories. Include:

- the affected package version and public entry point;
- Electron, Node.js, React, and operating-system versions when relevant;
- a minimal reproduction or clear steps;
- the expected and observed security boundary;
- impact and realistic attack prerequisites;
- any suggested mitigation; and
- whether the report or proof-of-concept has been shared elsewhere.

Remove credentials, application state, personal data, filesystem paths, and unrelated logs. If a minimal reproduction needs sensitive material, describe that fact in the private report before attaching it.

## Relevant vulnerability classes

Reports are especially useful when they demonstrate:

- unauthorized attachment, state observation, command execution, or recovery;
- sender, frame, session, role, store, action, or capability spoofing;
- stale renderers remaining valid after navigation, reload, crash, or destruction;
- raw or renderer-selected Electron IPC escaping the preload boundary;
- unsafe structured-clone values, prototype pollution, or partial invalid commits;
- resource-bound bypasses or unbounded queues, history, or buffers;
- disclosure of state, action data, trusted context, authorization detail, paths, stacks, or secrets;
- acknowledgement resolving before canonical commit and source-replica installation; or
- a vulnerable runtime dependency reachable through the published package.

General support requests, feature proposals, and bugs without a security impact belong in the public issue forms.

## What to expect

Maintainers will acknowledge the report as soon as practical, reproduce and assess the impact, coordinate a fix and release when necessary, and agree on disclosure timing with the reporter. Response and release time depend on severity, reproducibility, affected versions, and upstream dependencies.

Please keep the report private until a fix or mitigation is available and coordinated disclosure is complete. Good-faith research that avoids privacy violations, service disruption, and access beyond what is needed to demonstrate the issue is welcome.
