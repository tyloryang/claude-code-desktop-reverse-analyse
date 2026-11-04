'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { patchConfigDirectory, patchModelValidator } = require('../lib/portable-patch.cjs');

const source = 'function resolveConfig(){if(process.env.CLAUDE_USER_DATA_DIR)return electron.app.getPath("userData");return "official-data";}';
const validatorSource = 'function validateModel(e){let t=e.toLowerCase();return blockRegex.test(t)?!1:familyRegex.test(t)||allowedList.some((e=>t.includes(e)))}';

function resolve(sourceCode, directory, environment = {}) {
  return vm.runInNewContext(`${sourceCode};resolveConfig()`, {
    __CLAUDE_ZERO_CONFIG_DIRECTORY__: directory,
    process: { env: environment },
    electron: { app: { getPath: () => 'electron-data' } },
  });
}

test('isolates config after vendor code deletes the user-data environment override', () => {
  assert.equal(resolve(source, 'portable-data'), 'official-data');
  assert.equal(resolve(patchConfigDirectory(source, 'fixture'), 'portable-data'), 'portable-data');
});

test('preserves vendor behavior without the portable bootstrap', () => {
  const patched = patchConfigDirectory(source, 'fixture');
  assert.equal(resolve(patched, undefined), 'official-data');
  assert.equal(resolve(patched, undefined, { CLAUDE_USER_DATA_DIR: 'custom' }), 'electron-data');
});

test('refuses changed or ambiguous vendor config-directory functions', () => {
  assert.throws(() => patchConfigDirectory('function unknown(){}', 'missing'), /found 0/);
  assert.throws(() => patchConfigDirectory(source + source, 'ambiguous'), /found 2/);
});

test('patches model validator to accept third-party and custom models', () => {
  const patched = patchModelValidator(validatorSource, 'fixture');
  assert.equal(patched, 'function validateModel(e){return true}');
});

test('refuses changed or ambiguous model validator functions', () => {
  assert.throws(() => patchModelValidator('function unknown(){}', 'missing'), /found 0/);
  assert.throws(() => patchModelValidator(validatorSource + validatorSource, 'ambiguous'), /found 2/);
});
