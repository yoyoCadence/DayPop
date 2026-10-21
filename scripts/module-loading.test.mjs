import assert from 'node:assert/strict';
import test from 'node:test';
import { findStaticPath } from './module-loading.mjs';

const graph = new Map([
  ['entry', ['calendar', 'settings', 'cache']],
  ['calendar', ['recurrence']],
  ['settings', ['transfer']],
  ['cache', ['transfer']],
  ['transfer', ['ics']],
  ['ics', ['recurrence']],
  ['recurrence', ['calendar']], // A real graph may contain cycles.
  ['lazy-only', []], // Its dynamic importer is deliberately absent here.
]);

test('finds an eager path through a shared dependency', () => {
  assert.deepEqual(findStaticPath(graph, 'entry', 'ics'), ['entry', 'settings', 'transfer', 'ics']);
});

test('does not call a dynamic-only module eager', () => {
  assert.equal(findStaticPath(graph, 'entry', 'lazy-only'), null);
});

test('takes the shortest static path despite a cycle', () => {
  assert.deepEqual(findStaticPath(graph, 'entry', 'recurrence'), ['entry', 'calendar', 'recurrence']);
});

test('handles the entry itself and an absent entry', () => {
  assert.deepEqual(findStaticPath(graph, 'entry', 'entry'), ['entry']);
  assert.equal(findStaticPath(graph, 'absent', 'ics'), null);
});

test('settings deferral alone leaves another eager path to ICS', () => {
  const withoutSettings = new Map(graph);
  withoutSettings.set('entry', ['calendar', 'cache']);
  assert.deepEqual(findStaticPath(withoutSettings, 'entry', 'ics'), ['entry', 'cache', 'transfer', 'ics']);
});
