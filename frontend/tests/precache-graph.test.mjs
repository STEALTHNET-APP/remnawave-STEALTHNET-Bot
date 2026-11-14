import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPrecacheViolations, parsePrecacheManifest, parseStaticImports } from '../scripts/check-precache-graph.mjs';

const swSource = 'precacheAndRoute([{revision:"a",url:"assets/a.js"},{revision:"b",url:"index.html"}],{})';

test('precache manifest entries are read from the generated service worker', () => {
  assert.deepEqual([...parsePrecacheManifest(swSource)].sort(), ['assets/a.js', 'index.html']);
});

test('dynamic imports are not treated as static dependencies', () => {
  const source = 'import{a}from"./b.js";import"./c.js";const load=()=>import("./d.js")';
  assert.deepEqual([...parseStaticImports(source)].sort(), ['b.js', 'c.js']);
});

test('a precached chunk importing a missing chunk is reported', () => {
  const manifest = parsePrecacheManifest(swSource);
  const violations = findPrecacheViolations(manifest, [['assets/a.js', 'import{x}from"./b.js"']]);
  assert.deepEqual(violations, [{ file: 'assets/a.js', missing: 'assets/b.js' }]);
});

test('a consistent precache manifest passes the check', () => {
  const manifest = parsePrecacheManifest('precacheAndRoute([{revision:"a",url:"assets/a.js"},{revision:"b",url:"assets/b.js"}],{})');
  assert.deepEqual(findPrecacheViolations(manifest, [['assets/a.js', 'import{x}from"./b.js"']]), []);
});
