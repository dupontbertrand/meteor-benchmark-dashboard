import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Meteor } from 'meteor/meteor';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Runs } from '../../api/runs';
import { SCENARIO_META, FAMILIES, FINGERPRINT_AXES, groupByFamily, computeAllDeltas } from '../lib/scenario-meta';
import './dashboard.html';

function syncToUrl(key, value) {
  const current = FlowRouter.getQueryParam(key);
  if (current !== value) FlowRouter.setQueryParams({ [key]: value || null });
}

Template.dashboard.onCreated(function () {
  this.subscribe('runs.recent', 200);
  this.tags = new ReactiveVar([]);
  this.baselineTag = new ReactiveVar(FlowRouter.getQueryParam('ref') || 'release-3.5');
  this.targetTag = new ReactiveVar(FlowRouter.getQueryParam('test') || 'devel');

  Meteor.callAsync('runs.distinctTags').then((tags) => {
    this.tags.set(tags);
    // Only auto-select if no query params
    if (!FlowRouter.getQueryParam('ref')) {
      const releases = tags.filter(t => /^release-3\.\d+$/.test(t));
      releases.sort((a, b) => parseFloat(b.replace('release-', '')) - parseFloat(a.replace('release-', '')));
      if (releases.length > 0) this.baselineTag.set(releases[0]);
    }
    if (!FlowRouter.getQueryParam('test') && tags.includes('devel')) {
      this.targetTag.set('devel');
    }
  });
});

// ─── Utility functions ──────────────────────────────────────────────

function fmt(val, unit, decimals = 1) {
  if (val == null) return '-';
  return `${val.toFixed(decimals)}${unit}`;
}

function pctDelta(baseline, target) {
  if (!baseline || !target || baseline === 0) return null;
  return ((target - baseline) / baseline) * 100;
}

function deltaStr(d) {
  if (d == null) return '';
  return `${d > 0 ? '+' : ''}${d.toFixed(1)}%`;
}

function verdictHtml(bRun, tRun) {
  if (!bRun || !tRun) return '<span class="text-muted">-</span>';

  const parts = [];
  const check = (label, bVal, tVal, threshold) => {
    if (!bVal || !tVal || bVal === 0) return;
    const d = pctDelta(bVal, tVal);
    if (d == null || Math.abs(d) < threshold) return;
    const cls = d > 20 ? 'text-danger fw-bold' : d > 0 ? 'text-danger' : 'text-success';
    parts.push(`<span class="${cls}">${label} ${deltaStr(d)}</span>`);
  };

  check('GC', bRun.metrics?.gc?.total_pause_ms, tRun.metrics?.gc?.total_pause_ms, 5);
  check('CPU', bRun.metrics?.app_resources?.cpu?.avg, tRun.metrics?.app_resources?.cpu?.avg, 10);
  check('RAM', bRun.metrics?.app_resources?.memory?.avg_mb, tRun.metrics?.app_resources?.memory?.avg_mb, 10);

  // Fallback to wall clock for scenarios without app metrics (cold-start, bundle-size, hot-reload)
  if (parts.length === 0 && bRun.wall_clock_ms && tRun.wall_clock_ms) {
    check('Time', bRun.wall_clock_ms, tRun.wall_clock_ms, 5);
  }

  if (parts.length === 0) return '<span class="badge bg-success">OK</span>';
  return `<div style="font-size: 0.8rem; line-height: 1.4">${parts.join('<br>')}</div>`;
}

function getBaselineAndTarget(instance) {
  const baseline = instance.baselineTag.get();
  const target = instance.targetTag.get();
  const bRuns = Runs.find({ tag: baseline }).fetch();
  const tRuns = Runs.find({ tag: target }).fetch();
  return { baseline, target, bRuns, tRuns };
}

// ─── Template helpers ───────────────────────────────────────────────

