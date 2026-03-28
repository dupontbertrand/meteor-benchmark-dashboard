import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Meteor } from 'meteor/meteor';
import { Runs } from '../../api/runs';
import './compare.html';

Template.compare.onCreated(function () {
  this.tags = new ReactiveVar([]);
  this.scenarios = new ReactiveVar([]);
  this.selectedTagA = new ReactiveVar('');
  this.selectedTagB = new ReactiveVar('');
  this.selectedScenario = new ReactiveVar('');

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

Template.compare.helpers({
  tags() { return Template.instance().tags.get(); },
  scenarios() { return Template.instance().scenarios.get(); },
  selectedTagA() { return Template.instance().selectedTagA.get(); },
  selectedTagB() { return Template.instance().selectedTagB.get(); },
  showComparison() {
    const t = Template.instance();
    return t.selectedTagA.get() && t.selectedTagB.get();
  },
  baselineRun() {
    const tagA = Template.instance().selectedTagA.get();
    return Runs.findOne({ tag: tagA }, { sort: { timestamp: -1 } });
  },
  comparisonRows() {
    const t = Template.instance();
    const tagA = t.selectedTagA.get();
    const tagB = t.selectedTagB.get();
    const baseline = Runs.findOne({ tag: tagA }, { sort: { timestamp: -1 } });
    const target = Runs.findOne({ tag: tagB }, { sort: { timestamp: -1 } });
    if (!baseline || !target) return [];

    const tooltips = {
      'Wall clock': 'Total benchmark duration. Sensitive to runner load — use for relative comparisons only.',
      'APP CPU avg': 'Average CPU usage of the Meteor Node.js process. Values above 100% mean multi-core usage. Higher = server working harder.',
      'APP RAM avg': 'Average resident memory (RSS) of the Meteor process. Steady growth across runs may indicate a memory leak.',
      'DB CPU avg': 'Average CPU usage of the MongoDB process. High values suggest unindexed queries or write-heavy workloads.',
      'DB RAM avg': 'Average resident memory of the MongoDB process. Includes WiredTiger cache and connection buffers.',
      'GC total pause': 'Total time V8 spent on garbage collection instead of running code. Most reliable metric on shared runners.',
      'GC max pause': 'Longest single GC freeze. Above 50ms = noticeable latency spike for connected clients.',
      'GC count': 'Number of GC events (minor + major). More = more temporary objects allocated and discarded.',
      'GC major': 'Time spent in full heap (mark-sweep-compact) collections. The most expensive GC type — causes the longest pauses.',
    };

    const rows = [];
    const addRow = (label, baseVal, targetVal, unit) => {
      if (baseVal == null || targetVal == null || baseVal === 0) return;
      const delta = ((targetVal - baseVal) / baseVal) * 100;
      const deltaFixed = delta.toFixed(1);
      const isWorse = delta > 0;
      rows.push({
        label,
        tooltip: tooltips[label] || '',
        baselineVal: `${baseVal.toFixed?.(1) ?? baseVal}${unit}`,
        targetVal: `${targetVal.toFixed?.(1) ?? targetVal}${unit}`,
        deltaStr: `${delta > 0 ? '+' : ''}${deltaFixed}%`,
        deltaClass: Math.abs(delta) < 5 ? '' : isWorse ? 'text-danger fw-bold' : 'text-success fw-bold',
        statusIcon: Math.abs(delta) < 5
          ? '<span class="badge bg-secondary">~</span>'
          : isWorse
            ? (delta > 25 ? '<span class="badge bg-danger">FAIL</span>' : '<span class="badge bg-warning text-dark">WARN</span>')
            : '<span class="badge bg-success">OK</span>',
      });
    };

    addRow('Wall clock', baseline.wall_clock_ms / 1000, target.wall_clock_ms / 1000, 's');

    const bApp = baseline.metrics?.app_resources;
    const tApp = target.metrics?.app_resources;
    if (bApp && tApp) {
      addRow('APP CPU avg', bApp.cpu?.avg, tApp.cpu?.avg, '%');
      addRow('APP RAM avg', bApp.memory?.avg_mb, tApp.memory?.avg_mb, ' MB');
    }

    const bDb = baseline.metrics?.db_resources;
    const tDb = target.metrics?.db_resources;
    if (bDb && tDb) {
      addRow('DB CPU avg', bDb.cpu?.avg, tDb.cpu?.avg, '%');
      addRow('DB RAM avg', bDb.memory?.avg_mb, tDb.memory?.avg_mb, ' MB');
    }

    const bGc = baseline.metrics?.gc;
    const tGc = target.metrics?.gc;
    if (bGc && tGc) {
      addRow('GC total pause', bGc.total_pause_ms, tGc.total_pause_ms, ' ms');
      addRow('GC max pause', bGc.max_pause_ms, tGc.max_pause_ms, ' ms');
      addRow('GC count', bGc.count, tGc.count, '');
      addRow('GC major', bGc.major?.total_ms, tGc.major?.total_ms, ' ms');
    }

    return rows;
  },
});

Template.compare.events({
  'change #tagA'(event, instance) {
    instance.selectedTagA.set(event.target.value);
  },
  'change #tagB'(event, instance) {
    instance.selectedTagB.set(event.target.value);
  },
  'change #scenarioFilter'(event, instance) {
    instance.selectedScenario.set(event.target.value);
  },
});
