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

/**
 * Auto-detect the latest stable release tag to compare against.
 * Picks the highest release-X.Y tag that isn't the selected branch.
 */
function detectReference(tags, selectedBranch) {
  const releases = tags
    .filter(t => /^release-\d+\.\d+$/.test(t) && t !== selectedBranch)
    .sort((a, b) => {
      const av = parseFloat(a.replace('release-', ''));
      const bv = parseFloat(b.replace('release-', ''));
      return bv - av;
    });
  return releases[0] || null;
}

/**
 * Compute stability: compare last run vs median of previous runs for a scenario+tag.
 * Returns { stable, trend, label }
 */
function computeStability(runs) {
  if (runs.length < 3) return { label: `${runs.length} runs`, badge: '<span class="text-muted" style="font-size:0.75rem">not enough data</span>' };

  const sorted = [...runs].sort((a, b) => a.timestamp - b.timestamp);
  const latest = sorted[sorted.length - 1];
  const previous = sorted.slice(0, -1);

  // Use GC if available, fallback to wall clock
  const getVal = (r) => r.metrics?.gc?.total_pause_ms ?? r.wall_clock_ms;
  const latestVal = getVal(latest);
  const prevVals = previous.map(getVal).filter(v => v != null);
  if (!prevVals.length || latestVal == null) return { label: '-', badge: '<span class="text-muted">-</span>' };

  const prevMedian = prevVals.sort((a, b) => a - b)[Math.floor(prevVals.length / 2)];
  const delta = pctDelta(prevMedian, latestVal);
  if (delta == null) return { label: '-', badge: '<span class="text-muted">-</span>' };

  if (Math.abs(delta) < 10) return { label: 'stable', badge: '<span class="badge bg-success">stable</span>' };
  if (delta > 25) return { label: `${deltaStr(delta)}`, badge: `<span class="badge bg-danger">${deltaStr(delta)}</span>` };
  if (delta > 0) return { label: `${deltaStr(delta)}`, badge: `<span class="badge bg-warning text-dark">${deltaStr(delta)}</span>` };
  return { label: `${deltaStr(delta)}`, badge: `<span class="badge bg-success">${deltaStr(delta)}</span>` };
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

  if (parts.length === 0 && bRun.wall_clock_ms && tRun.wall_clock_ms) {
    check('Time', bRun.wall_clock_ms, tRun.wall_clock_ms, 5);
  }

  if (parts.length === 0) return '<span class="badge bg-success">OK</span>';
  return `<div style="font-size: 0.8rem; line-height: 1.4">${parts.join('<br>')}</div>`;
}

// ─── Template ───────────────────────────────────────────────────────

Template.dashboard.onCreated(function () {
  this.subscribe('runs.recent', 200);
  this.tags = new ReactiveVar([]);
  this.selectedBranch = new ReactiveVar(FlowRouter.getQueryParam('branch') || 'devel');
  this.referenceTag = new ReactiveVar('');

  Meteor.callAsync('runs.distinctTags').then((tags) => {
    this.tags.set(tags);
    const branch = this.selectedBranch.get();
    if (!tags.includes(branch) && tags.length > 0) {
      this.selectedBranch.set(tags[0]);
    }
    this.referenceTag.set(detectReference(tags, this.selectedBranch.get()));
  });

  // Update reference when branch changes
  this.autorun(() => {
    const branch = this.selectedBranch.get();
    const tags = this.tags.get();
    if (tags.length > 0) {
      this.referenceTag.set(detectReference(tags, branch));
    }
  });
});

// ─── Helpers ────────────────────────────────────────────────────────

