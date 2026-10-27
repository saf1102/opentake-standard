import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetForRole } from './general/kit/web/text.js';

test('text: a preset made for one role takes the size of the role it is put on', () => {
  const title = { font: 'Inter', size: 0.1, roles: ['title'] };
  assert.equal(presetForRole(title, 'title'), title); // its own role: untouched
  assert.ok(Math.abs(presetForRole(title, 'label').size - 0.1 * 0.03 / 0.078) < 1e-9); // a title look on a label shrinks
  assert.equal(presetForRole(title, 'label').font, 'Inter'); // the look stays
  const generic = { font: 'Noto Sans SC', size: 0.042 };
  assert.equal(presetForRole(generic, 'title'), generic); // presets that name no roles are never resized
});
