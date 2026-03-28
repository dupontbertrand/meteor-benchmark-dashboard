import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Meteor } from 'meteor/meteor';
import { Runs } from '../../api/runs';
import { SCENARIO_META, FAMILIES, groupByFamily } from '../lib/scenario-meta';
import './dashboard.html';

Template.dashboard.onCreated(function () {
  this.subscribe('runs.recent', 200);
  this.tags = new ReactiveVar([]);
  this.baselineTag = new ReactiveVar('release-3.5');
  this.targetTag = new ReactiveVar('devel');

  Meteor.callAsync('runs.distinctTags').then((tags) => {
    this.tags.set(tags);
    // Auto-select: latest release as baseline, devel as target
    const releases = tags.filter(t => t.startsWith('release-'));
    if (releases.length > 0) this.baselineTag.set(releases[0]);
    if (tags.includes('devel')) this.targetTag.set('devel');
  });
});

// ─── Helpers ────────────────────────────────────────────────────────

function fmt(val, unit, decimals = 1) {
  if (val == null) return '-';
  return `${val.toFixed(decimals)}${unit}`;
}

function delta(baseline, target) {
  if (!baseline || !target || baseline === 0) return null;
  return ((target - baseline) / baseline) * 100;
}

function deltaStr(d) {
  if (d == null) return '';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

function ratioStr(baseline, target) {
  if (!baseline || !target || baseline === 0) return '';
  const ratio = target / baseline;
  if (ratio < 1) return `${(1 / ratio).toFixed(2)}x faster`;
  if (ratio > 1) return `${ratio.toFixed(2)}x slower`;
  return 'same';
}

function verdictHtml(baselineRun, targetRun) {
  if (!baselineRun || !targetRun) return '<span class="text-muted">-</span>';

  // Pick the most meaningful metric: GC total pause (most reliable on shared runners)
  const bGc = baselineRun.metrics?.gc?.total_pause_ms;
  const tGc = targetRun.metrics?.gc?.total_pause_ms;
  const bCpu = baselineRun.metrics?.app_resources?.cpu?.avg;
  const tCpu = targetRun.metrics?.app_resources?.cpu?.avg;
  const bWc = baselineRun.wall_clock_ms;
  const tWc = targetRun.wall_clock_ms;

  const parts = [];

  // Wall clock ratio
  if (bWc && tWc) {
    const r = tWc / bWc;
    if (Math.abs(r - 1) > 0.05) {
      const cls = r > 1.1 ? 'text-danger' : r < 0.9 ? 'text-success' : '';
      parts.push(`<span class="${cls}">${ratioStr(bWc, tWc)}</span>`);
    }
  }

  // GC delta
  if (bGc && tGc) {
    const d = delta(bGc, tGc);
    if (d != null && Math.abs(d) > 5) {
      const cls = d > 20 ? 'text-danger fw-bold' : d > 0 ? 'text-danger' : 'text-success';
      parts.push(`<span class="${cls}">GC ${deltaStr(d)}</span>`);
    }
  }

  // CPU delta
  if (bCpu && tCpu) {
    const d = delta(bCpu, tCpu);
    if (d != null && Math.abs(d) > 10) {
      const cls = d > 25 ? 'text-danger fw-bold' : d > 0 ? 'text-danger' : 'text-success';
      parts.push(`<span class="${cls}">CPU ${deltaStr(d)}</span>`);
    }
  }

  if (parts.length === 0) {
    return '<span class="badge bg-success">OK</span>';
  }
  return `<div style="font-size: 0.8rem; line-height: 1.4">${parts.join('<br>')}</div>`;
}

// ─── Template helpers ───────────────────────────────────────────────

Template.dashboard.helpers({
  tags() { return Template.instance().tags.get(); },
  baselineTag() { return Template.instance().baselineTag.get(); },
  targetTag() { return Template.instance().targetTag.get(); },
  isBaseline(tag) { return tag === Template.instance().baselineTag.get(); },
  isTarget(tag) { return tag === Template.instance().targetTag.get(); },

  hasFingerprint() {
    const t = Template.instance();
    const baseline = t.baselineTag.get();
    const target = t.targetTag.get();
    return baseline && target && Runs.find({ tag: { $in: [baseline, target] } }).count() > 0;
  },

  fingerprint() {
    const t = Template.instance();
    const baseline = t.baselineTag.get();
    const target = t.targetTag.get();

    // Aggregate across all scenarios for this tag
    const bRuns = Runs.find({ tag: baseline }).fetch();
    const tRuns = Runs.find({ tag: target }).fetch();
    if (!bRuns.length || !tRuns.length) return [];

    const avg = (runs, extractor) => {
      const vals = runs.map(extractor).filter(v => v != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const axes = [
      {
        label: 'Wall Clock',
        bVal: avg(bRuns, r => r.wall_clock_ms / 1000),
        tVal: avg(tRuns, r => r.wall_clock_ms / 1000),
        unit: 's',
      },
      {
        label: 'CPU',
        bVal: avg(bRuns, r => r.metrics?.app_resources?.cpu?.avg),
        tVal: avg(tRuns, r => r.metrics?.app_resources?.cpu?.avg),
        unit: '%',
      },
      {
        label: 'RAM',
        bVal: avg(bRuns, r => r.metrics?.app_resources?.memory?.avg_mb),
        tVal: avg(tRuns, r => r.metrics?.app_resources?.memory?.avg_mb),
        unit: ' MB',
      },
      {
        label: 'GC Pause',
        bVal: avg(bRuns, r => r.metrics?.gc?.total_pause_ms),
        tVal: avg(tRuns, r => r.metrics?.gc?.total_pause_ms),
        unit: ' ms',
      },
      {
        label: 'GC Max',
        bVal: avg(bRuns, r => r.metrics?.gc?.max_pause_ms),
        tVal: avg(tRuns, r => r.metrics?.gc?.max_pause_ms),
        unit: ' ms',
      },
    ];

    return axes.filter(a => a.tVal != null).map(a => {
      const d = delta(a.bVal, a.tVal);
      return {
        label: a.label,
        value: fmt(a.tVal, a.unit, a.unit === ' MB' ? 0 : 1),
        delta: d != null ? deltaStr(d) : '',
        deltaClass: d == null ? '' : Math.abs(d) < 5 ? 'text-muted' : d > 0 ? 'text-danger' : 'text-success',
      };
    });
  },

  families() {
    const t = Template.instance();
    const baseline = t.baselineTag.get();
    const target = t.targetTag.get();

    // Get all scenarios that have data
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

        const allForScenario = Runs.find({ tag: target, scenario }).count();

        return {
          scenario,
          scenarioLabel: meta.label || scenario,
          interpret: meta.interpret || '',
          wallClock: fmt(run.wall_clock_ms / 1000, 's'),
          cpu: fmt(run.metrics?.app_resources?.cpu?.avg, '%'),
          ram: fmt(run.metrics?.app_resources?.memory?.avg_mb, ' MB', 0),
          gc: fmt(run.metrics?.gc?.total_pause_ms, ' ms', 0),
          verdict: verdictHtml(bRun, tRun),
          runCount: allForScenario,
        };
      }).filter(Boolean);

      return {
        ...family,
        scenarioCount: family.scenarios.length,
        rows,
      };
    });
  },

  // Recent runs table (collapsed)
  recentRuns() { return Runs.find({}, { sort: { timestamp: -1 }, limit: 50 }); },
  totalRunCount() { return Runs.find().count(); },
  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },
  formatMs(ms) {
    if (!ms) return '-';
    return `${(ms / 1000).toFixed(1)}s`;
  },
  cpuAvg() { return this.metrics?.app_resources?.cpu?.avg?.toFixed(1) || '-'; },
  ramAvg() { return this.metrics?.app_resources?.memory?.avg_mb?.toFixed(0) || '-'; },
  gcPause() { return this.metrics?.gc?.total_pause_ms?.toFixed(0) || '-'; },
});

Template.dashboard.events({
  'change #healthBaseline'(event, instance) {
    instance.baselineTag.set(event.target.value);
  },
  'change #healthTarget'(event, instance) {
    instance.targetTag.set(event.target.value);
  },
  'click #swapTags'(event, instance) {
    const a = instance.baselineTag.get();
    const b = instance.targetTag.get();
    instance.baselineTag.set(b);
    instance.targetTag.set(a);
  },
});
