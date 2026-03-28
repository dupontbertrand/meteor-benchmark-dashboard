/**
 * Scenario metadata — shared across all dashboard pages.
 *
 * Each scenario belongs to a "family" for grouping in the UI.
 * The `interpret` field describes who should care about this metric.
 * The `canonical` field marks the representative scenario per fingerprint axis.
 */

export const FAMILIES = {
  'reactive': { label: 'Reactive pub/sub', icon: '⚡', color: '#0d6efd' },
  'ddp': { label: 'DDP server', icon: '🔌', color: '#20c997' },
  'fanout': { label: 'Reactive fanout', icon: '📡', color: '#6610f2' },
  'build': { label: 'Cold start / Build', icon: '🏗️', color: '#fd7e14' },
  'bundle': { label: 'Bundle size', icon: '📦', color: '#dc3545' },
};

export const SCENARIO_META = {
  'reactive-light': {
    family: 'reactive',
    label: 'Browser reactive (light)',
    short: '30 browser VUs, pub/sub + CRUD',
    interpret: 'Realtime-heavy apps (dashboards, collaborative tools)',
  },
  'reactive-crud': {
    family: 'reactive',
    label: 'Browser reactive (heavy)',
    short: '240 browser VUs, pub/sub + CRUD',
    interpret: 'Realtime-heavy apps at scale',
  },
  'non-reactive-crud': {
    family: 'reactive',
    label: 'Browser methods only',
    short: '240 browser VUs, no pub/sub',
    interpret: 'CRUD-heavy REST-style apps',
  },
  'ddp-reactive-light': {
    family: 'ddp',
    label: 'DDP reactive',
    short: '150 DDP clients, subscribe + CRUD',
    interpret: 'Server-side DDP throughput (realtime apps)',
    canonical: 'ddp_throughput',
  },
  'ddp-non-reactive-light': {
    family: 'ddp',
    label: 'DDP methods only',
    short: '150 DDP clients, methods only',
    interpret: 'Method-heavy apps, API backends',
    canonical: 'methods_throughput',
  },
  'fanout-light': {
    family: 'fanout',
    label: 'Fanout (50 subs)',
    short: '50 subscribers, 1 writer',
    interpret: 'Apps with many concurrent viewers (live feeds, notifications)',
    canonical: 'reactive_fanout',
  },
  'fanout-heavy': {
    family: 'fanout',
    label: 'Fanout (200 subs)',
    short: '200 subscribers, 1 writer',
    interpret: 'Apps with many concurrent viewers at scale',
  },
  'cold-start': {
    family: 'build',
    label: 'Cold start',
    short: 'meteor reset → app running',
    interpret: 'Developer experience, CI pipeline speed',
    canonical: 'cold_start',
  },
  'bundle-size': {
    family: 'bundle',
    label: 'Bundle size',
    short: 'Client + server output size',
    interpret: 'Initial load time, mobile users, CDN costs',
    canonical: 'bundle_weight',
  },
};

/**
 * Canonical scenarios for the performance fingerprint.
 * Each axis picks ONE representative scenario to avoid misleading aggregation.
 */
export const FINGERPRINT_AXES = [
  { key: 'ddp_throughput', scenario: 'ddp-reactive-light', label: 'DDP throughput', metric: 'wall_clock', unit: 's', extract: r => r?.wall_clock_ms / 1000 },
  { key: 'reactive_fanout', scenario: 'fanout-light', label: 'Fanout', metric: 'gc', unit: ' ms', extract: r => r?.metrics?.gc?.total_pause_ms },
  { key: 'memory', scenario: 'ddp-reactive-light', label: 'Memory', metric: 'ram', unit: ' MB', extract: r => r?.metrics?.app_resources?.memory?.avg_mb },
  { key: 'gc_pressure', scenario: 'reactive-light', label: 'GC pressure', metric: 'gc', unit: ' ms', extract: r => r?.metrics?.gc?.total_pause_ms },
  { key: 'cold_start', scenario: 'cold-start', label: 'Cold start', metric: 'wall_clock', unit: 's', extract: r => r?.wall_clock_ms / 1000 },
];

/**
 * Get the family object for a scenario name.
 */
export function getFamily(scenarioName) {
  const meta = SCENARIO_META[scenarioName];
  if (!meta) return { label: 'Other', icon: '❓', color: '#6c757d' };
  return FAMILIES[meta.family] || { label: 'Other', icon: '❓', color: '#6c757d' };
}

/**
 * Group an array of scenarios by family.
 */
export function groupByFamily(scenarioNames) {
  const groups = {};
  for (const name of scenarioNames) {
    const meta = SCENARIO_META[name];
    const familyKey = meta?.family || 'other';
    if (!groups[familyKey]) {
      groups[familyKey] = {
        ...(FAMILIES[familyKey] || { label: 'Other', icon: '❓', color: '#6c757d' }),
        key: familyKey,
        scenarios: [],
      };
    }
    groups[familyKey].scenarios.push(name);
  }
  return groups;
}

/**
 * Compute deltas for all scenarios between two tags.
 * Returns array of { scenario, label, metric, delta, interpret, family }
 * sorted by absolute delta descending.
 */
export function computeAllDeltas(baselineRuns, targetRuns) {
  const deltas = [];
  const scenarios = [...new Set([...baselineRuns, ...targetRuns].map(r => r.scenario))];

  for (const scenario of scenarios) {
    const bRun = baselineRuns.filter(r => r.scenario === scenario).sort((a, b) => b.timestamp - a.timestamp)[0];
    const tRun = targetRuns.filter(r => r.scenario === scenario).sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!bRun || !tRun) continue;

    const meta = SCENARIO_META[scenario] || {};
    const family = FAMILIES[meta.family] || {};

    // GC total pause (most reliable metric)
    const bGc = bRun.metrics?.gc?.total_pause_ms;
    const tGc = tRun.metrics?.gc?.total_pause_ms;
    if (bGc && tGc && bGc > 0) {
      const d = ((tGc - bGc) / bGc) * 100;
      if (Math.abs(d) > 5) {
        deltas.push({
          scenario, label: meta.label || scenario, metric: 'GC pause',
          delta: d, interpret: meta.interpret || '', familyLabel: family.label || '',
          value: `${tGc.toFixed(0)} ms`, baseValue: `${bGc.toFixed(0)} ms`,
        });
      }
    }

    // CPU
    const bCpu = bRun.metrics?.app_resources?.cpu?.avg;
    const tCpu = tRun.metrics?.app_resources?.cpu?.avg;
    if (bCpu && tCpu && bCpu > 0) {
      const d = ((tCpu - bCpu) / bCpu) * 100;
      if (Math.abs(d) > 10) {
        deltas.push({
          scenario, label: meta.label || scenario, metric: 'CPU',
          delta: d, interpret: meta.interpret || '', familyLabel: family.label || '',
          value: `${tCpu.toFixed(1)}%`, baseValue: `${bCpu.toFixed(1)}%`,
        });
      }
    }

    // RAM
    const bRam = bRun.metrics?.app_resources?.memory?.avg_mb;
    const tRam = tRun.metrics?.app_resources?.memory?.avg_mb;
    if (bRam && tRam && bRam > 0) {
      const d = ((tRam - bRam) / bRam) * 100;
      if (Math.abs(d) > 10) {
        deltas.push({
          scenario, label: meta.label || scenario, metric: 'RAM',
          delta: d, interpret: meta.interpret || '', familyLabel: family.label || '',
          value: `${tRam.toFixed(0)} MB`, baseValue: `${bRam.toFixed(0)} MB`,
        });
      }
    }
  }

  return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
