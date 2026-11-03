$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$settings=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'import-runtime.json') -Raw -Encoding utf8|ConvertFrom-Json
$candidates=@($settings.python)
foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')){
 foreach($entry in @(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue|Where-Object DisplayName -eq 'OpenTake Standard')){
  if($entry.InstallLocation){$candidates+=Join-Path $entry.InstallLocation 'resources\runtimes\python\python.exe'}
  if($entry.DisplayIcon){$exe=($entry.DisplayIcon -replace ',\d+$','').Trim('"');$candidates+=Join-Path (Split-Path $exe) 'resources\runtimes\python\python.exe'}
 }
}
$python=$candidates|Where-Object {$_ -and (Test-Path -LiteralPath $_ -PathType Leaf)}|Select-Object -First 1
if(-not $python){throw '未找到 OpenTake 内置运行库。请先在这台电脑安装 OpenTake，再执行导入。'}
$draftRoot=Read-Host '请输入剪映草稿目录；直接回车使用自动检测或已保存的路径'
if(-not $draftRoot){$draftRoot=$settings.draftRoot}
if(-not $draftRoot){$draftRoot=Join-Path $env:LOCALAPPDATA 'JianyingPro\User Data\Projects\com.lveditor.draft'}
& $python -I -X utf8 (Join-Path $PSScriptRoot 'import-windows.py') $PSScriptRoot ($draftRoot.Trim('"'))
if($LASTEXITCODE -ne 0){throw '导入未完成，请按上面的提示处理。'}
Write-Output '导入完成，请重新打开剪映，在首页打开新草稿。'
