/**
 * Scenario metadata — shared across all dashboard pages.
 *
 * Each scenario belongs to a "family" for grouping in the UI.
 * The `interpret` field describes who should care about this metric.
 */

export const FAMILIES = {
  'reactive': { label: 'Reactive CRUD', icon: '⚡', color: '#0d6efd' },
  'methods': { label: 'Methods throughput', icon: '🔁', color: '#198754' },
  'fanout': { label: 'Reactive fanout', icon: '📡', color: '#6610f2' },
  'build': { label: 'Cold start / Build', icon: '🏗️', color: '#fd7e14' },
  'bundle': { label: 'Bundle size', icon: '📦', color: '#dc3545' },
  'transport': { label: 'Transport', icon: '🔌', color: '#20c997' },
};

export const SCENARIO_META = {
  'reactive-light': {
    family: 'reactive',
    label: 'Reactive CRUD (light)',
    short: '30 browser VUs, pub/sub + CRUD',
    interpret: 'Realtime-heavy apps (dashboards, collaborative tools)',
    fingerprint: 'reactive_propagation',
  },
  'reactive-crud': {
    family: 'reactive',
    label: 'Reactive CRUD (heavy)',
    short: '240 browser VUs, pub/sub + CRUD',
    interpret: 'Realtime-heavy apps at scale',
    fingerprint: 'reactive_propagation',
  },
  'non-reactive-crud': {
    family: 'methods',
    label: 'Methods CRUD',
    short: '240 browser VUs, no pub/sub',
    interpret: 'CRUD-heavy REST-style apps',
    fingerprint: 'methods_throughput',
  },
  'ddp-reactive-light': {
    family: 'reactive',
    label: 'DDP Reactive (light)',
    short: '150 DDP clients, subscribe + CRUD',
    interpret: 'Server-side DDP performance (realtime apps)',
    fingerprint: 'reactive_propagation',
  },
  'ddp-non-reactive-light': {
    family: 'methods',
    label: 'DDP Methods only',
    short: '150 DDP clients, methods only',
    interpret: 'Method-heavy apps, API backends',
    fingerprint: 'methods_throughput',
  },
  'fanout-light': {
    family: 'fanout',
    label: 'Fanout (50 subs)',
    short: '50 subscribers, 1 writer',
    interpret: 'Apps with many concurrent viewers (live feeds, notifications)',
    fingerprint: 'reactive_propagation',
  },
  'fanout-heavy': {
    family: 'fanout',
    label: 'Fanout (200 subs)',
    short: '200 subscribers, 1 writer',
    interpret: 'Apps with many concurrent viewers at scale',
    fingerprint: 'reactive_propagation',
  },
  'cold-start': {
    family: 'build',
    label: 'Cold start',
    short: 'meteor reset → app running',
    interpret: 'Developer experience, CI pipeline speed',
    fingerprint: 'cold_start',
  },
  'bundle-size': {
    family: 'bundle',
    label: 'Bundle size',
    short: 'Client + server output size',
    interpret: 'Initial load time, mobile users, CDN costs',
    fingerprint: 'bundle_weight',
  },
};

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
 * Returns: { familyKey: { ...familyMeta, scenarios: [name1, name2] } }
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
