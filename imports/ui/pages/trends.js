import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Meteor } from 'meteor/meteor';
import { Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import { Runs } from '../../api/runs';
import './trends.html';

const METRIC_EXTRACTORS = {
  wall_clock: (r) => r.wall_clock_ms / 1000,
  cpu_avg: (r) => r.metrics?.app_resources?.cpu?.avg,
  ram_avg: (r) => r.metrics?.app_resources?.memory?.avg_mb,
  gc_total: (r) => r.metrics?.gc?.total_pause_ms,
  gc_max: (r) => r.metrics?.gc?.max_pause_ms,
  gc_count: (r) => r.metrics?.gc?.count,
};

const METRIC_UNITS = {
  wall_clock: 's', cpu_avg: '%', ram_avg: ' MB',
  gc_total: ' ms', gc_max: ' ms', gc_count: '',
};

const COLORS = ['#0d6efd', '#dc3545', '#198754', '#ffc107', '#6610f2', '#fd7e14', '#20c997', '#e83e8c'];

function fmtVal(val, metric) {
  if (val == null) return '-';
  const unit = METRIC_UNITS[metric] || '';
  return `${val.toFixed(1)}${unit}`;
}

function computeStats(values, metric) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    latest: fmtVal(values[values.length - 1], metric),
    median: fmtVal(sorted[Math.floor(sorted.length / 2)], metric),
    min: fmtVal(sorted[0], metric),
    max: fmtVal(sorted[sorted.length - 1], metric),
    count: values.length,
  };
}

function formatShortDate(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── Template ───────────────────────────────────────────────────────

Template.trends.onCreated(function () {
  this.scenarios = new ReactiveVar([]);
  this.tags = new ReactiveVar([]);
  this.selectedScenario = new ReactiveVar('');
  this.selectedMetric = new ReactiveVar('gc_total');
  this.selectedTag = new ReactiveVar('');
  this.compareTag = new ReactiveVar('');
  this.chart = null;

  Meteor.callAsync('runs.distinctScenarios').then((s) => {
    this.scenarios.set(s);
    if (s.includes('ddp-reactive-light')) this.selectedScenario.set('ddp-reactive-light');
    else if (s.length > 0) this.selectedScenario.set(s[0]);
  });
  Meteor.callAsync('runs.distinctTags').then((t) => {
    this.tags.set(t);
    if (t.includes('devel')) this.selectedTag.set('devel');
    else if (t.length > 0) this.selectedTag.set(t[0]);
  });

  this.subscribe('runs.recent', 200);
});

Template.trends.onRendered(function () {
  this.autorun(() => {
    const scenario = this.selectedScenario.get();
    const metric = this.selectedMetric.get();
    const primaryTag = this.selectedTag.get();
    const compareTag = this.compareTag.get();
    if (!scenario || !primaryTag) return;

    const extractor = METRIC_EXTRACTORS[metric];
    if (!extractor) return;

    // Build datasets: primary tag always shown, compare tag optional
    const tagsToShow = [primaryTag];
    if (compareTag && compareTag !== primaryTag) tagsToShow.push(compareTag);

    const datasets = tagsToShow.map((tag, i) => {
      const runs = Runs.find({ scenario, tag }, { sort: { timestamp: 1 } }).fetch();
      const points = [];
      for (const run of runs) {
        const val = extractor(run);
        if (val != null) {
          points.push({ x: new Date(run.timestamp), y: val });
        }
      }
      return {
        label: tag,
        data: points,
        borderColor: COLORS[i],
        backgroundColor: COLORS[i] + '30',
        tension: 0,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: false,
      };
    });

    const canvas = document.getElementById('trendChart');
    if (!canvas) return;

    if (this.chart) this.chart.destroy();
    this.chart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        interaction: { intersect: false, mode: 'nearest' },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'dd MMM yyyy, HH:mm' },
            title: { display: false },
          },
          y: { beginAtZero: true },
        },
        plugins: {
          legend: { position: 'top' },
        },
      },
    });
  });
});

Template.trends.onDestroyed(function () {
  if (this.chart) this.chart.destroy();
});

// ─── Metric explanations ────────────────────────────────────────────

