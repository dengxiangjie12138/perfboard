Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!include StrFunc.nsh
${StrCase}
${StrLoc}
!define PRODUCTNAME "Perfboard"
!define MANUFACTURER "perfboard"
!define MAINBINARYNAME "perfboard"
Name "Perfboard isolated update-mode tests"
OutFile "__OUTFILE__"
RequestExecutionLevel user
SilentInstall silent
Var UpdateMode
Var PassiveMode
Var PerfboardInstallExitCode
Var RepositoryPath
Var RepositoryCreate
Var RepositorySelected
Var RepositoryExitCode
Var RegisteredDirectory
Var RegisteredLocation
Var RegisteredName
Var RegisteredPublisher
Var RegisteredBinary
Var RegisteredUninstaller
Var RepositoryPointer
Var RepositoryReads
Var RepositoryCalls
Var PointerWrites
Var Failures
Var Checks
Var TestLog
LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
LangString InstallationBadPath 1033 "bad install path"
LangString InstallationReparse 1033 "install reparse"
LangString UpdateRegistrationMissing 1033 "not registered"
LangString RepositoryBadPath 1033 "bad repository"
LangString RepositoryOverlap 1033 "overlap"
LangString RepositoryReparse 1033 "repository reparse"
LangString RepositoryNotEmpty 1033 "not empty"
LangString RepositoryMissing 1033 "missing db"
LangString RepositoryValidationFailed 1033 "validation failed"
LangString RepositoryInitializeFailed 1033 "initialization failed"
__HELPERS__
!macro Expect label actual expected
  IntOp $Checks $Checks + 1
  FileWriteUTF16LE $TestLog `${label}: expected=${expected} actual=${actual}$\r$\n`
  ${If} ${actual} != ${expected}
    IntOp $Failures $Failures + 1
  ${EndIf}
!macroend
!macro Registration path
  StrCpy $RegisteredDirectory '${path}'
  StrCpy $RegisteredLocation '$\"${path}$\"'
  StrCpy $RegisteredName "Perfboard"
  StrCpy $RegisteredPublisher "perfboard"
  StrCpy $RegisteredBinary "perfboard.exe"
  StrCpy $RegisteredUninstaller '$\"${path}\uninstall.exe$\"'
!macroend
!macro Install label path mode expected
  StrCpy $INSTDIR '${path}'
  StrCpy $UpdateMode ${mode}
  Call PerfboardInstallationPathCheck
  FileWriteUTF16LE $TestLog `install path=$INSTDIR reason=$0$\r$\n`
  !insertmacro Expect '${label}' '$PerfboardInstallExitCode' '${expected}'
!macroend
!macro UpdateFlag label command expected
  StrCpy $0 "preserved"
  Push '${command}'
  Call PerfboardParseUpdateFlag
  !insertmacro Expect '${label}' '$UpdateMode' '${expected}'
  !insertmacro Expect '${label} preserves registers' '$0' '"preserved"'
!macroend
!macro RepositoryBypass label path pointer
  StrCpy $UpdateMode 1
  StrCpy $PassiveMode 1
  StrCpy $RepositoryPath '${path}'
  StrCpy $RepositoryPointer '${pointer}'
  StrCpy $RepositoryReads 0
  StrCpy $RepositoryCalls 0
  StrCpy $PointerWrites 0
  Call PerfboardRepositoryInit
  Call PerfboardRepositoryCheck
  Call PerfboardRepositoryFinish
  !insertmacro Expect '${label} success' '$RepositoryExitCode' '0'
  !insertmacro Expect '${label} path unchanged' '$RepositoryPath' "'${path}'"
  !insertmacro Expect '${label} pointer unchanged' '$RepositoryPointer' "'${pointer}'"
  !insertmacro Expect '${label} no repository registry reads' '$RepositoryReads' '0'
  !insertmacro Expect '${label} no application/database calls' '$RepositoryCalls' '0'
  !insertmacro Expect '${label} no pointer writes' '$PointerWrites' '0'
