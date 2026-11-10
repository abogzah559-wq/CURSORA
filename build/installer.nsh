; CURSORA uninstaller: the applied cursor lives in %LOCALAPPDATA%\CursoraCursors and stays after uninstall.
; Ask (only on a real, interactive uninstall — not during updates) whether to restore the previous cursor.
!include "FileFunc.nsh"

!macro customUnInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${If} ${Errors}
    IfSilent cursora_skip
    MessageBox MB_YESNO|MB_ICONQUESTION "تبي ترجع الماوس السابق قبل الحذف؟$\r$\n(لو اخترت لا، يبقى ماوس CURSORA شغّال بعد الحذف)$\r$\n$\r$\nRestore your previous cursor before uninstalling?$\r$\n(No = keep the CURSORA cursor after uninstall)" /SD IDNO IDNO cursora_skip
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --restore=backup'
    cursora_skip:
  ${EndIf}
!macroend
