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

    // Group by tag for multi-line chart
    const byTag = {};
    for (const run of runs) {
      if (!byTag[run.tag]) byTag[run.tag] = [];
      const val = extractor(run);
      if (val != null) {
        byTag[run.tag].push({ x: new Date(run.timestamp), y: val });
      }
    }

    const colors = ['#0d6efd', '#dc3545', '#198754', '#ffc107', '#6610f2', '#fd7e14'];
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
          x: { type: 'time', time: { unit: 'day' } },
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

Template.trends.helpers({
  scenarios() { return Template.instance().scenarios.get(); },
  tags() { return Template.instance().tags.get(); },
  hasData() {
    const scenario = Template.instance().selectedScenario.get();
    return scenario && Runs.find({ scenario }).count() > 0;
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
