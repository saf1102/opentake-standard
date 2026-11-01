!include nsDialogs.nsh
!ifndef BUILD_UNINSTALLER
Var otDialog
Var otLabel
Var otStage
Var otFind
Var otItem
Var otResult
Var otCheckOutput
Var otRenameAttempt
!endif

; The upstream installer resolves helper includes from its current compile directory.
; Keep upstream templates available while selecting our small extraction override.
!macro customHeader
  !addincludedir "${PROJECT_DIR}\node_modules\app-builder-lib\templates\nsis"
  !cd "${PROJECT_DIR}\desktop\nsis"
  SetFont "Microsoft YaHei UI" 9
  ShowInstDetails show
  !ifndef BUILD_UNINSTALLER
    !insertmacro OpenTakeInstallerFunctions
  !endif
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "安装 OpenTake Standard"
  !define MUI_WELCOMEPAGE_TEXT "版本 ${VERSION}$\r$\n$\r$\n为当前用户安装应用和完整离线组件。$\r$\n$\r$\n安装步骤$\r$\n1. 选择安装位置$\r$\n2. 解压应用与离线组件（显示实际进度）$\r$\n3. 核对文件并创建应用入口$\r$\n4. 完成安装并启动$\r$\n$\r$\n安装过程无需下载依赖，卸载时保留工程和设置。"
  !define MUI_FINISHPAGE_TITLE "安装完成 · 第 4/4 步"
  !define MUI_FINISHPAGE_TEXT "OpenTake Standard ${VERSION} 和离线组件已安装。$\r$\n$\r$\n现在可以录制、编辑并导出视频。AI 生成功能需要你自行完成 Codex 登录。$\r$\n$\r$\n点击「完成」退出向导。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom OpenTakeComponentsPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW OpenTakeInstallShow
!macroend

!macro OpenTakeInstallerFunctions
Function OpenTakeComponentsPage
  !insertmacro MUI_HEADER_TEXT "准备安装" "确认安装内容 · 完整离线安装"
  nsDialogs::Create 1018
  Pop $otDialog
  ${If} $otDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0u 0u 100% 14u "OpenTake Standard ${VERSION}"
  Pop $otLabel
  SetCtlColors $otLabel 0x705000 transparent
  ${NSD_CreateLabel} 0u 22u 100% 12u "应用与录屏运镜编辑器"
  Pop $otLabel
  ${NSD_CreateLabel} 0u 37u 100% 12u "OpenScreen · 原生录制与运镜导出"
  Pop $otLabel
  ${NSD_CreateLabel} 0u 52u 100% 12u "FFmpeg / ffprobe · 视频处理"
  Pop $otLabel
  ${NSD_CreateLabel} 0u 67u 100% 12u "Python 科学计算库 · 素材分析与声音处理"
  Pop $otLabel
  ${NSD_CreateLabel} 0u 82u 100% 12u "Chromium · 页面预览与渲染"
  Pop $otLabel
  ${NSD_CreateLabel} 0u 97u 100% 12u "Codex CLI · 使用你的账号生成视频"
  Pop $otLabel
  ${NSD_CreateLabel} 0u 116u 100% 24u "安装位置：$INSTDIR"
  Pop $otLabel
  nsDialogs::Show
FunctionEnd

Function OpenTakeInstallShow
  SetDetailsView show
  !insertmacro MUI_HEADER_TEXT "正在安装 OpenTake Standard" "第 2/4 步 · 解压应用与完整离线组件"
FunctionEnd

Function OpenTakePromotePayload
  ; Staging is a unique directory inside INSTDIR: every rename stays on the target volume.
  ; Never fall back to overwriting existing files or copying/deleting an unrelated directory.
  StrCpy $otResult "0"
otFindNextItem:
  ClearErrors
  FindFirst $otFind $otItem "$otStage\*"
otSkipDots:
  ${If} $otItem == "."
  ${OrIf} $otItem == ".."
    FindNext $otFind $otItem
    Goto otSkipDots
  ${EndIf}
  ${If} $otItem == ""
    FindClose $otFind
    ClearErrors
    RMDir "$otStage"
    IfErrors otPromoteFailed
    Return
  ${EndIf}
  FindClose $otFind
  StrCpy $otRenameAttempt "0"
otRenameItem:
  ClearErrors
  Rename "$otStage\$otItem" "$INSTDIR\$otItem"
  IfErrors 0 otFindNextItem
  IntOp $otRenameAttempt $otRenameAttempt + 1
  IntCmp $otRenameAttempt 6 otPromoteFailed
  Sleep 250
  Goto otRenameItem
otPromoteFailed:
  StrCpy $otResult "2"
  StrCpy $otCheckOutput "无法移动安装文件：$otItem。已有文件未覆盖。"
FunctionEnd
!macroend

; Assisted offline installer: completion remains open until the user clicks Finish.
!macro customInit
  !ifndef BUILD_UNINSTALLER
    StrCpy $otCheckOutput ""
  !endif
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  ; Fail visibly instead of leaving a shortcut to an incomplete installation.
  ${IfNot} ${FileExists} "$INSTDIR\resources\runtimes\manifest.json"
    IfSilent +2 0
      MessageBox MB_ICONSTOP|MB_OK "运行库安装不完整，请保留安装包并重新安装。"
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\opentake-payload.json"
    SetErrorLevel 2
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "安装文件已就绪" "第 3/4 步 · 应用入口已创建，即将完成"
  FileOpen $R0 "$INSTDIR\installation-result.txt" w
  FileWrite $R0 "OpenTake Standard$\r$\nOffline runtime files installed.$\r$\nScope: current user. Projects and settings are preserved on uninstall.$\r$\n"
  FileClose $R0
!macroend
