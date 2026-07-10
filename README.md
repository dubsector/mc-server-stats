# mc-server-stats

Tracks Minecraft server software version adoption across Paper, Folia, Purpur, and Leaf, split by stable and experimental builds. The site answers questions like "is 26.2 safe to run yet?" and "how fast are servers leaving 1.21.11?" with real numbers instead of guesswork.

Live site: https://dubsector.github.io/mc-server-stats/

## What it shows

- Total servers over time for each project, with history going back years
- Current version breakdown per project, colored by build stability, as bars or a pie
- Per-version adoption trends, so you can watch a new release climb while the old one declines
- A sortable table of every version with counts and share
- Ecosystem-wide market share for every server software bStats knows about, as bars or a pie

Filters for software, stability, time range, and metric (absolute count or percent share), plus a version search box. Everything renders from committed JSON with no external requests at page load, so the site works even if your network blocks bstats.org.

## Where the data comes from

| Source | What it provides |
|---|---|
| [bStats](https://bstats.org) | Server counts per Minecraft version for each project, total server history, and the global server software breakdown |
| [PaperMC Fill API](https://fill.papermc.io) | Build channels (stable, beta, alpha) for Paper and Folia |
| Leaf build API (`api.leafmc.one`) | Build channels for Leaf |
| String pattern heuristic | Stability for Purpur, which has no channel API. Versions matching pre-release, release candidate, or snapshot patterns count as experimental |

A scheduled workflow runs `scripts/collect.mjs` once a day, commits the snapshot through a pull request, and merges it after validation passes.

## Known limitations

- bStats only exposes per-version breakdowns as a current snapshot. There is no public history for them, so the per-version trend charts only accumulate from the day this collector first ran. They cannot be backfilled.
- The total-servers line does have full history from bStats, which is why that chart is populated from day one.
- Purpur's stability tag is a best-effort guess from the version string, not an authoritative channel like the other three projects have.
- The ecosystem panel is a current snapshot only. It shows the top 12 entries by server count with everything smaller folded into "Other". Some long-tail entries are dead forks that a few servers still run.

## Running locally

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
