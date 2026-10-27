import hashlib,json,pathlib,stat,sys,zipfile
archive,snapshot,video=sys.argv[1:]
root=pathlib.Path(snapshot)
if not root.is_dir(): sys.exit(1)
def digest(stream):
 h=hashlib.sha256()
 for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.digest()
known={}
for p in root.rglob('*'):
 if p.is_file() and not p.is_symlink():
  with p.open('rb') as f:known[p.relative_to(root).as_posix()]=(p.stat().st_size,digest(f))
v=pathlib.Path(video)
if v.is_file():
 with v.open('rb') as f:known['out.mp4']=(v.stat().st_size,digest(f))
try:
 with zipfile.ZipFile(archive) as z:
  names=set(); files=0
  for i in z.infolist():
   n=i.filename; p=pathlib.PurePosixPath(n)
   if p.is_absolute() or '..' in p.parts or '\\' in n or n in names or stat.S_ISLNK(i.external_attr>>16):sys.exit(1)
   names.add(n)
   if i.is_dir():continue
   if n not in known or i.file_size!=known[n][0]:sys.exit(1)
   with z.open(i) as f:
    if digest(f)!=known[n][1]:sys.exit(1)
   files+=1
  if files==0 or 'index.html' not in names:sys.exit(1)
except Exception:sys.exit(1)
