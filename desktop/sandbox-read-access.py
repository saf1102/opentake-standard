"""Grant the existing local Codex sandbox group RX on this installation only.

No PowerShell execution-policy dependency, account setup, ancestor changes,
owner/SACL changes, write grants, or changes to the sandbox policy.
"""
import ctypes as C
from ctypes import wintypes as W
import datetime,json,os,pathlib,struct,sys

RX=0x1200A9
class Trustee(C.Structure):
    _fields_=[('multiple',C.c_void_p),('operation',C.c_int),('form',C.c_int),('kind',C.c_int),('name',C.c_void_p)]
class ExplicitAccess(C.Structure):
    _fields_=[('permissions',W.DWORD),('mode',C.c_int),('inheritance',W.DWORD),('trustee',Trustee)]

def configure(root):
    root=pathlib.Path(root).absolute()
    if root.is_symlink() or root.is_junction() or not root.is_dir():raise ValueError('Invalid installation directory')
    package=json.loads((root/'resources/app/package.json').read_text(encoding='utf-8-sig'))
    manifest=json.loads((root/'opentake-payload.json').read_text(encoding='utf-8-sig'))
    if package.get('name')!='opentake-standard' or manifest.get('format')!='opentake.windows.payload':raise ValueError('Not an OpenTake installation')
    api=C.WinDLL('advapi32',use_last_error=True);kernel=C.WinDLL('kernel32',use_last_error=True)
    api.LookupAccountNameW.argtypes=[W.LPCWSTR,W.LPCWSTR,C.c_void_p,C.POINTER(W.DWORD),W.LPWSTR,C.POINTER(W.DWORD),C.POINTER(W.DWORD)]
    api.GetNamedSecurityInfoW.argtypes=[W.LPWSTR,C.c_int,W.DWORD,C.c_void_p,C.c_void_p,C.POINTER(C.c_void_p),C.c_void_p,C.POINTER(C.c_void_p)]
    api.SetNamedSecurityInfoW.argtypes=[W.LPWSTR,C.c_int,W.DWORD,C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p]
    api.SetEntriesInAclW.argtypes=[W.ULONG,C.POINTER(ExplicitAccess),C.c_void_p,C.POINTER(C.c_void_p)]
    api.GetAce.argtypes=[C.c_void_p,W.DWORD,C.POINTER(C.c_void_p)]
    api.EqualSid.argtypes=[C.c_void_p,C.c_void_p]
    api.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes=[C.c_void_p,W.DWORD,W.DWORD,C.POINTER(C.c_void_p),C.c_void_p]
    kernel.LocalFree.argtypes=[C.c_void_p];kernel.LocalFree.restype=C.c_void_p
    account=os.environ['COMPUTERNAME']+'\\CodexSandboxUsers'
    size,domain_size,kind=W.DWORD(),W.DWORD(),W.DWORD()
    api.LookupAccountNameW(None,account,None,C.byref(size),None,C.byref(domain_size),C.byref(kind))
    if C.get_last_error()==1332:return {'status':'group-not-provisioned'}
    if not size.value:raise C.WinError()
    sid=C.create_string_buffer(size.value);domain=C.create_unicode_buffer(domain_size.value)
    if not api.LookupAccountNameW(None,account,sid,C.byref(size),domain,C.byref(domain_size),C.byref(kind)):raise C.WinError()
    dacl,sd,new_dacl=C.c_void_p(),C.c_void_p(),C.c_void_p()
    def check(code):
        if code:raise C.WinError(code)
    def sddl(descriptor):
        text=C.c_void_p()
        if not api.ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor,1,4,C.byref(text),None):raise C.WinError()
        try:return C.wstring_at(text)
        finally:kernel.LocalFree(text)
    check(api.GetNamedSecurityInfoW(str(root),1,4,None,None,C.byref(dacl),None,C.byref(sd)))
    try:
        if not dacl.value:raise ValueError('Refusing to alter an unrestricted/null DACL')
        count=struct.unpack('<BBHHH',C.string_at(dacl,8))[3]
        for index in range(count):
            ace=C.c_void_p()
            if not api.GetAce(dacl,index,C.byref(ace)):raise C.WinError()
            ace_type,flags,_,mask=struct.unpack('<BBHI',C.string_at(ace,8))
            if ace_type==0 and flags&3==3 and not flags&8 and mask&RX==RX and api.EqualSid(ace.value+8,sid):
                return {'status':'already-present','rights':'ReadAndExecute'}
        # SetNamedSecurityInfo propagates inheritable entries to descendants.
        # Reject reparse points first so it cannot grant access outside the app.
        pending=[root]
        while pending:
            for child in pending.pop().iterdir():
                if child.is_symlink() or child.is_junction():raise ValueError('Installation contains a reparse point; access was not changed')
                if child.is_dir():pending.append(child)
        before=sddl(sd)
        rule=ExplicitAccess(RX,1,3,Trustee(None,0,0,2,C.cast(sid,C.c_void_p)))
        check(api.SetEntriesInAclW(1,C.byref(rule),dacl,C.byref(new_dacl)))
        check(api.SetNamedSecurityInfoW(str(root),1,4,None,None,new_dacl,None))
        report={'version':1,'status':'configured','scope':'application-files-only','rights':'ReadAndExecute','beforeDacl':before,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        (root/'sandbox-read-access.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        return {'status':'configured','rights':'ReadAndExecute'}
    finally:
        if new_dacl.value:kernel.LocalFree(new_dacl)
        if sd.value:kernel.LocalFree(sd)

if __name__=='__main__':
    try:print(json.dumps(configure(sys.argv[1])))
    except Exception as error:print('Sandbox application access configuration failed: '+str(error));sys.exit(2)
