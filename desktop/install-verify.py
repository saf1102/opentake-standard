"""Read-only installation check, run with the staged, bundled Python (-I -S -B)."""
import hashlib,json,os,pathlib,stat,sys

def verify(root):
    root=pathlib.Path(root).resolve(strict=True)
    manifest=json.loads((root/'opentake-payload.json').read_text(encoding='utf-8'))
    if manifest.get('format')!='opentake.windows.payload' or manifest.get('version')!=1:
        raise ValueError('unsupported payload manifest')
    expected={}
    for row in manifest['files']:
        name=row['path'];rel=pathlib.PurePosixPath(name)
        if rel.is_absolute() or '..' in rel.parts or '\\' in name or ':' in name or name in expected or rel.as_posix()!=name:
            raise ValueError('invalid payload path')
        if not isinstance(row['bytes'],int) or row['bytes']<0:raise ValueError('invalid file size')
        expected[name]=row
    if len(expected)!=manifest['fileCount'] or sum(row['bytes'] for row in expected.values())!=manifest['totalBytes']:
        raise ValueError('manifest totals differ')
    actual={}
    def scan(folder):
        with os.scandir(folder) as entries:
            for entry in entries:
                if entry.is_symlink() or (hasattr(entry,'is_junction') and entry.is_junction()):raise ValueError('payload contains a link')
                if entry.is_dir(follow_symlinks=False):scan(entry.path)
                else:
                    info=entry.stat(follow_symlinks=False)
                    if not stat.S_ISREG(info.st_mode):raise ValueError('payload contains a non-file')
                    actual[pathlib.Path(entry.path).relative_to(root).as_posix()]=info.st_size
    scan(root)
    if set(actual)!=set(expected)|{'opentake-payload.json'}:raise ValueError('payload file list differs')
    hashes=0
    for name,row in expected.items():
        if actual[name]!=row['bytes']:raise ValueError('file size differs: '+name)
        if 'sha256' in row:
            with root.joinpath(*pathlib.PurePosixPath(name).parts).open('rb') as stream:
                digest=hashlib.file_digest(stream,'sha256').hexdigest()
            if digest!=row['sha256']:raise ValueError('critical file hash differs: '+name)
            hashes+=1
    return len(expected),hashes

if __name__=='__main__':
    try:
        count,hashes=verify(sys.argv[1]);print(f'Payload verified: {count} files, {hashes} critical SHA256 hashes.')
    except Exception as error:
        print('Payload verification failed: '+str(error).encode('ascii','backslashreplace').decode('ascii'));sys.exit(2)
