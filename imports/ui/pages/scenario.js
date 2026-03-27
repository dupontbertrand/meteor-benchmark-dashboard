import { Template } from 'meteor/templating';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Runs } from '../../api/runs.js';
import './scenario.html';

const SCENARIOS = {
  'reactive-light': {
    name: 'reactive-light',
    driver: 'Artillery + Playwright',
    vus: '30 browser sessions',
    duration: '~2 min',
    browser: true,
    summary:
      'Simulates 30 real users interacting with the app through a browser. ' +
      'Each user subscribes to a publication, adds 20 tasks, then removes them. ' +
      'Measures how the server handles reactive data flow under light load.',
    technical:
      'Artillery spawns 30 Chromium instances via Playwright. Each virtual user opens ' +
      '<code>http://localhost:3000</code>, subscribes to the <code>fetchTasks</code> publication, ' +
      'and performs 20 <code>insertTask</code> + 20 <code>removeTask</code> method calls through the UI. ' +
      'Every insert/remove triggers a reactive update across all subscribed clients via the Meteor ' +
      'oplog tailing pipeline. Collectors track server-side CPU/RAM (pidusage, 1s interval) and ' +
      'GC events (Node.js PerformanceObserver on the Meteor process). ' +
      'The browser overhead (Chromium rendering, DOM updates) is included in wall clock time.',
  },
  'reactive-crud': {
    name: 'reactive-crud',
    driver: 'Artillery + Playwright',
    vus: '240 browser sessions',
    duration: '~5 min',
    browser: true,
    summary:
      'Heavy-load version of reactive-light. 240 real browser sessions performing CRUD operations ' +
      'simultaneously. Tests how the server handles reactive pub/sub at scale.',
    technical:
      'Same flow as <code>reactive-light</code> but with 240 concurrent Chromium instances. ' +
      'This creates significant pressure on the oplog tailing pipeline, DDP message serialization, ' +
      'and MongoDB write throughput. Each mutation fans out reactive updates to all 240 subscribed clients. ' +
      'Requires substantial resources — expect high CPU and memory on the runner. ' +
      'Best run on a dedicated machine for reliable results.',
  },
  'non-reactive-crud': {
    name: 'non-reactive-crud',
    driver: 'Artillery + Playwright',
    vus: '240 browser sessions',
    duration: '~5 min',
    browser: true,
    summary:
      'Same as reactive-crud but without pub/sub. Users call methods directly without subscribing. ' +
      'Isolates pure method call + MongoDB performance from reactive overhead.',
    technical:
      '240 Chromium instances calling <code>insertTask</code> and <code>removeTask</code> methods ' +
      'without subscribing to <code>fetchTasks</code>. Since no publication is active, the server ' +
      'skips the oplog tailing and DDP reactive pipeline entirely. Comparing this with ' +
      '<code>reactive-crud</code> reveals the exact cost of reactivity.',
  },
  'ddp-reactive-light': {
    name: 'ddp-reactive-light',
    driver: 'Artillery + SimpleDDP',
    vus: '150 DDP connections',
    duration: '~30s',
    browser: false,
    summary:
      'Pure server benchmark — no browser involved. 150 DDP clients connect via WebSocket, ' +
      'subscribe to a publication, insert and remove 20 tasks each. ' +
      'Tests raw DDP/pub-sub performance without any rendering overhead.',
    technical:
      'Artillery spawns 150 virtual users, each creating a SimpleDDP connection over raw WebSocket ' +
      '(<code>ws</code> library). Each VU calls <code>ddp.subscribe("fetchTasks")</code>, then ' +
      'performs 20 sequential <code>insertTask</code> + 20 <code>removeTask</code> method calls. ' +
      'Reactive updates flow through the oplog tailing pipeline and are sent to all subscribed clients ' +
      'as DDP <code>changed</code>/<code>added</code>/<code>removed</code> messages. ' +
      'No Chromium process, no DOM — measures pure Meteor server + MongoDB + DDP transport performance. ' +
      'Much faster to run than browser scenarios and scales to higher VU counts.',
  },
  'ddp-non-reactive-light': {
    name: 'ddp-non-reactive-light',
    driver: 'Artillery + SimpleDDP',
    vus: '150 DDP connections',
    duration: '~30s',
    browser: false,
    summary:
      'Same as ddp-reactive-light but without subscribing. Pure method calls over DDP. ' +
      'Isolates Meteor method dispatch + MongoDB write performance.',
    technical:
      '150 SimpleDDP clients connecting over WebSocket. Each VU performs 20 <code>insertTask</code> + ' +
      '20 <code>removeTask</code> calls without subscribing to any publication. ' +
      'No oplog tailing, no reactive fanout — just method dispatch, MongoDB writes, and DDP response. ' +
      'Comparing with <code>ddp-reactive-light</code> shows the exact cost of pub/sub reactivity ' +
      'at the DDP transport level.',
  },
  'cold-start': {
    name: 'cold-start',
    driver: 'CLI',
    vus: 'N/A',
    duration: 'varies',
    browser: false,
    summary:
      'Measures how long it takes the Meteor app to start from a clean state (after meteor reset). ' +
      'Includes build time, module loading, and initial MongoDB connection.',
    technical:
      'Runs <code>meteor reset</code> followed by <code>meteor run</code> and measures time until ' +
      'the app responds to HTTP requests on port 3000. Includes full isobuild compilation, ' +
      'npm module resolution, server startup, and MongoDB connection. Not yet implemented.',
  },
  'hot-reload': {
    name: 'hot-reload',
    driver: 'CLI',
    vus: 'N/A',
    duration: 'varies',
    browser: false,
    summary:
      'Measures rebuild time after a file change while the app is running. ' +
      'Tests the bundler hot-module-replacement performance.',
    technical:
      'With the app running, modifies a server file and measures time until the server restarts. ' +
      'Then modifies a client file and measures time until HMR applies the change. Not yet implemented.',
  },
  'bundle-size': {
    name: 'bundle-size',
    driver: 'CLI',
    vus: 'N/A',
    duration: 'varies',
    browser: false,
    summary:
      'Measures the output size of client and server bundles after meteor build. ' +
      'Tracks bundle bloat across versions.',
    technical:
      'Runs <code>meteor build</code> and measures the size of the resulting client JS bundle ' +
      'and server bundle. Helps detect dependency bloat or build regressions. Not yet implemented.',
  },
};

Template.scenario.onCreated(function () {
  this.subscribe('runs.recent', 50);
});

Template.scenario.helpers({
  scenarioName() {
    return FlowRouter.getParam('name');
  },
  info() {
    const name = FlowRouter.getParam('name');
    return SCENARIOS[name] || null;
  },
  hasRuns() {
    const name = FlowRouter.getParam('name');
    return Runs.find({ scenario: name }).count() > 0;
  },
  runs() {
    const name = FlowRouter.getParam('name');
    return Runs.find({ scenario: name }, { sort: { timestamp: -1 }, limit: 20 });
  },
  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },
  formatMs(ms) {
    if (!ms) return '-';
    return (ms / 1000).toFixed(1) + 's';
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
});
