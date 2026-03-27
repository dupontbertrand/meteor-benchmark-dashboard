import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';

const Runs = new Mongo.Collection('runs');

// Deny all direct client-side writes — only server methods allowed
Runs.deny({
  insert() { return true; },
  update() { return true; },
  remove() { return true; },
});

if (Meteor.isServer) {
  Runs.createIndexAsync({ timestamp: -1 });
  Runs.createIndexAsync({ tag: 1, scenario: 1 });

  Meteor.publish('runs.recent', function (limit = 50) {
    check(limit, Number);
    return Runs.find({}, { sort: { timestamp: -1 }, limit: Math.min(limit, 200) });
  });

  Meteor.publish('runs.byTag', function (tag) {
    check(tag, String);
    return Runs.find({ tag }, { sort: { timestamp: -1 } });
  });

  Meteor.publish('runs.forCompare', function (tagA, tagB, scenario) {
    check(tagA, String);
    check(tagB, String);
    check(scenario, Match.Maybe(String));
    const query = { tag: { $in: [tagA, tagB] } };
    if (scenario) query.scenario = scenario;
    return Runs.find(query, { sort: { timestamp: -1 } });
  });

  Meteor.publish('runs.single', function (runId) {
    check(runId, String);
    return Runs.find({ _id: runId });
  });

  Meteor.methods({
    async 'runs.insert'(apiKey, resultJson) {
      check(apiKey, String);
      check(resultJson, Object);

      const expectedKey = Meteor.settings?.benchApiKey;
      if (!expectedKey || apiKey !== expectedKey) {
        throw new Meteor.Error('unauthorized', 'Invalid API key');
      }

      // Ensure timestamp is a Date
      if (resultJson.timestamp && typeof resultJson.timestamp === 'string') {
        resultJson.timestamp = new Date(resultJson.timestamp);
      }
      if (!resultJson.timestamp) {
        resultJson.timestamp = new Date();
      }

      return await Runs.insertAsync(resultJson);
    },

    async 'runs.distinctTags'() {
      const runs = await Runs.find({}, { fields: { tag: 1 }, sort: { timestamp: -1 } }).fetchAsync();
      return [...new Set(runs.map((r) => r.tag))];
    },

    async 'runs.distinctScenarios'() {
      const runs = await Runs.find({}, { fields: { scenario: 1 } }).fetchAsync();
      return [...new Set(runs.map((r) => r.scenario))];
    },
  });
}

export { Runs };
