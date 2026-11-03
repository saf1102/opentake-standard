"""No GUI or network access: validate the packaged draft builder and MediaInfo DLL."""
import sys
from pathlib import Path
sys.dont_write_bytecode = True
if len(sys.argv) > 1 and sys.argv[1]:
    sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
import importlib.metadata
import pyJianYingDraft as jy
from pymediainfo import MediaInfo
import imageio
import numpy
import PIL
assert importlib.metadata.version('pyjianyingdraft') == '0.3.0', 'Unsupported draft builder version'
assert MediaInfo.can_parse(), 'MediaInfo runtime unavailable'
assert hasattr(jy, 'TrackSpec') and hasattr(jy, 'ScriptFile')
print('JIANYING_RUNTIME_OK')
