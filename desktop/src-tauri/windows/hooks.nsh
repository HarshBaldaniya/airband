; Airband's step in the Windows uninstaller: before the app's files go, it takes Airband out of
; every agent (skills, hooks, tools and the airband command). With "Delete the application data"
; ticked, ~/.airband goes too. Not when an update reinstalls the app.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ${If} $DeleteAppDataCheckboxState = 1
      nsExec::Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall --purge'
    ${Else}
      nsExec::Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall'
    ${EndIf}
    Pop $0
  ${EndIf}
!macroend
