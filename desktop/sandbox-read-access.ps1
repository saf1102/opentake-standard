param([Parameter(Mandatory=$true)][string]$InstallationRoot)
$ErrorActionPreference='Stop'
# Only the installed application tree. Never change ancestors, user profiles,
# projects, group membership, deny rules, or the sandbox's security policy.
$rootItem=Get-Item -LiteralPath $InstallationRoot -Force
if(-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid installation directory'}
$root=$rootItem.FullName
$package=Get-Content -LiteralPath (Join-Path $root 'resources\app\package.json') -Raw | ConvertFrom-Json
$manifest=Get-Content -LiteralPath (Join-Path $root 'opentake-payload.json') -Raw | ConvertFrom-Json
if($package.name -ne 'opentake-standard' -or $manifest.format -ne 'opentake.windows.payload'){throw 'Not an OpenTake installation'}
try{$sid=([Security.Principal.NTAccount]::new($env:COMPUTERNAME,'CodexSandboxUsers')).Translate([Security.Principal.SecurityIdentifier])}
catch [Security.Principal.IdentityNotMappedException] {Write-Output 'Sandbox group is not provisioned; application installation remains usable.';exit 0}
$acl=Get-Acl -LiteralPath $root
$rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute
$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$existing=@($acl.Access | Where-Object {
 $_.AccessControlType -eq 'Allow' -and $_.PropagationFlags -eq 'None' -and
 ($_.FileSystemRights -band $rights) -eq $rights -and ($_.InheritanceFlags -band $inherit) -eq $inherit -and
 $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value
})
if($existing.Count){Write-Output 'Sandbox application read/execute access is present.';exit 0}
# Refuse a link anywhere in this tree before Windows propagates an inheritable
# ACE. Read-only enumeration avoids traversing any junctions.
$pending=[Collections.Generic.Stack[string]]::new();$pending.Push($root)
while($pending.Count){foreach($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force){
 if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Installation contains a reparse point; access was not changed'}
 if($entry.PSIsContainer){$pending.Push($entry.FullName)}
}}
$before=$acl.Sddl
$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
# Set only the DACL. Set-Acl can also attempt to write SACL/owner information
# from Get-Acl and require SeSecurityPrivilege for an ordinary user install.
if(-not ('OpenTakeInstallAcl' -as [type])){Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenTakeInstallAcl {
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
 private static extern uint SetNamedSecurityInfo(string name, uint type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
 public static void Apply(string path, byte[] acl) {
  IntPtr p=Marshal.AllocHGlobal(acl.Length);
  try { Marshal.Copy(acl,0,p,acl.Length);uint result=SetNamedSecurityInfo(path,1,4,IntPtr.Zero,IntPtr.Zero,p,IntPtr.Zero);if(result!=0)throw new System.ComponentModel.Win32Exception((int)result); }
  finally { Marshal.FreeHGlobal(p); }
 }
}
'@}
$raw=[Security.AccessControl.RawSecurityDescriptor]::new($acl.Sddl)
$dacl=[byte[]]::new($raw.DiscretionaryAcl.BinaryLength)
$raw.DiscretionaryAcl.GetBinaryForm($dacl,0)
[OpenTakeInstallAcl]::Apply($root,$dacl)
$after=(Get-Acl -LiteralPath $root).Sddl
@{version=1;scope='application-files-only';rights='ReadAndExecute';before=$before;after=$after;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'sandbox-read-access.json') -Encoding UTF8
Write-Output 'Sandbox application read/execute access configured; no write access granted.'
