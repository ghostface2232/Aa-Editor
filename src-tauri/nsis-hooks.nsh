!macro NSIS_HOOK_POSTINSTALL
  ; Ensure uninstaller icon is set in Add/Remove Programs
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
!macroend