Template.dashboard.helpers({
  tags() { return Template.instance().tags.get(); },
  baselineTag() { return Template.instance().baselineTag.get(); },
  targetTag() { return Template.instance().targetTag.get(); },
  isBaseline(tag) { return tag === Template.instance().baselineTag.get() ? 'selected' : null; },
  isTarget(tag) { return tag === Template.instance().targetTag.get() ? 'selected' : null; },

  // ─── Section 1: Release diagnosis ─────────────────────────────
  diagnosis() {
    const { bRuns, tRuns, baseline, target } = getBaselineAndTarget(Template.instance());
    if (!bRuns.length || !tRuns.length) return null;

    const deltas = computeAllDeltas(bRuns, tRuns);
    const regressions = deltas.filter(d => d.delta > 0);
    const improvements = deltas.filter(d => d.delta < 0);

    const worstRegression = regressions[0];
    const bestImprovement = improvements[0];

    // Determine verdict
    let verdict, badgeClass, borderClass, summary;
    const hasHardFail = regressions.some(d => d.delta > 25);
    const hasWarning = regressions.some(d => d.delta > 10);

    if (hasHardFail) {
      verdict = 'Regression risk';
      badgeClass = 'danger';
      borderClass = 'danger';
      const areas = [...new Set(regressions.filter(d => d.delta > 25).map(d => d.familyLabel))].join(', ');
      summary = `${target} has significant regressions vs ${baseline} in: ${areas}`;
    } else if (hasWarning) {
      verdict = 'Watch';
      badgeClass = 'warning';
      borderClass = 'warning';
      summary = `${target} has minor regressions vs ${baseline} — monitor before release`;
    } else if (improvements.length > 0) {
      verdict = 'Healthy';
      badgeClass = 'success';
      borderClass = 'success';
      summary = `${target} improves over ${baseline}`;
    } else {
      verdict = 'Healthy';
      badgeClass = 'success';
      borderClass = 'success';
      summary = `${target} is on par with ${baseline}`;
    }

    const fmtDelta = (d) => d ? { ...d, deltaStr: deltaStr(d.delta) } : null;

    return {
      verdict, badgeClass, borderClass, summary,
      hasHighlights: !!(worstRegression || bestImprovement),
      topRegression: fmtDelta(worstRegression),
      topImprovement: fmtDelta(bestImprovement),
    };
  },

  // ─── Section 2: Canonical fingerprint ─────────────────────────
  hasFingerprint() {
    const { bRuns, tRuns } = getBaselineAndTarget(Template.instance());
    return bRuns.length > 0 && tRuns.length > 0;
  },

  fingerprint() {
    const { baseline, target, bRuns, tRuns } = getBaselineAndTarget(Template.instance());

    return FINGERPRINT_AXES.map(axis => {
      const bRun = bRuns.filter(r => r.scenario === axis.scenario).sort((a, b) => b.timestamp - a.timestamp)[0];
      const tRun = tRuns.filter(r => r.scenario === axis.scenario).sort((a, b) => b.timestamp - a.timestamp)[0];
      const bVal = axis.extract(bRun);
      const tVal = axis.extract(tRun);
      if (tVal == null) return null;

      const d = pctDelta(bVal, tVal);
      return {
        label: axis.label,
        value: fmt(tVal, axis.unit, axis.unit === ' MB' ? 0 : 1),
        delta: d != null ? deltaStr(d) : '',
        deltaClass: d == null ? '' : Math.abs(d) < 5 ? 'text-muted' : d > 0 ? 'text-danger' : 'text-success',
        source: (SCENARIO_META[axis.scenario]?.label || axis.scenario),
      };
    }).filter(Boolean);
  },

  // ─── Section 3: Top changes ───────────────────────────────────
  hasChanges() {
    const { bRuns, tRuns } = getBaselineAndTarget(Template.instance());
    return bRuns.length > 0 && tRuns.length > 0;
  },

  improvements() {
    const { bRuns, tRuns } = getBaselineAndTarget(Template.instance());
    return computeAllDeltas(bRuns, tRuns)
      .filter(d => d.delta < 0)
      .slice(0, 5)
      .map(d => ({ ...d, deltaStr: deltaStr(d.delta) }));
  },

  regressions() {
    const { bRuns, tRuns } = getBaselineAndTarget(Template.instance());
    return computeAllDeltas(bRuns, tRuns)
      .filter(d => d.delta > 0)
      .slice(0, 5)
      .map(d => ({ ...d, deltaStr: deltaStr(d.delta) }));
  },

  // ─── Section 4: Family tables ─────────────────────────────────
  families() {
    const { baseline, target } = getBaselineAndTarget(Template.instance());
    const allRuns = Runs.find({ tag: { $in: [baseline, target] } }).fetch();
    const scenarioNames = [...new Set(allRuns.map(r => r.scenario))];
    const groups = groupByFamily(scenarioNames);

    return Object.values(groups).map(family => {
      const rows = family.scenarios.map(scenario => {
        const meta = SCENARIO_META[scenario] || {};
        const bRun = Runs.findOne({ tag: baseline, scenario }, { sort: { timestamp: -1 } });
        const tRun = Runs.findOne({ tag: target, scenario }, { sort: { timestamp: -1 } });
        const run = tRun || bRun;
        if (!run) return null;

        const targetRuns = Runs.find({ tag: target, scenario }).fetch();
        const lastRun = targetRuns.sort((a, b) => b.timestamp - a.timestamp)[0];

        return {
          scenario,
          scenarioLabel: meta.label || scenario,
          interpret: meta.interpret || '',
          wallClock: fmt(run.wall_clock_ms / 1000, 's'),
          cpu: fmt(run.metrics?.app_resources?.cpu?.avg, '%'),
          ram: fmt(run.metrics?.app_resources?.memory?.avg_mb, ' MB', 0),
          gc: fmt(run.metrics?.gc?.total_pause_ms, ' ms', 0),
          verdict: verdictHtml(bRun, tRun),
          runCount: targetRuns.length,
          lastRunDate: lastRun ? new Date(lastRun.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '',
        };
      }).filter(Boolean);

      return { ...family, scenarioCount: family.scenarios.length, isSingle: family.scenarios.length === 1, rows };
    });
  },

  // ─── Recent runs (collapsed) ──────────────────────────────────
  recentRuns() { return Runs.find({}, { sort: { timestamp: -1 }, limit: 50 }); },
  totalRunCount() { return Runs.find().count(); },
  formatDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  formatMs(ms) { return ms ? `${(ms / 1000).toFixed(1)}s` : '-'; },
  cpuAvg() { return this.metrics?.app_resources?.cpu?.avg?.toFixed(1) || '-'; },
  ramAvg() { return this.metrics?.app_resources?.memory?.avg_mb?.toFixed(0) || '-'; },
  gcPause() { return this.metrics?.gc?.total_pause_ms?.toFixed(0) || '-'; },
});

Template.dashboard.events({
  'change #healthBaseline'(e, i) { i.baselineTag.set(e.target.value); syncToUrl('ref', e.target.value); },
  'change #healthTarget'(e, i) { i.targetTag.set(e.target.value); syncToUrl('test', e.target.value); },
  'click #swapTags'(e, i) {
    const a = i.baselineTag.get();
    const b = i.targetTag.get();
    i.baselineTag.set(b);
    i.targetTag.set(a);
    syncToUrl('ref', b);
    syncToUrl('test', a);
  },
});
