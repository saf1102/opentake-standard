$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('opentake-acl-test-'+[Guid]::NewGuid().ToString('N'))
$appRoot=Join-Path $root 'OpenTake 中文 空格'
$app=Join-Path $appRoot 'resources\app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
'{"name":"opentake-standard"}' | Set-Content -LiteralPath (Join-Path $app 'package.json')
'{"format":"opentake.windows.payload"}' | Set-Content -LiteralPath (Join-Path $appRoot 'opentake-payload.json')
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner($sid)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $appRoot -AclObject $acl
$outsideBefore=(Get-Acl -LiteralPath $root).Sddl
try{
 & (Join-Path $PSScriptRoot '..\..\runtime-payload\python\python.exe') -I -S -B (Join-Path $PSScriptRoot 'sandbox-read-access.py') $appRoot
 if($LASTEXITCODE -ne 0){throw 'Application access configuration failed'}
 $group=([Security.Principal.NTAccount]::new($env:COMPUTERNAME,'CodexSandboxUsers')).Translate([Security.Principal.SecurityIdentifier])
 foreach($target in @($appRoot,(Join-Path $app 'package.json'))){
  $rules=@((Get-Acl -LiteralPath $target).Access | Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $group.Value})
  if(-not $rules.Count){throw 'Sandbox read rule missing from application descendant'}
  foreach($rule in $rules){if($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write){throw 'Unexpected sandbox write access'}}
 }
 $first=(Get-Acl -LiteralPath $appRoot).Sddl
 & (Join-Path $PSScriptRoot '..\..\runtime-payload\python\python.exe') -I -S -B (Join-Path $PSScriptRoot 'sandbox-read-access.py') $appRoot
 if($LASTEXITCODE -ne 0){throw 'Application access recheck failed'}
 if((Get-Acl -LiteralPath $appRoot).Sddl -ne $first){throw 'Permission update is not idempotent'}
 if((Get-Acl -LiteralPath $root).Sddl -ne $outsideBefore){throw 'Parent directory permissions changed'}
 Write-Output 'PASS application-only inherited RX, existing owner preserved, repeat/upgrade idempotent, parent unchanged'
}finally{
 $resolved=[IO.Path]::GetFullPath($root)
 if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne [IO.Path]::GetTempPath().TrimEnd('\') -or -not ([IO.Path]::GetFileName($resolved).StartsWith('opentake-acl-test-'))){throw 'Refusing unexpected cleanup directory'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
