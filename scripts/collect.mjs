// Pulls current version-adoption data from bStats plus stable/experimental build-channel
// data from each project's own API, and appends today's snapshot to docs/data/history/*.json
// and docs/data/ecosystem.json. Safe to re-run multiple times on the same day (idempotent).
//
// Data lives under docs/ (not a top-level data/ dir) because GitHub Pages is configured to
// serve main /docs, so anything the site fetches at runtime has to live inside that folder.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'docs', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

const BSTATS_BASE = 'https://bstats.org/api/v1';
const GLOBAL_SOFTWARE_PLUGIN_ID = 1;
const GLOBAL_SOFTWARE_CHART = 'serverSoftware';
const TOP_ECOSYSTEM_ENTRIES = 12;

const PROJECTS = {
  paper: { name: 'Paper', bstatsId: 580, channelSource: 'fill', fillSlug: 'paper' },
  folia: { name: 'Folia', bstatsId: 18084, channelSource: 'fill', fillSlug: 'folia' },
  purpur: { name: 'Purpur', bstatsId: 5103, channelSource: 'regex' },
  leaf: { name: 'Leaf', bstatsId: 19539, channelSource: 'leafmc' },
};

const STABLE_CHANNEL_NAMES = new Set(['stable', 'release', 'default']);

const EXPERIMENTAL_PATTERN =
  /pre-?release|release candidate|\brc\b|-rc-?\d|-pre-?\d|\bsnapshot\b|^\d{2}w\d{2}[a-z]$/i;

const FETCH_TIMEOUT_MS = 30000;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchBstatsPie(pluginId, chartId) {
  return fetchJson(`${BSTATS_BASE}/plugins/${pluginId}/charts/${chartId}/data`);
}

// Without maxElements bStats only returns the last ~2 days. 200k covers the full
// archive (Paper's goes back to 2020) at 30-minute resolution.
async function fetchBstatsLine(pluginId, chartId) {
  return fetchJson(`${BSTATS_BASE}/plugins/${pluginId}/charts/${chartId}/data?maxElements=200000`);
}

// 30-minute resolution is ~17k points/year per project, too heavy to commit and ship
// to browsers. Keep the last value of each UTC day, stamped at that day's midnight so
// timestamps align across projects (the totals tooltip matches series by exact ts).
// bStats zero-pads every chart back to 2015 regardless of when the project first
// reported, so drop the leading zeros too.
function downsampleDaily(points) {
  const chronological = [...points].sort((a, b) => a[0] - b[0]);
  const byDay = new Map();
  for (const [ts, value] of chronological) {
    byDay.set(new Date(ts).toISOString().slice(0, 10), value);
  }
  const daily = [...byDay.entries()].map(([day, value]) => [Date.parse(`${day}T00:00:00Z`), value]);
  const firstNonZero = daily.findIndex(([, value]) => value > 0);
  return firstNonZero === -1 ? [] : daily.slice(firstNonZero);
}

// A few forks report mangled version strings to bStats, like "26.2) (Legacy MC: 1.21" or
// "26.2; Legacy MC: 1.21". Keep the leading version and drop the rest so those servers
// count toward the real version instead of showing up as junk rows.
function cleanVersionLabel(raw) {
  const label = String(raw).trim();
  const mangled = label.match(/^(\d+(?:\.\d+)+)\s*[);]/);
  return mangled ? mangled[1] : label;
}

// Folds the mangled rows into their real version, keeping bStats' original row order.
function mergePieRows(pieData) {
  const rows = pieData.filter((e) => cleanVersionLabel(e.name) === e.name).map((e) => ({ ...e }));
  for (const entry of pieData) {
    const name = cleanVersionLabel(entry.name);
    if (name === entry.name) continue;
    const target = rows.find((r) => r.name === name);
    if (target) target.y += entry.y;
    else rows.push({ name, y: entry.y });
  }
  return rows;
}

function normalizeVersion(raw) {
  return raw
    .toLowerCase()
    .replace(/release candidate/g, 'rc')
    .replace(/pre-release/g, 'pre')
    .replace(/[\s_-]+/g, '');
}

function isExperimentalByPattern(raw) {
  return EXPERIMENTAL_PATTERN.test(raw);
}

function numericParts(key) {
  return key.split('.').map((n) => parseInt(n, 10) || 0);
}

