const test=require('node:test');
const assert=require('node:assert/strict');
const {SAMPLE_ARGS,RENDER_ARGS,sampleArgs,renderArgs}=require('../shared/browser-launch.cjs');

test('沙盒样张参数保留单进程与 SwiftShader 基线',()=>{
 assert.ok(SAMPLE_ARGS.includes('--single-process'));
 assert.ok(SAMPLE_ARGS.includes('--no-sandbox'));
 assert.ok(SAMPLE_ARGS.includes('--enable-unsafe-swiftshader'));
});

test('metal 样张参数移除 SwiftShader 并追加显式 Metal 选项',()=>{
 const args=sampleArgs('metal');
 assert.ok(!args.includes('--enable-unsafe-swiftshader'));
 assert.ok(args.includes('--use-gl=angle'));
 assert.ok(args.includes('--use-angle=metal'));
 assert.ok(args.includes('--single-process'));
});

test('参数生成返回新数组，不修改导出的常量数组',()=>{
 const sampleBefore=[...SAMPLE_ARGS],renderBefore=[...RENDER_ARGS];
 const sample=sampleArgs('metal'),render=renderArgs('metal');
 assert.notStrictEqual(sample,SAMPLE_ARGS);
 assert.notStrictEqual(render,RENDER_ARGS);
 sample.push('--mutated');
 render.push('--mutated');
 assert.deepEqual(SAMPLE_ARGS,sampleBefore);
 assert.deepEqual(RENDER_ARGS,renderBefore);
});

test('renderArgs 只替换 use-gl，保留其余渲染参数',()=>{
 const args=renderArgs('egl');
 assert.deepEqual(args,['--force-color-profile=srgb','--font-render-hinting=none','--use-gl=egl']);
 assert.deepEqual(renderArgs(),RENDER_ARGS);
});
