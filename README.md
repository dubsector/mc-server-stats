# mc-server-stats

[![Collect data](https://github.com/dubsector/mc-server-stats/actions/workflows/collect-data.yml/badge.svg)](https://github.com/dubsector/mc-server-stats/actions/workflows/collect-data.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/dubsector/mc-server-stats/badge)](https://scorecard.dev/viewer/?uri=github.com/dubsector/mc-server-stats)

Tracks Minecraft server software version adoption across Paper, Folia, Purpur, and Leaf, split by stable and experimental builds. The site answers questions like "is 26.2 safe to run yet?" and "how fast are servers leaving 1.21.11?" with real numbers instead of guesswork.

Live site: https://dubsector.github.io/mc-server-stats/

## What it shows

- Total servers over time for each project, with history going back years
- Current version breakdown per project, colored by build stability, as bars or a pie
- Per-version adoption trends, so you can watch a new release climb while the old one declines
- A sortable table of every version with counts and share
- Ecosystem-wide market share for every server software bStats knows about, as bars or a pie

Filters for software, stability, time range, and metric (absolute count or percent share), plus a version search box.

## How it works

The site is plain HTML, CSS, and JavaScript. There is no build step, no framework, and nothing to install. Charts render from JSON committed to the repo, so the page never calls bstats.org and keeps working even if your network blocks it.

A scheduled workflow runs `scripts/collect.mjs` every day shortly after midnight UTC. It fetches fresh numbers, opens a pull request with the new snapshot, waits for validation to pass, and squash-merges it.

## Where the data comes from

| Source | What it provides |
|---|---|
| [bStats](https://bstats.org) | Server counts per Minecraft version for each project, total server history, and the global server software breakdown |
| [PaperMC Fill API](https://fill.papermc.io) | Build channels (stable, beta, alpha) for Paper and Folia |
| Leaf build API (`api.leafmc.one`) | Build channels for Leaf |
| String pattern heuristic | Stability for Purpur, which has no channel API. Versions matching pre-release, release candidate, or snapshot patterns count as experimental |

A version counts as stable when the newest build for it sits in a stable channel. The channel APIs are only queried for the most recent version families; older versions are treated as stable unless the version string looks experimental.

## Data files

| File | Contents |
|---|---|
| `docs/data/history/<project>.json` | `servers`: one total-server count per day as `[timestamp, count]` pairs. `versions`: one snapshot per date, each a list of `{version, count, stable}` rows |
| `docs/data/ecosystem.json` | One entry per date: the top 12 server softwares by count, with everything smaller folded into "Other" |
| `docs/data/meta.json` | Last collection time and the list of tracked projects |

## Known limitations

- bStats only exposes per-version breakdowns as a current snapshot. There is no public history for them, so the per-version trend charts only accumulate from the day this collector first ran. They cannot be backfilled.
- The total-servers line does have full history from bStats, which is why that chart is populated from day one.
- Purpur's stability tag is a best-effort guess from the version string, not an authoritative channel like the other three projects have.
- If a build-channel API is unreachable during collection, stability for that project falls back to the version-string heuristic for that day.
- The ecosystem panel is a current snapshot only. Some long-tail entries are dead forks that a few servers still run.

## Running locally

Requires Node 18 or newer (the collector uses the built-in `fetch`).

```
node scripts/collect.mjs   # refresh docs/data from the live APIs
```

Then serve the `docs/` folder with any static file server.

## Repo layout

```
docs/            GitHub Pages root (site + committed data)
  data/          JSON snapshots the site renders
scripts/         collect.mjs, the daily collector
.github/         workflows: collect-data, validate, zizmor, scorecard
```

## License

[MIT](LICENSE)
