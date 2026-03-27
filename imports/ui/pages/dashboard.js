import { Template } from 'meteor/templating';
import { Runs } from '../../api/runs';
import './dashboard.html';

Template.dashboard.onCreated(function () {
  this.subscribe('runs.recent', 50);
});

Template.dashboard.helpers({
  runs() {
    return Runs.find({}, { sort: { timestamp: -1 } });
  },
  hasRuns() {
    return Runs.find().count() > 0;
  },
  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  },
  formatMs(ms) {
    if (!ms) return '-';
    return `${(ms / 1000).toFixed(1)}s`;
  },
  cpuAvg() {
    return this.metrics?.app_resources?.cpu?.avg?.toFixed(1) || '-';
  },
  ramAvg() {
    return this.metrics?.app_resources?.memory?.avg_mb?.toFixed(0) || '-';
  },
  gcPause() {
    return this.metrics?.gc?.total_pause_ms?.toFixed(0) || '-';
  },
  statusBadge() {
    // Simple status based on wall clock time — will be enhanced with baseline comparison
    const wc = this.wall_clock_ms;
    if (!wc) return '<span class="badge bg-secondary">-</span>';
    if (wc < 150000) return '<span class="badge bg-success">OK</span>';
    if (wc < 300000) return '<span class="badge bg-warning text-dark">Slow</span>';
    return '<span class="badge bg-danger">Heavy</span>';
  },
});
