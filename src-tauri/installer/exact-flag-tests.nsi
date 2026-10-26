Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
Name "Perfboard exact flag tests"
OutFile "__OUTFILE__"
RequestExecutionLevel user
SilentInstall silent
Var Failures
Var TestLog
__HELPER__
!macro ExpectRunFlag label command expected
  StrCpy $0 "register-preserved"
  Push `${command}`
  Call PerfboardParseRunFlag
  FileWriteUTF16LE $TestLog "${label}: expected=${expected} actual=$PerfboardRunAfterInstall$\r$\n"
  ${If} $PerfboardRunAfterInstall != ${expected}
    IntOp $Failures $Failures + 1
  ${EndIf}
  ${If} $0 != "register-preserved"
    IntOp $Failures $Failures + 1
    FileWriteUTF16LE $TestLog "register preservation FAILED$\r$\n"
  ${EndIf}
!macroend
Section
  StrCpy $Failures 0
  FileOpen $TestLog "__LOGFILE__" w
  !insertmacro ExpectRunFlag "repository alone" 'setup.exe /S /NS /REPOSITORY="D:\repo path" /D=D:\install' 0
  !insertmacro ExpectRunFlag "reuse alone" 'setup.exe /S /REUSE' 0
  !insertmacro ExpectRunFlag "R before repository" 'setup.exe /R /REPOSITORY="D:\repo path"' 1
  !insertmacro ExpectRunFlag "R after repository" 'setup.exe /REPOSITORY="D:\repo path" /R' 1
  !insertmacro ExpectRunFlag "quoted executable and R" '"D:\tool space\setup.exe" /R' 1
  !insertmacro ExpectRunFlag "quoted Unicode args without R" 'setup.exe /ARGS "--message 中文 with spaces /R" /REPOSITORY="D:\新仓库 with spaces"' 0
  !insertmacro ExpectRunFlag "app argument equals R" 'setup.exe /ARGS "/R" /REUSE' 0
  !insertmacro ExpectRunFlag "R before quoted args" 'setup.exe /R /ARGS "--message 中文 with spaces" /REPOSITORY="D:\repo path"' 1
  !insertmacro ExpectRunFlag "R after quoted args" 'setup.exe /ARGS "--message 中文 with spaces" /REPOSITORY="D:\repo path" /R' 1
  !insertmacro ExpectRunFlag "long prefix" 'setup.exe /RUN /REPOSITORY=D:\repo /REUSE' 0
  !insertmacro ExpectRunFlag "lowercase flag" 'setup.exe /r /REPOSITORY=D:\repo' 1
  !insertmacro ExpectRunFlag "R inside quoted repository" 'setup.exe /REPOSITORY="D:\repo /R value"' 0
  FileWriteUTF16LE $TestLog "failures=$Failures$\r$\n"
  FileClose $TestLog
  SetErrorLevel $Failures
SectionEnd
