# Official source ZIP only: reject links, traversal, duplicates and decompression bombs before extracting.
import zipfile,sys,pathlib,stat
src,out=sys.argv[1:];root=pathlib.Path(out);seen=set();total=0
with zipfile.ZipFile(src) as z:
 for i in z.infolist():
  p=pathlib.PurePosixPath(i.filename);total+=i.file_size
  if not p.parts or p.parts[0]!='opentake-standard' or p.is_absolute() or '..' in p.parts or '\\' in i.filename or ':' in i.filename or stat.S_ISLNK(i.external_attr>>16) or i.filename.casefold() in seen or total>1024*1024*1024:raise ValueError('unsafe source ZIP')
  seen.add(i.filename.casefold())
  if any(x in ['.git','node_modules'] for x in p.parts):raise ValueError('unexpected source content')
 root.mkdir(parents=True,exist_ok=False)
 z.extractall(root)
print(root/'opentake-standard')
