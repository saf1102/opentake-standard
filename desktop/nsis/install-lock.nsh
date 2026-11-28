; 两版（Standard、Pro）共用的升级保护。
; 1. 升级前先确认安装目录没被占用：常见是 OpenTake 打开过的登录/安装终端窗口还开着，当前目录落在 resources 里。
;    不先查的话，旧版卸载会删掉大部分文件、留下被占用的 resources，新文件又搬不进去，软件就成了半成品。
; 2. 搬新文件时，安装目录里已有同名项目（上次失败留下的）先挪进备份目录，重装可以自愈。
!ifndef OT_LOCK_SILENT_TRIES
  !define OT_LOCK_SILENT_TRIES 120 ; 静默升级：每 0.5 秒一次，最多等 60 秒（软件刚退出时文件可能还没释放）
!endif
Var otLockTry
Var otBackup

; 同盘改名、不覆盖已有文件（与安装程序搬移文件同一种调用）。成功时 $0 非 0。
!macro OT_MOVE FROM TO
  System::Call 'kernel32::MoveFileW(w "${FROM}", w "${TO}") i.r0 ?e'
  Pop $1
!macroend

Function OpenTakeWaitUnlocked
  StrCpy $otLockTry "0"
otLockCheck:
  IfFileExists "$INSTDIR\resources\*.*" 0 otLockFree
  !insertmacro OT_MOVE "$INSTDIR\resources" "$INSTDIR\resources.ot-lock-check"
  IntCmp $0 0 otLockBusy
  StrCpy $otLockTry "0"
otLockRestore:
  !insertmacro OT_MOVE "$INSTDIR\resources.ot-lock-check" "$INSTDIR\resources"
  IntCmp $0 0 0 otLockFree otLockFree
  IntOp $otLockTry $otLockTry + 1
  IntCmp $otLockTry 40 otLockFree
  Sleep 250
  Goto otLockRestore
otLockBusy:
  IntOp $otLockTry $otLockTry + 1
  IfSilent otLockSilent
  IntCmp $otLockTry 6 otLockAsk otLockShortWait otLockAsk
otLockShortWait:
  Sleep 500
  Goto otLockCheck
otLockAsk:
  MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "OpenTake 的安装目录正被占用，现在安装会失败。$\r$\n$\r$\n请先退出 OpenTake，并关闭它打开过的登录或安装终端窗口（PowerShell / 终端），然后点「重试」。$\r$\n$\r$\n已安装的版本没有改动。" IDRETRY otLockRetry
  SetErrorLevel 2
  Quit
otLockRetry:
  StrCpy $otLockTry "0"
  Goto otLockCheck
otLockSilent:
  IntCmp $otLockTry ${OT_LOCK_SILENT_TRIES} otLockGiveUp 0 otLockGiveUp
  Sleep 500
  Goto otLockCheck
otLockGiveUp:
  SetErrorLevel 2
  Quit
otLockFree:
FunctionEnd

; 输入 $otItem（暂存目录里的一个顶层项目名）。安装目录已有同名项目时挪进备份目录。
; 输出 $otResult："0" 成功；"2" 失败，$otCheckOutput 写明原因。
Function OpenTakeMoveAside
  StrCpy $otResult "0"
  IfFileExists "$INSTDIR\$otItem\*.*" otAsideStart
  IfFileExists "$INSTDIR\$otItem" otAsideStart otAsideDone
otAsideStart:
  StrCmp $otBackup "" 0 otAsideHaveDir
  GetTempFileName $otBackup "$INSTDIR"
  Delete "$otBackup"
  CreateDirectory "$otBackup"
otAsideHaveDir:
  StrCpy $otLockTry "0"
otAsideTry:
  !insertmacro OT_MOVE "$INSTDIR\$otItem" "$otBackup\$otItem"
  IntCmp $0 0 0 otAsideDone otAsideDone
  IntOp $otLockTry $otLockTry + 1
  IntCmp $otLockTry 40 otAsideFailed
  Sleep 250
  Goto otAsideTry
otAsideFailed:
  StrCpy $otResult "2"
  StrCpy $otCheckOutput "无法替换旧文件：$otItem，它正被占用。请退出 OpenTake 并关闭它打开过的终端窗口，然后重新安装。"
otAsideDone:
FunctionEnd

; 全部搬完后删掉备份目录（里面只有被替换下来的旧文件）。
Function OpenTakeDropBackup
  StrCmp $otBackup "" otDropDone
  RMDir /r "$otBackup"
  StrCpy $otBackup ""
otDropDone:
FunctionEnd
