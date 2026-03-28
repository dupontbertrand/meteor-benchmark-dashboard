import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Tracker } from 'meteor/tracker';
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

Template.trends.onCreated(function () {
  this.scenarios = new ReactiveVar([]);
  this.tags = new ReactiveVar([]);
  this.selectedScenario = new ReactiveVar('');
  this.selectedMetric = new ReactiveVar('wall_clock');
  this.selectedTag = new ReactiveVar('');
  this.chart = null;

  Meteor.callAsync('runs.distinctScenarios').then((s) => {
    this.scenarios.set(s);
    if (s.length > 0) this.selectedScenario.set(s[0]);
  });
  Meteor.callAsync('runs.distinctTags').then((t) => this.tags.set(t));

  this.subscribe('runs.recent', 200);
});

Template.trends.onRendered(function () {
  this.autorun(() => {
    const scenario = this.selectedScenario.get();
    const metric = this.selectedMetric.get();
    const tagFilter = this.selectedTag.get();
    if (!scenario) return;

    const query = { scenario };
    if (tagFilter) query.tag = tagFilter;
    const runs = Runs.find(query, { sort: { timestamp: 1 } }).fetch();
    const extractor = METRIC_EXTRACTORS[metric];
    if (!extractor || runs.length === 0) return;

    // Group by tag for multi-line chart, using run index (not timestamp) for X axis
    const byTag = {};
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (!byTag[run.tag]) byTag[run.tag] = [];
      const val = extractor(run);
      if (val != null) {
        byTag[run.tag].push({ x: i, y: val, timestamp: run.timestamp });
      }
    }

    const colors = ['#0d6efd', '#dc3545', '#198754', '#ffc107', '#6610f2', '#fd7e14', '#20c997', '#e83e8c'];
    const datasets = Object.entries(byTag).map(([tag, points], i) => ({
      label: tag,
      data: points,
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '20',
      tension: 0.3,
      fill: false,
    }));

    const canvas = document.getElementById('trendChart');
    if (!canvas) return;

    if (this.chart) this.chart.destroy();
    this.chart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        scales: {
          x: {
            type: 'linear',
            display: true,
            title: { display: true, text: 'Run #' },
            ticks: { stepSize: 1, callback: (v) => `#${v + 1}` },
          },
          y: { beginAtZero: true },
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              title(items) {
                const pt = items[0]?.raw;
                if (pt?.timestamp) {
                  return new Date(pt.timestamp).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  });
                }
                return '';
              },
            },
          },
        },
      },
    });
  });
});

Template.trends.onDestroyed(function () {
  if (this.chart) this.chart.destroy();
});

const METRIC_EXPLANATIONS = {
  wall_clock:
    '<strong>Wall Clock (s)</strong> — Total time from Artillery start to finish. ' +
    'Includes all virtual user activity, network latency, and server processing. ' +
    'Highly sensitive to runner load — on shared CI runners, expect ~30% variance. ' +
    'Best used for relative comparisons on the same machine, not absolute values.',
  cpu_avg:
    '<strong>APP CPU avg (%)</strong> — Average CPU usage of the Meteor Node.js process during the benchmark. ' +
    'Measured via <code>pidusage</code> at 1-second intervals. Values above 100% indicate multi-core usage. ' +
    'Higher CPU under the same load means the server is working harder — possible regression in hot paths ' +
    '(DDP serialization, oplog processing, method handlers).',
  ram_avg:
    '<strong>APP RAM avg (MB)</strong> — Average resident memory (RSS) of the Meteor process. ' +
    'Steady growth across runs may indicate a memory leak. A spike on one branch vs another ' +
    'suggests that branch allocates more objects (larger caches, heavier data structures, more subscriptions held in memory).',
  gc_total:
    '<strong>GC total pause (ms)</strong> — Sum of all garbage collection pauses during the benchmark. ' +
    'Collected via Node.js <code>PerformanceObserver</code> on the <code>gc</code> entry type. ' +
    'Higher values mean the V8 engine spent more time reclaiming memory instead of running your code. ' +
    'This is one of the most reliable metrics on shared runners — GC time is largely independent of CPU contention.',
  gc_max:
    '<strong>GC max pause (ms)</strong> — Longest single GC pause. ' +
    'A high max pause means the server "froze" for that duration — all DDP messages, method calls, ' +
    'and publication updates were blocked. Values above 50ms can cause noticeable latency spikes for clients. ' +
    'Usually caused by major (mark-sweep-compact) GC events on a large heap.',
  gc_count:
    '<strong>GC count</strong> — Total number of garbage collection events (minor + major). ' +
    'More GC events means more short-lived objects being created and discarded. ' +
    'A higher count on one branch suggests it allocates more temporary objects ' +
    '(e.g., intermediate arrays, serialized DDP messages, closures in hot loops).',
};

Template.trends.helpers({
  scenarios() { return Template.instance().scenarios.get(); },
  tags() { return Template.instance().tags.get(); },
  hasData() {
    const scenario = Template.instance().selectedScenario.get();
    return scenario && Runs.find({ scenario }).count() > 0;
  },
  metricExplanation() {
    const metric = Template.instance().selectedMetric.get();
    return METRIC_EXPLANATIONS[metric] || '';
  },
});

Template.trends.events({
  'change #trendScenario'(event, instance) {
    instance.selectedScenario.set(event.target.value);
  },
  'change #trendMetric'(event, instance) {
    instance.selectedMetric.set(event.target.value);
  },
  'change #trendTag'(event, instance) {
    instance.selectedTag.set(event.target.value);
  },
});
