import { Template } from 'meteor/templating';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Runs } from '../../api/runs';
import './detail.html';

Template.detail.onCreated(function () {
  this.autorun(() => {
    const runId = FlowRouter.getParam('id');
    if (runId) this.subscribe('runs.single', runId);
  });
});

Template.detail.helpers({
  run() {
    return Runs.findOne(FlowRouter.getParam('id'));
  },
  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  },
  formatMs(ms) {
    if (!ms) return '-';
    return `${(ms / 1000).toFixed(1)}s`;
  },
  appCpuAvg() { return this.metrics?.app_resources?.cpu?.avg?.toFixed(1) || '-'; },
  appCpuMax() { return this.metrics?.app_resources?.cpu?.max?.toFixed(1) || '-'; },
  appRamAvg() { return this.metrics?.app_resources?.memory?.avg_mb?.toFixed(0) || '-'; },
  appRamMax() { return this.metrics?.app_resources?.memory?.max_mb?.toFixed(0) || '-'; },
  dbCpuAvg() { return this.metrics?.db_resources?.cpu?.avg?.toFixed(1) || '-'; },
  dbRamAvg() { return this.metrics?.db_resources?.memory?.avg_mb?.toFixed(0) || '-'; },
  gcCount() { return this.metrics?.gc?.count || '-'; },
  gcTotalPause() { return this.metrics?.gc?.total_pause_ms?.toFixed(0) || '-'; },
  gcMaxPause() { return this.metrics?.gc?.max_pause_ms?.toFixed(1) || '-'; },
  gcAvgPause() { return this.metrics?.gc?.avg_pause_ms?.toFixed(1) || '-'; },
  gcMinorCount() { return this.metrics?.gc?.minor?.count || '-'; },
  gcMinorMs() { return this.metrics?.gc?.minor?.total_ms?.toFixed(0) || '-'; },
  gcMajorCount() { return this.metrics?.gc?.major?.count || '-'; },
  gcMajorMs() { return this.metrics?.gc?.major?.total_ms?.toFixed(0) || '-'; },
});
