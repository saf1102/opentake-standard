import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('importer',Path(__file__).with_name('import-windows.py'))
imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)

class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='opentake-jianying-')
        self.base=Path(self.temp.name);self.root=self.base/'草稿 中文 空格';self.root.mkdir()
        self.pkg=self.base/'导出包';(self.pkg/'Resources').mkdir(parents=True)
        self.registry=self.root/'root_meta_info.json'
        self.before=json.dumps({'all_draft_store':[{'draft_id':'old','draft_name':'KEEP'}],'draft_ids':['old']}).encode()
        self.registry.write_bytes(self.before)
        (self.root/'old').mkdir();(self.root/'old'/'keep').write_text('keep')
        (self.pkg/'Resources'/'声音.wav').write_bytes(b'fixture')
        (self.pkg/'Resources'/'font.ttf').write_bytes(b'fixture')
        self.old_id='11111111-1111-4111-8111-111111111111'
        self.content={'id':self.old_id,'duration':15000000,'materials':{'audios':[{'id':'22222222-2222-4222-8222-222222222222','path':'C:/old-package/Resources/声音.wav'}],'texts':[{'content':json.dumps({'text':self.old_id,'styles':[{'font':{'path':'C:/old-package/Resources/font.ttf'}}]})}]},'tracks':[]}
        for name in ('draft_info.json','draft_content.json'):(self.pkg/name).write_text(json.dumps(self.content),encoding='utf-8')
        (self.pkg/'draft_meta_info.json').write_text(json.dumps({'draft_id':self.old_id,'draft_name':'Test','draft_fold_path':'C:/old-package'}),encoding='utf-8')
        self.guard=patch.object(imp,'running',return_value=False);self.guard.start()
    def tearDown(self):
        self.guard.stop();self.temp.cleanup()
    def test_repeat_import_preserves_old_and_rewrites_ids_and_paths(self):
        first=imp.import_draft(self.pkg,self.root);second=imp.import_draft(self.pkg,self.root)
        self.assertNotEqual(first['draft_id'],second['draft_id'])
        self.assertEqual((self.root/'old'/'keep').read_text(),'keep')
        self.assertEqual(Path(first['backup']).read_bytes(),self.before)
        index=json.loads(self.registry.read_bytes());self.assertEqual(len(index['all_draft_store']),3)
        for result in (first,second):
            content=json.loads((Path(result['directory'])/'draft_content.json').read_text(encoding='utf-8'))
            self.assertEqual(content['id'],result['draft_id'])
            self.assertTrue(Path(content['materials']['audios'][0]['path']).is_file())
            self.assertNotEqual(content['materials']['audios'][0]['id'],self.content['materials']['audios'][0]['id'])
            subtitle=json.loads(content['materials']['texts'][0]['content'])
            self.assertEqual(subtitle['text'],self.old_id)
            self.assertTrue(Path(subtitle['styles'][0]['font']['path']).is_relative_to(Path(result['directory'])))
    def test_running_jianying_does_not_modify_index(self):
        with patch.object(imp,'running',return_value=True):
            with self.assertRaisesRegex(RuntimeError,'退出剪映'):imp.import_draft(self.pkg,self.root)
        self.assertEqual(self.registry.read_bytes(),self.before)
    def test_failed_commit_rolls_back_only_new_draft(self):
        with patch.object(imp.os,'replace',side_effect=OSError('locked')):
            with self.assertRaises(OSError):imp.import_draft(self.pkg,self.root)
        self.assertEqual(self.registry.read_bytes(),self.before)
        self.assertEqual([p.name for p in self.root.iterdir() if p.is_dir()],['old'])
    def test_concurrent_change_is_not_overwritten(self):
        changed=b'{"all_draft_store":[],"external":true}'
        calls=0
        def changed_index():
            nonlocal calls
            calls+=1
            if calls==3:self.registry.write_bytes(changed)
        with patch.object(imp,'assert_stopped',side_effect=changed_index):
            with self.assertRaisesRegex(RuntimeError,'索引已变化'):imp.import_draft(self.pkg,self.root)
        self.assertEqual(self.registry.read_bytes(),changed)
        self.assertEqual([p.name for p in self.root.iterdir() if p.is_dir()],['old'])
    def test_concurrent_import_lock(self):
        with imp.import_lock(self.root):
            with self.assertRaises((RuntimeError,BlockingIOError)):imp.import_draft(self.pkg,self.root)
        self.assertEqual(self.registry.read_bytes(),self.before)
    def test_missing_or_external_media_is_rejected(self):
        (self.pkg/'Resources'/'声音.wav').unlink()
        with self.assertRaisesRegex(ValueError,'素材缺失'):imp.import_draft(self.pkg,self.root)
        self.assertEqual(self.registry.read_bytes(),self.before)

if __name__=='__main__':unittest.main()