const METRIC_EXPLANATIONS = {
  wall_clock:
    '<strong>Wall Clock (s)</strong> — Total benchmark duration. ' +
    'Highly sensitive to runner load — on shared CI runners, expect ~30% variance. ' +
    'Best used for relative comparisons on the same machine.',
  cpu_avg:
    '<strong>APP CPU avg (%)</strong> — Average CPU of the Meteor process. ' +
    'Values above 100% = multi-core. Higher under same load = possible regression.',
  ram_avg:
    '<strong>APP RAM avg (MB)</strong> — Average RSS of the Meteor process. ' +
    'Steady growth may indicate a memory leak.',
  gc_total:
    '<strong>GC total pause (ms)</strong> — Total V8 garbage collection time. ' +
    'Most reliable metric on shared runners — independent of CPU contention.',
  gc_max:
    '<strong>GC max pause (ms)</strong> — Longest single GC freeze. ' +
    'Above 50ms = noticeable latency spike for clients.',
  gc_count:
    '<strong>GC count</strong> — Total GC events. ' +
    'More = more temporary object allocation.',
};

// ─── Helpers ────────────────────────────────────────────────────────

Template.trends.helpers({
  scenarios() { return Template.instance().scenarios.get(); },
  tags() { return Template.instance().tags.get(); },
  selectedTag() { return Template.instance().selectedTag.get(); },

  hasData() {
    const t = Template.instance();
    const scenario = t.selectedScenario.get();
    const tag = t.selectedTag.get();
    return scenario && tag && Runs.find({ scenario, tag }).count() > 0;
  },

  stats() {
    const t = Template.instance();
    const scenario = t.selectedScenario.get();
    const tag = t.selectedTag.get();
    const metric = t.selectedMetric.get();
    const extractor = METRIC_EXTRACTORS[metric];
    if (!scenario || !tag || !extractor) return null;

    const runs = Runs.find({ scenario, tag }, { sort: { timestamp: 1 } }).fetch();
    const values = runs.map(extractor).filter(v => v != null);
    const lastRun = runs[runs.length - 1];

    const s = computeStats(values, metric);
    if (!s) return null;
    s.lastRun = formatShortDate(lastRun?.timestamp);
    return s;
  },

  metricExplanation() {
    return METRIC_EXPLANATIONS[Template.instance().selectedMetric.get()] || '';
  },

  // Cross-version comparison table
  hasCrossVersion() {
    const scenario = Template.instance().selectedScenario.get();
    if (!scenario) return false;
    const tags = [...new Set(Runs.find({ scenario }).fetch().map(r => r.tag))];
    return tags.length > 1;
  },

  crossVersionRows() {
    const t = Template.instance();
    const scenario = t.selectedScenario.get();
    const metric = t.selectedMetric.get();
    const extractor = METRIC_EXTRACTORS[metric];
    if (!scenario || !extractor) return [];

    const allRuns = Runs.find({ scenario }, { sort: { timestamp: 1 } }).fetch();
    const byTag = {};
    for (const run of allRuns) {
      if (!byTag[run.tag]) byTag[run.tag] = [];
      const val = extractor(run);
      if (val != null) byTag[run.tag].push({ val, timestamp: run.timestamp });
    }

    return Object.entries(byTag).map(([tag, entries], i) => {
      const values = entries.map(e => e.val);
      const sorted = [...values].sort((a, b) => a - b);
      const last = entries[entries.length - 1];
      return {
        tag,
        color: COLORS[i % COLORS.length],
        latest: fmtVal(values[values.length - 1], metric),
        median: fmtVal(sorted[Math.floor(sorted.length / 2)], metric),
        count: values.length,
        lastRun: formatShortDate(last?.timestamp),
      };
    });
  },
});

// ─── Events ─────────────────────────────────────────────────────────

Template.trends.events({
  'change #trendScenario'(e, i) { i.selectedScenario.set(e.target.value); },
  'change #trendMetric'(e, i) { i.selectedMetric.set(e.target.value); },
  'change #trendTag'(e, i) { i.selectedTag.set(e.target.value); },
  'change #trendCompareTag'(e, i) { i.compareTag.set(e.target.value); },
});
