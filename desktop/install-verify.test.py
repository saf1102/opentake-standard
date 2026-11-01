import hashlib,importlib.util,json,pathlib,shutil,tempfile,unittest
spec=importlib.util.spec_from_file_location('payload_verify',pathlib.Path(__file__).with_name('install-verify.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class VerifyPayload(unittest.TestCase):
    def setUp(self):
        self.root=pathlib.Path(tempfile.mkdtemp(prefix='opentake-install-check-')).resolve()
        self.file=self.root/'部件 中文 空格.bin';self.file.write_bytes(b'correct bytes')
        self.manifest={'format':'opentake.windows.payload','version':1,'fileCount':1,'totalBytes':13,'files':[{'path':self.file.name,'bytes':13,'sha256':hashlib.sha256(b'correct bytes').hexdigest()}]}
        self.write_manifest()
    def write_manifest(self):(self.root/'opentake-payload.json').write_text(json.dumps(self.manifest),encoding='utf-8')
    def tearDown(self):
        self.assertEqual(self.root.parent,pathlib.Path(tempfile.gettempdir()).resolve());self.assertTrue(self.root.name.startswith('opentake-install-check-'));shutil.rmtree(self.root)
    def test_valid_unicode_payload_is_read_only(self):
        before=self.file.read_bytes();self.assertEqual(module.verify(self.root),(1,1));self.assertEqual(self.file.read_bytes(),before);self.assertEqual(len(list(self.root.iterdir())),2)
    def test_missing_file(self):
        self.file.unlink()
        with self.assertRaisesRegex(ValueError,'file list'):module.verify(self.root)
    def test_same_length_critical_corruption(self):
        self.file.write_bytes(b'corrupt bytes')
        with self.assertRaisesRegex(ValueError,'hash differs'):module.verify(self.root)
    def test_extra_file(self):
        (self.root/'unexpected.txt').write_text('extra')
        with self.assertRaisesRegex(ValueError,'file list'):module.verify(self.root)
    def test_path_traversal_is_rejected_before_reading_files(self):
        self.manifest['files'][0]['path']='../outside.bin';self.write_manifest()
        with self.assertRaisesRegex(ValueError,'invalid payload path'):module.verify(self.root)

if __name__=='__main__':unittest.main()