Template.dashboard.helpers({
  tags() { return Template.instance().tags.get(); },
  selectedBranch() { return Template.instance().selectedBranch.get(); },
  referenceTag() { return Template.instance().referenceTag.get(); },

  isSelectedBranch(tag) {
    return tag === Template.instance().selectedBranch.get() ? 'selected' : null;
  },

  // ─── Verdict ────────────────────────────────────────────────
  diagnosis() {
    const t = Template.instance();
    const branch = t.selectedBranch.get();
    const ref = t.referenceTag.get();
    const branchRuns = Runs.find({ tag: branch }).fetch();
    const refRuns = ref ? Runs.find({ tag: ref }).fetch() : [];

    if (!branchRuns.length) {
      return { verdict: 'No data', badgeClass: 'secondary', borderClass: 'secondary', summary: `No benchmark runs found for ${branch}` };
    }

    // vs reference
    let vsRefVerdict = 'ok';
    let vsRefSummary = '';
    if (refRuns.length > 0) {
      const deltas = computeAllDeltas(refRuns, branchRuns);
      const regressions = deltas.filter(d => d.delta > 0);
      const hasHardFail = regressions.some(d => d.delta > 25);
      const hasWarning = regressions.some(d => d.delta > 10);

      if (hasHardFail) {
        vsRefVerdict = 'fail';
        const areas = [...new Set(regressions.filter(d => d.delta > 25).map(d => d.familyLabel))].join(', ');
        vsRefSummary = `Regressions vs ${ref} in: ${areas}`;
      } else if (hasWarning) {
        vsRefVerdict = 'warn';
        vsRefSummary = `Minor regressions vs ${ref} — monitor before release`;
      } else {
        vsRefSummary = `No regressions vs ${ref}`;
      }
    } else {
      vsRefSummary = 'No reference data to compare against';
    }

    // Stability over time
    const scenarios = [...new Set(branchRuns.map(r => r.scenario))];
    const unstable = [];
    for (const scenario of scenarios) {
      const scenarioRuns = branchRuns.filter(r => r.scenario === scenario).sort((a, b) => a.timestamp - b.timestamp);
      if (scenarioRuns.length < 3) continue;
      const stab = computeStability(scenarioRuns);
      if (stab.label !== 'stable' && stab.label !== '-' && !stab.label.includes('runs')) {
        unstable.push(scenario);
      }
    }

    let stabilitySummary = '';
    if (scenarios.length >= 3 && unstable.length === 0) {
      stabilitySummary = 'Metrics are stable over recent runs';
    } else if (unstable.length > 0) {
      stabilitySummary = `Unstable: ${unstable.map(s => SCENARIO_META[s]?.label || s).join(', ')}`;
    }

    // Combined verdict
    let verdict, badgeClass, borderClass;
    if (vsRefVerdict === 'fail') {
      verdict = 'Regression risk'; badgeClass = 'danger'; borderClass = 'danger';
    } else if (vsRefVerdict === 'warn' || unstable.length > 0) {
      verdict = 'Watch'; badgeClass = 'warning'; borderClass = 'warning';
    } else {
      verdict = 'Healthy'; badgeClass = 'success'; borderClass = 'success';
    }

    return { verdict, badgeClass, borderClass, summary: vsRefSummary, stabilitySummary };
  },

  // ─── Fingerprint ────────────────────────────────────────────
  hasFingerprint() {
    const branch = Template.instance().selectedBranch.get();
    return Runs.find({ tag: branch }).count() > 0;
  },

  fingerprint() {
    const t = Template.instance();
    const branch = t.selectedBranch.get();
    const ref = t.referenceTag.get();
    const branchRuns = Runs.find({ tag: branch }).fetch();
    const refRuns = ref ? Runs.find({ tag: ref }).fetch() : [];

    return FINGERPRINT_AXES.map(axis => {
      const tRun = branchRuns.filter(r => r.scenario === axis.scenario).sort((a, b) => b.timestamp - a.timestamp)[0];
      const bRun = refRuns.filter(r => r.scenario === axis.scenario).sort((a, b) => b.timestamp - a.timestamp)[0];
      const tVal = axis.extract(tRun);
      if (tVal == null) return null;

      const bVal = axis.extract(bRun);
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

  // ─── Top changes ────────────────────────────────────────────
  hasChanges() {
    const t = Template.instance();
    const ref = t.referenceTag.get();
    if (!ref) return false;
    const branch = t.selectedBranch.get();
    return Runs.find({ tag: branch }).count() > 0 && Runs.find({ tag: ref }).count() > 0;
  },

  improvements() {
    const t = Template.instance();
    const refRuns = Runs.find({ tag: t.referenceTag.get() }).fetch();
    const branchRuns = Runs.find({ tag: t.selectedBranch.get() }).fetch();
    return computeAllDeltas(refRuns, branchRuns)
      .filter(d => d.delta < 0).slice(0, 5)
      .map(d => ({ ...d, deltaStr: deltaStr(d.delta) }));
  },

  regressions() {
    const t = Template.instance();
    const refRuns = Runs.find({ tag: t.referenceTag.get() }).fetch();
    const branchRuns = Runs.find({ tag: t.selectedBranch.get() }).fetch();
    return computeAllDeltas(refRuns, branchRuns)
      .filter(d => d.delta > 0).slice(0, 5)
      .map(d => ({ ...d, deltaStr: deltaStr(d.delta) }));
  },

  // ─── Family tables ──────────────────────────────────────────
  families() {
    const t = Template.instance();
    const branch = t.selectedBranch.get();
    const ref = t.referenceTag.get();

    const branchRuns = Runs.find({ tag: branch }).fetch();
    const scenarioNames = [...new Set(branchRuns.map(r => r.scenario))];
    if (scenarioNames.length === 0) return [];

    const groups = groupByFamily(scenarioNames);

    return Object.values(groups).map(family => {
      const rows = family.scenarios.map(scenario => {
        const meta = SCENARIO_META[scenario] || {};
        const scenarioRuns = branchRuns.filter(r => r.scenario === scenario).sort((a, b) => b.timestamp - a.timestamp);
        const run = scenarioRuns[0];
        if (!run) return null;

        const bRun = ref ? Runs.findOne({ tag: ref, scenario }, { sort: { timestamp: -1 } }) : null;
        const stab = computeStability(scenarioRuns);

        return {
          scenario,
          scenarioLabel: meta.label || scenario,
          interpret: meta.interpret || '',
          wallClock: fmt(run.wall_clock_ms / 1000, 's'),
          cpu: fmt(run.metrics?.app_resources?.cpu?.avg, '%'),
          ram: fmt(run.metrics?.app_resources?.memory?.avg_mb, ' MB', 0),
          gc: fmt(run.metrics?.gc?.total_pause_ms, ' ms', 0),
          verdict: verdictHtml(bRun, run),
          stability: stab.badge,
          runCount: scenarioRuns.length,
          lastRunDate: new Date(run.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        };
      }).filter(Boolean);

      return { ...family, scenarioCount: family.scenarios.length, isSingle: family.scenarios.length === 1, rows };
    });
  },

  // ─── Recent runs ────────────────────────────────────────────
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

// ─── Events ─────────────────────────────────────────────────────────

Template.dashboard.events({
  'change #branchSelect'(e, i) {
    i.selectedBranch.set(e.target.value);
    syncToUrl('branch', e.target.value);
  },
});
