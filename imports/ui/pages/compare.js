import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Meteor } from 'meteor/meteor';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Runs } from '../../api/runs';
import { SCENARIO_META, FAMILIES } from '../lib/scenario-meta';
import './compare.html';

function syncToUrl(key, value) {
  const current = FlowRouter.getQueryParam(key);
  if (current !== value) FlowRouter.setQueryParams({ [key]: value || null });
}

const TOOLTIPS = {
  'Wall clock': 'Total benchmark duration. Sensitive to runner load — use for relative comparisons only.',
  'APP CPU avg': 'Average CPU usage of the Meteor Node.js process. Values above 100% mean multi-core usage.',
  'APP RAM avg': 'Average resident memory (RSS) of the Meteor process.',
  'DB CPU avg': 'Average CPU usage of the MongoDB process.',
  'DB RAM avg': 'Average resident memory of the MongoDB process.',
  'GC total pause': 'Total time V8 spent on garbage collection. Most reliable metric on shared runners.',
  'GC max pause': 'Longest single GC freeze. Above 50ms = noticeable latency spike.',
  'GC count': 'Number of GC events (minor + major).',
  'GC major': 'Time spent in full heap (mark-sweep-compact) collections.',
};

function makeRow(label, baseVal, targetVal, unit) {
  if (baseVal == null || targetVal == null || baseVal === 0) return null;
  const delta = ((targetVal - baseVal) / baseVal) * 100;
  const isWorse = delta > 0;
  const ratio = targetVal / baseVal;
  let relativeStr = '';
  if (Math.abs(ratio - 1) > 0.05) {
    relativeStr = ratio < 1 ? `${(1 / ratio).toFixed(2)}x faster` : `${ratio.toFixed(2)}x slower`;
  }
  return {
    label,
    tooltip: TOOLTIPS[label] || '',
    baselineVal: `${baseVal.toFixed?.(1) ?? baseVal}${unit}`,
    targetVal: `${targetVal.toFixed?.(1) ?? targetVal}${unit}`,
    deltaStr: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`,
    relativeStr,
    deltaClass: Math.abs(delta) < 5 ? '' : isWorse ? 'text-danger fw-bold' : 'text-success fw-bold',
    statusIcon: Math.abs(delta) < 5
      ? '<span class="badge bg-secondary">~</span>'
      : isWorse
        ? (delta > 25 ? '<span class="badge bg-danger">FAIL</span>' : '<span class="badge bg-warning text-dark">WARN</span>')
        : '<span class="badge bg-success">OK</span>',
    delta,
  };
}

function bestRun(tag, scenario) {
  return Runs.findOne({ tag, scenario }, { sort: { timestamp: -1 } });
}

// ─── Template ───────────────────────────────────────────────────────

Template.compare.onCreated(function () {
  this.tags = new ReactiveVar([]);
  this.scenarios = new ReactiveVar([]);
  this.selectedTagA = new ReactiveVar(FlowRouter.getQueryParam('a') || '');
  this.selectedTagB = new ReactiveVar(FlowRouter.getQueryParam('b') || '');
  this.selectedScenario = new ReactiveVar(FlowRouter.getQueryParam('scenario') || '');

  Meteor.callAsync('runs.distinctTags').then((tags) => this.tags.set(tags));
  Meteor.callAsync('runs.distinctScenarios').then((s) => this.scenarios.set(s));

  this.autorun(() => {
    const tagA = this.selectedTagA.get();
    const tagB = this.selectedTagB.get();
    const scenario = this.selectedScenario.get();
    if (tagA && tagB) {
      this.subscribe('runs.forCompare', tagA, tagB, scenario || undefined);
    }
  });
});

// ─── Helpers ────────────────────────────────────────────────────────

Template.compare.helpers({
  tags() { return Template.instance().tags.get(); },
  scenarios() { return Template.instance().scenarios.get(); },
  selectedTagA() { return Template.instance().selectedTagA.get(); },
  selectedTagB() { return Template.instance().selectedTagB.get(); },
  tagA() { return Template.instance().selectedTagA.get(); },
  tagB() { return Template.instance().selectedTagB.get(); },

  isSelected(value, field) {
    const t = Template.instance();
    const map = { a: t.selectedTagA, b: t.selectedTagB, scenario: t.selectedScenario };
    return map[field]?.get() === value ? 'selected' : null;
  },

  showComparison() {
    const t = Template.instance();
    return t.selectedTagA.get() && t.selectedTagB.get();
  },

  isAllScenarios() {
    return !Template.instance().selectedScenario.get();
  },

  // ── All scenarios mode ──

  scenarioGroups() {
    const t = Template.instance();
    const tagA = t.selectedTagA.get();
    const tagB = t.selectedTagB.get();
    if (!tagA || !tagB) return [];

    // Find all scenarios that have data for both tags
    const allRuns = Runs.find({ tag: { $in: [tagA, tagB] } }).fetch();
    const byScenario = {};
    for (const run of allRuns) {
      if (!byScenario[run.scenario]) byScenario[run.scenario] = {};
      // Keep most recent per tag
      if (!byScenario[run.scenario][run.tag] || run.timestamp > byScenario[run.scenario][run.tag].timestamp) {
        byScenario[run.scenario][run.tag] = run;
      }
    }

    // Build rows grouped by family
    const groups = {};
    for (const [scenario, runs] of Object.entries(byScenario)) {
      const b = runs[tagA];
      const tgt = runs[tagB];
      if (!b || !tgt) continue;

      const meta = SCENARIO_META[scenario] || {};
      const familyKey = meta.family || 'other';
      const family = FAMILIES[familyKey] || { label: 'Other', icon: '' };

      if (!groups[familyKey]) {
        groups[familyKey] = { familyLabel: `${family.icon} ${family.label}`, rows: [] };
      }

      // GC-based status (most reliable)
      const bGc = b.metrics?.gc?.total_pause_ms;
      const tGc = tgt.metrics?.gc?.total_pause_ms;
      let statusBadge = '<span class="badge bg-secondary">—</span>';
      if (bGc != null && tGc != null && bGc > 0) {
        const delta = ((tGc - bGc) / bGc) * 100;
        if (Math.abs(delta) < 5) statusBadge = '<span class="badge bg-secondary">~</span>';
        else if (delta > 25) statusBadge = `<span class="badge bg-danger">${delta > 0 ? '+' : ''}${delta.toFixed(0)}%</span>`;
        else if (delta > 0) statusBadge = `<span class="badge bg-warning text-dark">+${delta.toFixed(0)}%</span>`;
        else statusBadge = `<span class="badge bg-success">${delta.toFixed(0)}%</span>`;
      }

      const fmt = (v, u) => v != null ? `${v.toFixed(1)}${u}` : '—';

      groups[familyKey].rows.push({
        scenario,
        label: meta.label || scenario,
        wallClock: `${fmt(b.wall_clock_ms / 1000, 's')} → ${fmt(tgt.wall_clock_ms / 1000, 's')}`,
        cpuAvg: `${fmt(b.metrics?.app_resources?.cpu?.avg, '%')} → ${fmt(tgt.metrics?.app_resources?.cpu?.avg, '%')}`,
        ramAvg: `${fmt(b.metrics?.app_resources?.memory?.avg_mb, ' MB')} → ${fmt(tgt.metrics?.app_resources?.memory?.avg_mb, ' MB')}`,
        gcPause: `${fmt(bGc, ' ms')} → ${fmt(tGc, ' ms')}`,
        statusBadge,
      });
    }

    return Object.values(groups);
  },

  // ── Single scenario mode ──

  hasData() {
    const t = Template.instance();
    const tagA = t.selectedTagA.get();
    const scenario = t.selectedScenario.get();
    return tagA && scenario && Runs.findOne({ tag: tagA, scenario });
  },

  comparisonRows() {
    const t = Template.instance();
    const tagA = t.selectedTagA.get();
    const tagB = t.selectedTagB.get();
    const scenario = t.selectedScenario.get();
    if (!scenario) return [];

    const baseline = bestRun(tagA, scenario);
    const target = bestRun(tagB, scenario);
    if (!baseline || !target) return [];

    const rows = [];
    const add = (label, bv, tv, unit) => {
      const r = makeRow(label, bv, tv, unit);
      if (r) rows.push(r);
    };

    add('Wall clock', baseline.wall_clock_ms / 1000, target.wall_clock_ms / 1000, 's');

    const bApp = baseline.metrics?.app_resources;
    const tApp = target.metrics?.app_resources;
    if (bApp && tApp) {
      add('APP CPU avg', bApp.cpu?.avg, tApp.cpu?.avg, '%');
      add('APP RAM avg', bApp.memory?.avg_mb, tApp.memory?.avg_mb, ' MB');
    }

    const bDb = baseline.metrics?.db_resources;
    const tDb = target.metrics?.db_resources;
    if (bDb && tDb) {
      add('DB CPU avg', bDb.cpu?.avg, tDb.cpu?.avg, '%');
      add('DB RAM avg', bDb.memory?.avg_mb, tDb.memory?.avg_mb, ' MB');
    }

    const bGc = baseline.metrics?.gc;
    const tGc = target.metrics?.gc;
    if (bGc && tGc) {
      add('GC total pause', bGc.total_pause_ms, tGc.total_pause_ms, ' ms');
      add('GC max pause', bGc.max_pause_ms, tGc.max_pause_ms, ' ms');
      add('GC count', bGc.count, tGc.count, '');
      add('GC major', bGc.major?.total_ms, tGc.major?.total_ms, ' ms');
    }

    return rows;
  },
});

// ─── Events ─────────────────────────────────────────────────────────

Template.compare.events({
  'change #tagA'(e, i) { i.selectedTagA.set(e.target.value); syncToUrl('a', e.target.value); },
  'change #tagB'(e, i) { i.selectedTagB.set(e.target.value); syncToUrl('b', e.target.value); },
  'change #scenarioFilter'(e, i) { i.selectedScenario.set(e.target.value); syncToUrl('scenario', e.target.value); },
  'click #swapCompare'(e, i) {
    const a = i.selectedTagA.get();
    const b = i.selectedTagB.get();
    i.selectedTagA.set(b);
    i.selectedTagB.set(a);
    syncToUrl('a', b);
    syncToUrl('b', a);
  },
});
