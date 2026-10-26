Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!include StrFunc.nsh
${StrCase}
${StrLoc}
Name "Perfboard repository guard tests"
OutFile "__OUTFILE__"
RequestExecutionLevel user
SilentInstall silent
Var RepositoryPath
Var RepositoryExitCode
Var RepositoryCreate
Var Failures
Var TestLog
LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
LangString RepositoryBadPath 1033 "bad path"
LangString RepositoryOverlap 1033 "overlap"
LangString RepositoryReparse 1033 "reparse"
LangString RepositoryNotEmpty 1033 "not empty"
LangString RepositoryMissing 1033 "missing db"
__GUARD__
!macro AssertRepository label path mode expected
  StrCpy $RepositoryPath "${path}"
  StrCpy $RepositoryCreate ${mode}
  Call PerfboardRepositoryCheck
  FileWriteUTF16LE $TestLog "${label}: expected=${expected} actual=$RepositoryExitCode reason=$0 normalized=$RepositoryPath$\r$\n"
  ${If} $RepositoryExitCode != ${expected}
    IntOp $Failures $Failures + 1
  ${EndIf}
!macroend
Section
  StrCpy $INSTDIR "__FIXTURE__\program"
  StrCpy $Failures 0
  FileOpen $TestLog "__LOGFILE__" w
  !insertmacro AssertRepository "relative" "relative\repository" 1 1
  !insertmacro AssertRepository "root" "C:\" 1 1
  !insertmacro AssertRepository "same as program" "$INSTDIR" 1 1
  !insertmacro AssertRepository "inside program" "$INSTDIR\repo" 1 1
  !insertmacro AssertRepository "contains program" "__FIXTURE__" 1 1
  !insertmacro AssertRepository "new empty" "__FIXTURE__\new empty" 1 0
  !insertmacro AssertRepository "Unicode and spaces" "__FIXTURE__\新仓库 with spaces" 1 0
  !insertmacro AssertRepository "new nonempty" "__FIXTURE__\not-empty" 1 1
  !insertmacro AssertRepository "existing missing db" "__FIXTURE__\absent" 0 1
  !insertmacro AssertRepository "file" "__FIXTURE__\is-file.txt" 1 1
  !insertmacro AssertRepository "trailing slash" "__FIXTURE__\new empty\" 1 0
  !insertmacro AssertRepository "normalized overlap" "$INSTDIR\..\program\repo" 1 1
  !insertmacro AssertRepository "quote injection" "__FIXTURE__\bad$\"quote" 1 1
  ${StrCase} $0 "$INSTDIR" "U"
  !insertmacro AssertRepository "casefold overlap" "$0\repo" 1 1
  !insertmacro AssertRepository "junction ancestor" "__FIXTURE__\junction\repo" 1 1
  FileWriteUTF16LE $TestLog "failures=$Failures$\r$\n"
  FileClose $TestLog
  SetErrorLevel $Failures
SectionEnd




