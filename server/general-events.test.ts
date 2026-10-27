import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, applyCodexEvent, applyProgress, classifyCommand, initialSteps } from './general/events.ts';
import { parseVerdict, verdictText } from './general/review.ts';
import { filmTurnArgs, reviewArgs } from './general/codex.ts';
import type { GeneralStep } from '../src/general/general-contract.ts';

const states = (steps: GeneralStep[]) => Object.fromEntries(steps.map(s => [s.id, s.state]));

test('commands are classified by what they do', () => {
  assert.equal(classifyCommand(`/bin/zsh -lc 'export PATH="$CW_BIN:$PATH"; film render --workers 3'`)?.step, 'render');
  assert.equal(classifyCommand('/bin/zsh -lc "film look 0-8"')?.step, 'self-check');
  assert.equal(classifyCommand('/bin/zsh -lc "film probe clip.mp4"')?.step, 'read-input');
  assert.equal(classifyCommand('/bin/zsh -lc "film progress plan 写方案"'), undefined);
  assert.equal(classifyCommand(`/bin/zsh -lc "cat '/kit/styles/dark-keynote/STYLE.md'"`)?.step, 'read-style');
  assert.equal(classifyCommand("/bin/zsh -lc 'cat /example/.agents/skills/hyperframes/SKILL.md'"), undefined);
  assert.equal(classifyCommand("/bin/zsh -lc 'ls -la'"), undefined);
});

test('advance never moves backwards and keeps skipped steps skipped', () => {
  const at = '2026-10-24T09:00:00.000Z';
  let steps = initialSteps('topic', 'revision');
  assert.deepEqual(['read-style', 'read-input', 'plan'].map(id => steps.find(s => s.id === id)!.state), ['skipped', 'skipped', 'skipped']);
  steps = advance(steps, 'self-check', at, '看接触表');
  assert.equal(states(steps).code, 'done');
  assert.equal(states(steps).plan, 'skipped');
  const back = advance(steps, 'code', at, '回头改代码');
  assert.equal(states(back)['self-check'], 'running');
  assert.equal(states(back).code, 'done');
  assert.equal(back.find(s => s.id === 'self-check')!.detail, '回头改代码');
  // a finished step is not restarted by a later turn that looks at it again (real run: re-reading the plan)
  const planned = advance(advance(initialSteps('topic', 'first'), 'plan', at), 'code', at).map(s => s.id === 'code' ? { ...s, state: 'waiting' as const } : s.id === 'plan' ? { ...s, state: 'done' as const } : s);
  assert.equal(states(advance(planned, 'plan', at, '再看一遍方案')).plan, 'done');
});

test('progress.json moves steps, carries thumbs and render progress', () => {
  const at = '2026-10-24T09:00:00.000Z';
  let steps = initialSteps('topic', 'first');
  steps = applyProgress(steps, { step: 'self-check', detail: '看过接触表', thumbs: ['look/sheet.jpg', '../escape.jpg'] }, at, rel => rel.startsWith('..') ? undefined : `/files/work/${rel}`);
  const check = steps.find(s => s.id === 'self-check')!;
  assert.equal(check.state, 'running');
  assert.deepEqual(check.thumbs, ['/files/work/look/sheet.jpg']);
  steps = applyProgress(steps, { step: 'render', progress: { done: 4.5, total: 15 } }, at, () => undefined);
  assert.deepEqual(steps.find(s => s.id === 'render')!.progress, { done: 4.5, total: 15 });
  assert.equal(states(steps)['self-check'], 'done');
  assert.equal(applyProgress(steps, { step: 'deliver' }, at, () => undefined), steps, 'the agent cannot claim OpenTake steps');
});

test('reviewer verdict: JSON in the last message, tolerant of extra text', () => {
  const v = parseVerdict('结论如下：\n{"pass": false, "summary": "文字太小", "issues": [{"time": 3.2, "problem": "标题贴边", "fix": "往里收 80 像素"}, {"time": null, "problem": "", "fix": ""}]}\n');
  assert.equal(v.pass, false);
  assert.equal(v.issues.length, 1);
  assert.match(verdictText(v), /3\.2 秒：标题贴边（改法：往里收 80 像素）/);
  assert.throws(() => parseVerdict('看不出来'), /不是 JSON/);
  assert.throws(() => parseVerdict('{"summary":"x"}'), /pass/);
  assert.equal(parseVerdict('{"pass":true,"summary":"","issues":[]}').summary, '通过');
});

test('Codex arguments: sandboxed to work/, offline by default, user skills and config kept out', () => {
  const first = filmTurnArgs({ model: 'gpt-6-astra', effort: 'medium', work: '/p/work', lastMessage: '/p/agent/last.txt', network: false });
  const joined = first.join(' ');
  for (const part of ['--ignore-user-config', '--ignore-rules', 'skills.include_instructions=false', 'sandbox_mode="workspace-write"', 'sandbox_workspace_write.network_access=false', 'web_search="disabled"', 'approval_policy="never"', '--disable image_generation', '--disable multi_agent', '--disable computer_use'])
    assert.ok(joined.includes(part), part);
  assert.deepEqual(first.slice(first.indexOf('-C'), first.indexOf('-C') + 2), ['-C', '/p/work']);
  assert.ok(!joined.includes('CODEX_HOME'));
  const resumed = filmTurnArgs({ model: 'm', effort: 'low', work: '/p/work', lastMessage: '/l', network: true, resumeThread: 'T1', images: ['/r.png'] });
  assert.deepEqual(resumed.slice(0, 2), ['exec', 'resume']);
  assert.ok(resumed.join(' ').includes('network_access=true'));
  assert.ok(!resumed.includes('-C'));
  assert.deepEqual(resumed.slice(-4), ['T1', '-', '-i', '/r.png']);
  const review = reviewArgs({ model: 'm', effort: 'low', dir: '/p/review', lastMessage: '/p/review/v.txt', schema: '/s.json', images: ['/a.jpg', '/b.jpg'] });
  const r = review.join(' ');
  assert.ok(r.includes('sandbox_mode="read-only"') && r.includes('--ephemeral') && r.includes('--output-schema /s.json'));
  assert.deepEqual(review.slice(-5), ['-', '-i', '/a.jpg', '-i', '/b.jpg']);
});


test('portable project recovers only the explicit missing-rollout resume failure', async()=>{
 const {missingCodexRollout}=await import('./general/runner.ts');
 assert.equal(missingCodexRollout('Error: thread/resume: thread/resume failed: no rollout found for thread id test'),true);
 for(const text of ['rate limit','authentication failed','thread/resume: network error','no rollout found for thread id test']) assert.equal(missingCodexRollout(text),false);
});