function compareVersionKeysDesc(a, b) {
  const pa = numericParts(a);
  const pb = numericParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function channelIsStable(channel) {
  return STABLE_CHANNEL_NAMES.has(String(channel).toLowerCase());
}

// Runs fn over items with at most `limit` requests in flight, so checking dozens of
// versions doesn't hammer the build APIs.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Builds a normalized-version -> isStable lookup for every version that both shows up in
// today's bStats data and exists in the project's build API. Checking only the newest
// families broke as soon as a new release landed: a version that never got a stable build
// (Folia 26.2, Leaf 26.1.2) would drop out of the lookup and fall back to the version-string
// heuristic, which calls any plain version number stable.
async function buildChannelMap(apiVersions, wanted, fetchBuilds, label) {
  const map = new Map();
  const toCheck = apiVersions.filter((v) => wanted.has(normalizeVersion(v)));
  await mapLimit(toCheck, 6, async (version) => {
    try {
      const stable = await fetchBuilds(version);
      if (stable !== null) map.set(normalizeVersion(version), stable);
    } catch (err) {
      console.warn(`${label} builds lookup failed for ${version}: ${err.message}`);
    }
  });
  return map;
}

async function buildFillChannelMap(fillSlug, wanted) {
  // If this fetch fails, fail the whole run: with no channel map, a brand-new
  // experimental version with a plain version string would be recorded as stable in
  // today's snapshot, and snapshots are never revisited. Tomorrow's run retries.
  const projectData = await fetchJson(`https://fill.papermc.io/v3/projects/${fillSlug}`);
  const apiVersions = Object.values(projectData.versions || {}).flat();

  return buildChannelMap(apiVersions, wanted, async (version) => {
    const builds = await fetchJson(
      `https://fill.papermc.io/v3/projects/${fillSlug}/versions/${encodeURIComponent(version)}/builds`
    );
    // fill.papermc.io returns builds newest-first
    return Array.isArray(builds) && builds.length > 0 ? channelIsStable(builds[0].channel) : null;
  }, `fill/${fillSlug}`);
}

async function buildLeafChannelMap(wanted) {
  // Same as buildFillChannelMap: a dead channel API must fail the run, not silently
  // degrade to the regex heuristic.
  const projectData = await fetchJson('https://api.leafmc.one/v2/projects/leaf');
  const apiVersions = projectData.versions || [];

  return buildChannelMap(apiVersions, wanted, async (version) => {
    const data = await fetchJson(
      `https://api.leafmc.one/v2/projects/leaf/versions/${encodeURIComponent(version)}/builds`
    );
    const builds = data.builds || data;
    // leafmc.one returns builds oldest-first, unlike fill.papermc.io
    return Array.isArray(builds) && builds.length > 0
      ? channelIsStable(builds[builds.length - 1].channel)
      : null;
  }, 'leafmc');
}

function classifyVersion(rawVersion, channelMap) {
  const key = normalizeVersion(rawVersion);
  if (channelMap && channelMap.has(key)) {
    return channelMap.get(key);
  }
  return !isExperimentalByPattern(rawVersion);
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function collectProject(key, project) {
  console.log(`collecting ${project.name}...`);

  const [pieData, lineData] = await Promise.all([
    fetchBstatsPie(project.bstatsId, 'minecraft_version'),
    fetchBstatsLine(project.bstatsId, 'servers'),
  ]);

  const pieRows = mergePieRows(pieData);
  const wanted = new Set(pieRows.map((entry) => normalizeVersion(entry.name)));

  let channelMap = null;
  if (project.channelSource === 'fill') {
    channelMap = await buildFillChannelMap(project.fillSlug, wanted);
  } else if (project.channelSource === 'leafmc') {
    channelMap = await buildLeafChannelMap(wanted);
  }

  const versions = pieRows.map((entry) => ({
    version: entry.name,
    count: entry.y,
    stable: classifyVersion(entry.name, channelMap),
  }));

  const filePath = path.join(HISTORY_DIR, `${key}.json`);
  const existing = await readJsonIfExists(filePath, { servers: [], versions: {} });

  existing.servers = downsampleDaily(lineData);
  existing.versions[todayKey()] = versions;

  await writeFile(filePath, JSON.stringify(existing, null, 2));
  console.log(
    `  ${versions.length} versions (${channelMap ? channelMap.size : 0} from channel API), ` +
      `${existing.servers.length} daily history points`
  );
}

async function collectEcosystem() {
  console.log('collecting ecosystem breakdown...');
  const data = await fetchBstatsPie(GLOBAL_SOFTWARE_PLUGIN_ID, GLOBAL_SOFTWARE_CHART);
  const sorted = [...data].sort((a, b) => b.y - a.y);
  // The stat tiles read their headline counts from this file, so tracked projects
  // must stay listed by name even if they ever fall out of the top N.
  const trackedNames = new Set(Object.values(PROJECTS).map((p) => p.name));
  const top = sorted.slice(0, TOP_ECOSYSTEM_ENTRIES);
  const rest = sorted.slice(TOP_ECOSYSTEM_ENTRIES);
  const promoted = rest.filter((entry) => trackedNames.has(entry.name));
  const otherCount = rest
    .filter((entry) => !trackedNames.has(entry.name))
    .reduce((sum, entry) => sum + entry.y, 0);

  const entries = [...top, ...promoted].map((entry) => ({ name: entry.name, count: entry.y }));
  if (otherCount > 0) {
    entries.push({ name: 'Other', count: otherCount });
  }

  const filePath = path.join(DATA_DIR, 'ecosystem.json');
  const existing = await readJsonIfExists(filePath, {});
  existing[todayKey()] = entries;
  await writeFile(filePath, JSON.stringify(existing, null, 2));
  console.log(`  ${entries.length} entries (top ${TOP_ECOSYSTEM_ENTRIES} + other)`);
}

async function writeMeta() {
  const filePath = path.join(DATA_DIR, 'meta.json');
  await writeFile(
    filePath,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        projects: Object.keys(PROJECTS),
      },
      null,
      2
    )
  );
}

async function main() {
  await mkdir(HISTORY_DIR, { recursive: true });

  for (const [key, project] of Object.entries(PROJECTS)) {
    await collectProject(key, project);
  }

  await collectEcosystem();
  await writeMeta();

  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
