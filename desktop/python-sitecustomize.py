"""Application-local embed Python: normal script imports without user site packages."""
import os
import sys

sys.dont_write_bytecode = True
_entry = sys.argv[0] if sys.argv else ""
_script_dir = os.path.dirname(os.path.abspath(_entry)) if _entry and not _entry.startswith("-") else os.getcwd()
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)