!macroend
Section
  StrCpy $Failures 0
  StrCpy $Checks 0
  FileOpen $TestLog "__LOGFILE__" w
  !insertmacro UpdateFlag 'exact update' 'setup.exe /P /UPDATE /R' 1
  !insertmacro UpdateFlag 'lowercase update' 'setup.exe /update' 1
  !insertmacro UpdateFlag 'long prefix' 'setup.exe /UPDATER' 0
  !insertmacro UpdateFlag 'assignment' 'setup.exe /UPDATE=1' 0
  !insertmacro UpdateFlag 'quoted app argument' 'setup.exe /ARGS "/UPDATE"' 0
  !insertmacro UpdateFlag 'quoted repository' 'setup.exe /REPOSITORY="D:\repo /UPDATE value"' 0
  !insertmacro UpdateFlag 'update after app argument' 'setup.exe /ARGS "中文 with spaces" /UPDATE' 1
  !insertmacro UpdateFlag 'no update' 'setup.exe /P /REUSE' 0

  !insertmacro Registration '__FIXTURE__\program'
  !insertmacro Install 'normal new directory' '__FIXTURE__\new program' 0 0
  !insertmacro Install 'normal relative directory' 'relative\program' 0 1
  !insertmacro Install 'normal volume root' 'C:\' 0 1
  !insertmacro Install 'normal existing file' '__FIXTURE__\is-file.txt' 0 1
  ; NSIS sanitizes quotes when assigning INSTDIR, so test the raw normalizer input.
  Push '__FIXTURE__\bad$\"quote'
  Call PerfboardNormalizeInstallDirectory
  Pop $1
  !insertmacro Expect 'raw installation quote rejected' '$1' '""'
  !insertmacro Install 'normal junction ancestor' '__FIXTURE__\junction\program' 0 1
  !insertmacro Install 'registered update without repository' '__FIXTURE__\program' 1 0
  !insertmacro Install 'update junction ancestor' '__FIXTURE__\junction\program' 1 1
  !insertmacro Install 'update different target' '__FIXTURE__\other program' 1 1
  StrCpy $RegisteredDirectory ""
  !insertmacro Install 'missing product registration' '__FIXTURE__\program' 1 1
  !insertmacro Registration '__FIXTURE__\program'
  StrCpy $RegisteredLocation ""
  !insertmacro Install 'missing uninstall registration' '__FIXTURE__\program' 1 1
  StrCpy $RegisteredLocation '__FIXTURE__\other program'
  !insertmacro Install 'different uninstall location' '__FIXTURE__\program' 1 1
  !insertmacro Registration '__FIXTURE__\program'
  StrCpy $RegisteredName "Other app"
  !insertmacro Install 'wrong registered name' '__FIXTURE__\program' 1 1
  !insertmacro Registration '__FIXTURE__\program'
  StrCpy $RegisteredPublisher "Other publisher"
  !insertmacro Install 'wrong publisher' '__FIXTURE__\program' 1 1
  !insertmacro Registration '__FIXTURE__\program'
  StrCpy $RegisteredBinary "other.exe"
  !insertmacro Install 'wrong registered executable' '__FIXTURE__\program' 1 1
  !insertmacro Registration '__FIXTURE__\program'
  StrCpy $RegisteredUninstaller '"__FIXTURE__\other program\uninstall.exe"'
  !insertmacro Install 'different uninstaller target' '__FIXTURE__\program' 1 1
  !insertmacro Registration '__FIXTURE__\missing-main'
  !insertmacro Install 'missing application executable' '__FIXTURE__\missing-main' 1 1
  !insertmacro Registration '__FIXTURE__\missing-uninstaller'
  !insertmacro Install 'missing uninstaller executable' '__FIXTURE__\missing-uninstaller' 1 1
  !insertmacro Registration '__FIXTURE__\directory-binary'
  !insertmacro Install 'directory masquerading as executable' '__FIXTURE__\directory-binary' 1 1
  !insertmacro Registration '__FIXTURE__\program'
  StrCpy $RegisteredLocation '__FIXTURE__\program'
  StrCpy $RegisteredPublisher "PERFBOARD"
  !insertmacro Install 'unquoted location and publisher case' '__FIXTURE__\program' 1 0
  StrCpy $RegisteredDirectory '__FIXTURE__\program\'
  StrCpy $RegisteredLocation '"__FIXTURE__\program\."'
  !insertmacro Install 'normalized registered locations' '__FIXTURE__\program\' 1 0

  !insertmacro RepositoryBypass 'no configured repository' '' ''
  !insertmacro RepositoryBypass 'disconnected repository' '__FIXTURE__\lost repository' '__FIXTURE__\lost repository'
  !insertmacro RepositoryBypass 'existing repository' '__FIXTURE__\existing-repository' '__FIXTURE__\pointer must be preserved'
  ClearErrors
  ${GetOptions} $CMDLINE "/ORDINARY" $0
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 0
    StrCpy $PassiveMode 1
    StrCpy $RepositoryPointer ""
    StrCpy $RepositoryCalls 0
    StrCpy $PointerWrites 0
    Call PerfboardRepositoryInit
    !insertmacro Expect 'ordinary explicit repository selected' '$RepositorySelected' '1'
    !insertmacro Expect 'ordinary reuse requested' '$RepositoryCreate' '0'
    Call PerfboardRepositoryCheck
    !insertmacro Expect 'ordinary existing database required' '$RepositoryExitCode' '0'
    Call PerfboardRepositoryFinish
    !insertmacro Expect 'ordinary reuse validates then initializes' '$RepositoryCalls' '2'
    !insertmacro Expect 'ordinary reuse writes pointer' '$PointerWrites' '1'
    !insertmacro Expect 'ordinary pointer matches choice' '$RepositoryPointer' '"$RepositoryPath"'
    StrCpy $RepositoryCalls 0
    StrCpy $PointerWrites 0
    StrCpy $RepositoryCreate 1
    Call PerfboardRepositoryFinish
    !insertmacro Expect 'ordinary new repository initializes once' '$RepositoryCalls' '1'
    !insertmacro Expect 'ordinary new repository writes pointer' '$PointerWrites' '1'
  ${EndIf}
  FileWriteUTF16LE $TestLog "checks=$Checks failures=$Failures$\r$\n"
  FileClose $TestLog
  SetErrorLevel $Failures
SectionEnd
