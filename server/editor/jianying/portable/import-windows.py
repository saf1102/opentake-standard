"""Import an exported bundle into a NEW draft. Never overwrite existing drafts.
Only stdlib is needed; this script also runs with OpenTake's embedded Python.
"""
import contextlib
import csv
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

def running():
    if sys.platform != 'win32':
        return False
    result = subprocess.run(['tasklist.exe', '/FO', 'CSV', '/NH'], capture_output=True,
                            timeout=15, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
    rows = csv.reader(io.StringIO(result.stdout.decode('utf-8', errors='replace')))
    return any(row and row[0].lower().startswith(('jianyingpro', 'jianying.exe')) for row in rows)

def assert_stopped():
    if running():
        raise RuntimeError('请先保存工程并退出剪映，再导入；现有草稿未修改。')

@contextlib.contextmanager
def import_lock(root):
    file = (root / '.opentake-import.lock').open('a+b')
    try:
        if file.tell() == 0:
            file.write(b'0'); file.flush()
        file.seek(0)
        if sys.platform == 'win32':
            import msvcrt
            try: msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError: raise RuntimeError('另一个导入正在进行，请稍后再试。')
        else:
            import fcntl
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        file.close()  # OS releases the lock even if the process crashes.

def read_json(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))

def write_json(file, data):
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.flush(); os.fsync(stream.fileno())

def plain_tree(folder):
    for entry in [folder, *folder.rglob('*')]:
        if entry.is_symlink() or getattr(entry, 'is_junction', lambda: False)():
            raise ValueError('导出素材包含链接，导入已停止：' + str(entry))

def import_draft(package, destination):
    package = Path(package).resolve(); root = Path(destination).resolve()
    registry = root / 'root_meta_info.json'
    if not root.is_dir() or not registry.is_file():
        raise ValueError('请选择包含 root_meta_info.json 的剪映草稿目录；可先在剪映创建一个空工程。')
    if package == root or package.is_relative_to(root):
        raise ValueError('请从导出的独立工程文件夹导入，不能使用现有剪映草稿作为来源。')
    assert_stopped()
    with import_lock(root):
        assert_stopped()
        before = registry.read_bytes(); index = json.loads(before.decode('utf-8-sig'))
        if not isinstance(index.get('all_draft_store'), list):
            raise ValueError('无法识别剪映草稿索引，未修改任何草稿。')
        content = read_json(package / 'draft_content.json'); meta = read_json(package / 'draft_meta_info.json')
        if not content.get('id') or not isinstance(content.get('materials'), dict):
            raise ValueError('导出草稿内容无效')
        resources = package / 'Resources'
        if not resources.is_dir(): raise ValueError('导出素材目录缺失')
        plain_tree(resources)
        identity = str(uuid.uuid4()).upper(); target = root / identity
        stage = root / ('.opentake-import-' + identity); temp_index = root / ('.opentake-index-' + identity + '.tmp')
        backup = root / ('root_meta_info.json.opentake-' + identity + '.bak')
        old = str(meta.get('draft_fold_path', '')).replace('\\', '/').rstrip('/')
        if not old: raise ValueError('导出草稿缺少来源路径')
        id_map = {str(content['id']): identity}
        uuid_pattern = re.compile(r'^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$')
        def rewrite(value, key=''):
            if isinstance(value, str):
                normalized = value.replace('\\', '/')
                if normalized.lower() == old.lower(): return str(target)
                if normalized.lower().startswith(old.lower() + '/'):
                    relative = normalized[len(old)+1:]
                    actual = (package / relative).resolve()
                    if not actual.is_relative_to(package): raise ValueError('素材路径越界')
                    return str(target / relative)
                if uuid_pattern.fullmatch(value) and key not in ('text','name','draft_name','title','material_name','extra_info'):
                    return id_map.setdefault(value, str(uuid.uuid4()).upper())
                return value
            if isinstance(value, list): return [rewrite(item,key) for item in value]
            if isinstance(value, dict):
                result={}
                for child_key,item in value.items():
                    # Native subtitle styles are a JSON string; their font paths must move too.
                    if child_key=='content' and isinstance(item,str):
                        try:
                            parsed=json.loads(item)
                            if isinstance(parsed,dict):
                                result[child_key]=json.dumps(rewrite(parsed),ensure_ascii=False);continue
                        except json.JSONDecodeError:pass
                    result[child_key]=rewrite(item,child_key)
                return result
            return value
        installed = False; committed = False
        try:
            stage.mkdir(); shutil.copytree(resources, stage / 'Resources')
            rewritten = rewrite(content); rewritten_meta = rewrite(meta)
            for group in rewritten['materials'].values():
                if not isinstance(group, list): continue
                for material in group:
                    if not isinstance(material, dict): continue
                    for key in ('path', 'font_path'):
                        value = material.get(key)
                        if not value: continue
                        reference = Path(value).resolve()
                        if not reference.is_relative_to(target): raise ValueError('草稿引用了未随包交付的素材：' + str(value))
                        if not (stage / reference.relative_to(target)).is_file(): raise ValueError('草稿素材缺失：' + str(value))
            now = time.time_ns() // 1000
            rewritten.update(id=identity, create_time=now//1000000, update_time=now//1000000)
            rewritten_meta.update(draft_id=identity, draft_fold_path=str(target), draft_root_path=str(root), tm_draft_create=now, tm_draft_modified=now)
            for name in ('draft_info.json', 'draft_content.json'): write_json(stage/name, rewritten)
            write_json(stage/'draft_meta_info.json', rewritten_meta)
            index['all_draft_store'].insert(0, dict(draft_id=identity, draft_name=meta.get('draft_name','OpenTake'),
                draft_fold_path=str(target), draft_root_path=str(root), draft_json_file=str(target/'draft_info.json'),
                draft_cover=str(target/'draft_cover.jpg'), draft_is_invisible=False, draft_is_cloud_temp_draft=False,
                cloud_draft_sync=False, streaming_edit_draft_ready=True, draft_type='', draft_new_version='',
                tm_draft_create=now, tm_draft_modified=now, tm_draft_removed=0, tm_duration=content['duration'],
                draft_timeline_materials_size=meta.get('draft_timeline_materials_size_',0)))
            if isinstance(index.get('draft_ids'),list): index['draft_ids'].append(identity)
            elif isinstance(index.get('draft_ids'),int): index['draft_ids'] += 1
            write_json(temp_index,index)
            assert_stopped()
            if registry.read_bytes() != before: raise RuntimeError('剪映草稿索引已变化，请退出剪映后重试。')
            with backup.open('xb') as stream: stream.write(before); stream.flush(); os.fsync(stream.fileno())
            stage.rename(target); installed = True
            assert_stopped()
            if registry.read_bytes() != before: raise RuntimeError('剪映草稿索引已变化，请重试。')
            os.replace(temp_index,registry); committed = True
            return dict(draft_id=identity, directory=str(target), backup=str(backup))
        finally:
            if not committed:
                assert stage.parent == root and target.parent == root
                if stage.exists(): shutil.rmtree(stage)
                if installed and target.exists(): shutil.rmtree(target)
            if temp_index.exists(): temp_index.unlink()

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3: raise ValueError('用法：import-windows.py 导出工程目录 剪映草稿目录')
        print(json.dumps(import_draft(sys.argv[1],sys.argv[2]),ensure_ascii=False))
    except Exception as error:
        print(str(error),file=sys.stderr); sys.exit(1)
