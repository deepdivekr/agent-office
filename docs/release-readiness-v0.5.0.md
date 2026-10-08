# v0.5.0 release verification

Status at the local release gate, October 9: local verification passed except one environment-bound case, described below. Protected GitHub CI and published-installer verification follow separately.

## Gates

- Frozen full quick regression (long soak excluded).
- Fresh installation and upgrades from every published version, now including v0.4.0.
- Public-boundary verification, protected-branch CI, versioned publication and published-installer checks.

## Results

**Frozen quick suite: 2,131 of 2,132 passed** at release candidate `13fde0a`.
- The run covered 798 unit, 692 contract-fake, 439 fixture-integration and 203 native-integration checks. No inputs changed during the run. Evidence: `tests/evidence/runtime-tests-2026-10-08T18-48-16-397Z.json`.
- The one failure is "Control Center takes the fixed default port". It needs `127.0.0.1:4600` free, and on the release machine the maintainer's own Control Center holds that port. It is not counted as a pass here; protected CI runs it on a clean runner.

**Fresh installation and upgrades passed 7/7** at the same candidate `13fde0a`.
- Scenarios: upgrades from v0.1.0, v0.1.1, v0.2.0, v0.3.0, v0.3.1 and v0.4.0, plus a fresh install.
- Evidence: `tests/evidence/release-install/2026-10-08T19-01-36.875Z.json`.
- These disposable installations use real dependencies, Chromium, the wrapper and MCP, with fixture models. CI checks its exact checkout again before publication.

**Public-boundary check passed** (834 files). Release notes and docs use neutral sample names; personal Works, servers, browser sessions and credentials are excluded from the release.

## Not claimed

- Client-run Works, server observation, Tailscale access and messenger delivery were exercised on the maintainer's own installation during development. That is not a public live example.
- Fixture tests are not presented as proof of live website, server or messenger success.

## Supported runtime

Ubuntu 24.04 x86_64, including Windows 11 WSL2. Native Windows desktop control remains experimental, and macOS is not certified. Login, CAPTCHA, external write approval and exhausted account quotas can still require user action.

[Acceptance backlog #6](https://github.com/deepdivekr/agent-office/issues/6) and [unattributed historical recovery failure #22](https://github.com/deepdivekr/agent-office/issues/22) remain open. This release does not claim failure-free operation or universal desktop support.
