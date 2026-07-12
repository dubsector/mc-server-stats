# Security Policy

## Reporting a Vulnerability

This repository hosts a static GitHub Pages site and a scheduled data collector.
It does not handle user accounts, secrets beyond CI tokens, or personal data.

If you find a security issue in the **site or the build/collect pipeline** (for example
a supply-chain risk, a compromised action, a workflow that leaks a token, or a way to
inject malicious content into the published data), please report it privately:

- Open a [GitHub Security Advisory](https://github.com/dubsector/mc-server-stats/security/advisories/new) in this repository.

Please do not open a public issue for security reports.

## Scope

In scope:

- The GitHub Actions workflows in `.github/workflows/`
- The data collector in `scripts/collect.mjs`
- The client-side site in `docs/`

Out of scope:

- The upstream [bStats](https://bstats.org) service and the build-channel APIs the
  collector reads from. Report those to their respective maintainers.
- Statistics that look wrong or incomplete. Those are data-quality issues, not
  security issues, and belong in a normal GitHub issue.

## Supply-Chain Hardening

- All third-party GitHub Actions are pinned to a full commit SHA.
- Workflow permissions default to none and are granted per job at the minimum needed.
- Every workflow job sets `timeout-minutes` so a hung or malicious run cannot run
  indefinitely.
- Dependabot keeps the pinned action versions up to date on a weekly schedule.
- The repository is monitored by [OpenSSF Scorecard](https://securityscorecards.dev)
  and by [zizmor](https://github.com/zizmorcore/zizmor) for workflow misconfigurations.
