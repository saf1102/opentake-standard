; Reuse the pinned electron-builder 26.15.3 package selection and 7z handling.
; Only the final promotion changes: same-volume top-level renames replace a full recursive copy.
!include "${PROJECT_DIR}\node_modules\app-builder-lib\templates\nsis\include\extractAppPackage.nsh"
!macroundef extractUsing7za
!macro extractUsing7za FILE
  GetTempFileName $otStage "$INSTDIR"
  Delete "$otStage"
  CreateDirectory "$otStage"
  SetOutPath "$otStage"
  ClearErrors
  Nsis7z::ExtractWithDetails "${FILE}" "第 2/4 步 · 解压应用与离线组件 %s"
  IfErrors otExtractFailed
  !insertmacro MUI_HEADER_TEXT "核对安装文件" "第 3/4 步 · 检查组件并写入安装目录"
  DetailPrint "正在核对安装文件；此步骤不需要联网。"
  nsExec::ExecToStack /TIMEOUT=120000 '"$otStage\resources\runtimes\python\python.exe" -I -S -B "$otStage\resources\app\desktop\install-verify.py" "$otStage"'
  Pop $otResult
  Pop $otCheckOutput
  StrCmp $otResult "0" 0 otExtractFailed
  DetailPrint "$otCheckOutput"
  SetOutPath "$INSTDIR"
  Call OpenTakePromotePayload
  StrCmp $otResult "0" 0 otExtractFailed
  SetOutPath "$INSTDIR"
  Goto otExtractDone
otExtractFailed:
  SetOutPath "$INSTDIR"
  DetailPrint "安装文件处理失败：$otCheckOutput"
  IfSilent +2 0
    MessageBox MB_ICONSTOP|MB_OK "安装未完成，已保留临时文件。请检查可用空间和文件占用后重试。$\r$\n$otCheckOutput$\r$\n临时目录：$otStage"
  SetErrorLevel 2
  Abort
otExtractDone:
!macroend
