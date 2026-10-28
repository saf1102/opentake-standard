// A user's Codex may not offer the model a module asks for (accounts and CLI versions differ). The run then uses the
// CLI's own default model instead of failing with 「当前 CLI 未提供模型」, and keeps what was asked for in `requested`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FOLLOW_DEFAULT,effectiveChoice,defaultAgentSettings,type AgentModel} from '../src/studio/agent-settings.ts';

const models:AgentModel[]=[
 {id:'gpt-6.1-sol',name:'GPT-6.1-Sol',efforts:['low','medium','high'],defaultEffort:'medium',isDefault:true},
 {id:'gpt-6-luna',name:'GPT-6-Luna',efforts:['low','medium','high','xhigh','max','ultra'],defaultEffort:'low'},
];
test('new settings follow the CLI default model instead of naming one',()=>{
 assert.ok(Object.values(defaultAgentSettings().modules).every(c=>c.model===FOLLOW_DEFAULT));
 assert.deepEqual(effectiveChoice({model:FOLLOW_DEFAULT,effort:'medium'},models),{model:'gpt-6.1-sol',effort:'medium'});
});
test('a model this Codex lacks runs on its default model, saying what was asked for',()=>{
 assert.deepEqual(effectiveChoice({model:'gpt-6-astra',effort:'medium'},models),{model:'gpt-6.1-sol',effort:'medium',requested:{model:'gpt-6-astra',effort:'medium'}});
 assert.deepEqual(effectiveChoice({model:'gpt-6-astra',effort:'ultra'},models),{model:'gpt-6.1-sol',effort:'medium',requested:{model:'gpt-6-astra',effort:'ultra'}},'unsupported effort moves to the model default');
});
test('an offered model is used as chosen; with no default flag the first model is the default',()=>{
 assert.deepEqual(effectiveChoice({model:'gpt-6-luna',effort:'ultra'},models),{model:'gpt-6-luna',effort:'ultra'});
 assert.equal(effectiveChoice({model:FOLLOW_DEFAULT,effort:'medium'},models.map(({isDefault:_d,...m})=>m)).model,'gpt-6.1-sol');
});
