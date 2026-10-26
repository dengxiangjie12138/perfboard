# Windows 安装与运行时

2026-10-02 更新：本批默认使用小在线安装包，配置为 downloadBootstrapper。先检查已安装 WebView2，缺少时联网下载。原离线包保留为旧功能历史备用，本批未重新构建；需要当前完整离线包时另行构建。以下 2026-10-01 验收记录是历史结果，本批没有重复整套安装/卸载验收。

状态：2026-10-01 20:04 UTC。自定义 NSIS 安装模板、原生目录验证和真实 release 安装包构建均已完成。真实静默安装/仓库复用、安装后 release 运行和严格项目内 `/UPDATE` 卸载已执行；GUI 向导及干净机器离线验收尚未执行，范围详见 VALIDATION.md。

## 安装行为

安装使用 `currentUser`，Tauri 官方安装页保留程序目录选择。在程序目录页之后，额外展示“选择数据仓库目录”：

- 在空目录创建新仓库，或明确复用已有 Perfboard 仓库。默认提示用户文档目录中的 `Perfboard`；再次安装时预填上次安装器记录的目录，仍可修改。
- 数据目录必须是绝对路径，最多 240 字符；支持中文及空格。不能选择磁盘根目录、文件、含目录联接/符号链接祖先的路径。程序与仓库不能相同，也不能互相包含。
- 新建模式拒绝非空目录。复用模式要求 `perfboard.sqlite3`，并在点击下一步时运行 Rust 的只读 `--validate-repository`，检查数据库标识、版本与结构。验证不会创建仓库或修改路径配置。
- 实际安装复制程序后，再由同一 Rust 数据层执行 `--initialize-repository`。成功才能完成安装；只读、数据库无效、版本不支持、初始化或配置写入失败时停止。失败可能留下已复制的程序文件，但不会借失败之名清空或覆盖已有仓库。
- 当前用户安装不会为程序/仓库自动修改 ACL。用户必须选择自己有写权限的目录；实际写入检查由 Rust 初始化执行。

仓库只有一套后端数据层，内容包括 `perfboard.sqlite3`、`attachments`、`backups`。安装时创建的新仓库为空，不预置虚构元件或笔记。

后端 `app.path().app_config_dir()` 与安装器 CLI 使用同一 Windows 配置位置：

```text
%APPDATA%\com.perfboard.toolbox\repository.json
```

```json
{"path":"D:\\PerfboardData","version":1}
```

JSON 由 Rust 序列化与写入，安装器不自行拼接路径字符串，也不使用仅首次启动的目录选择代替安装阶段的目录页。

## 卸载与复装

保留 Tauri 官方程序文件、快捷方式、注册表卸载逻辑和 WebView2 检测/安装逻辑。禁用了官方“删除应用数据”复选框及 AppData 递归删除段。

卸载永远不删除用户仓库、附件、备份和 `repository.json`。仓库与程序目录必须互不包含，因此程序卸载的清理路径不会进入仓库。卸载后可重新安装并明确选择原仓库。设置页后来更换的仓库路径以 `repository.json` 为准；安装器预填的注册表值只是上次安装时的提示，复装时可手动选择当前仓库。

## 打包配置

在 `src-tauri/tauri.conf.json` 使用：

```json
{
  "bundle": {
    "targets": ["nsis"],
    "windows": {
      "nsis": {
        "template": "installer/installer.nsi",
        "installMode": "currentUser",
        "languages": ["SimpChinese", "English"]
      },
      "webviewInstallMode": {"type": "downloadBootstrapper", "silent": true}
    }
  }
}
```

使用已安装的 Node、Rust MSVC 和 Visual Studio C++ Build Tools；不重复运行系统工具链安装器。进入项目后执行：

```powershell
npm ci
npm run tauri build -- --bundles nsis
```

初次构建需要联网获取 npm/Cargo 依赖与 NSIS。默认在线模式不内嵌完整 WebView2 运行时，缺少运行时的目标机器在安装时联网下载。构建设置 useLocalToolsDir=true，NSIS 构建工具缓存在项目 target/.tauri 内；本次复用已有固定版本工具，没有重新安装系统工具链。应用的 Excalidraw 字体随前端一起打包，运行时不依赖在线字体。

## WebView2 与“离线”的边界

当前配置选择 `downloadBootstrapper`：模板先读取 Microsoft Evergreen 运行时注册信息；已有运行时则跳过，缺少时下载 bootstrapper 并安装。无预装运行时且无网络的机器应使用匹配当前功能的完整离线包，原历史离线包不能代表本批功能。应用的仓库、笔记、字体和计算功能在本地运行。

2026-10-01 对匹配 bundler 源码的官方 x64 链接 `https://go.microsoft.com/fwlink/?linkid=2124701` 发出 HEAD 请求，返回 `Content-Length: 212373712`，约 **202.5 MiB**。这是运行时输入文件的实际大小，不是最终 setup 大小；最终以构建产物为准。`embedBootstrapper` 体积较小，但会在目标机器下载运行时，因此不能称为完全离线安装。`skip` 要求目标机预先有 WebView2，不用于本正式配置。

[官方安装方式说明](https://v2.tauri.app/distribute/windows-installer/)、[匹配版本 WebView2 下载实现](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/windows/util.rs)。

## 模板来源与维护

已安装 npm CLI 为 **2.12.1**。`installer/installer.nsi` 基于同一 tag 的官方模板；未使用 dev 分支。原文件保存在 `installer/upstream-tauri-cli-2.12.1.nsi`，MIT 授权原文保存在 `installer/LICENSE-TAURI-MIT`。

原文件 SHA-256：`DABED59013B1D78B879A1A85BC7F2EED2993B33A9A90CDABE5946DE3D3950597`。

修改范围仅限仓库选择页、路径边界验证、安装期调用 Rust CLI，以及卸载保留应用数据。未来升级 CLI 时应取新版本官方模板，重新核对这些差异并执行完整安装/卸载验收。

[官方模板 2.12.1](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)、[MIT 授权](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/LICENSE-MIT)。

## 已执行验证与待验收事项

已用官方 NSIS **3.11** 与 `nsis_tauri_utils` **0.5.3**、匹配版本的官方辅助文件及语言文件编译完整自定义模板。采用 UTF-8 和 `offlineInstaller` 分支，LZMA 压缩；成功退出 0。生产 bundler 也自动写 UTF-8 BOM 并传入 `INPUTCHARSET UTF8`。

完整模板测试采用替代程序和替代运行时 payload，只用于语法与页面结构验证，生成 7 个安装页、3 个安装 section、2 个卸载页。它不是正式发布安装包，不用于验收 WebView2 安装。

另已将模板中的真实原生目录检查函数编译成隔离测试程序并执行 **15 项测试，全部通过**：相对路径、根目录、与程序相同/位于程序内/包含程序、空目录、中文空格、非空目录、缺数据库、文件路径、尾斜杠、含 `..` 的重叠路径、引号、大小写重叠、目录联接祖先。测试仅在 `%TEMP%\perfboard-nsis-validation` 中创建自己的样本，不清理用户目录。

复现验证入口：

```powershell
.\src-tauri\installer\verify-template.ps1 -ToolsRoot "$env:TEMP\perfboard-nsis-validation"
```

该目录需要官方 NSIS 3.11、官方额外插件、同版本 `utils.nsh` / `FileAssociation.nsh` / 中英语言 includes。官方工具下载 SHA-1 与源码中的预期值相同：NSIS archive `EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D`，插件 `75197FEE3C6A814FE035788D1C34EAD39349B860`。结果保存在 `repository-guard-tests.txt`；脚本不会安装模板替代 payload。

真实应用完整构建已通过，安装包为 233,758,714 字节（222.93 MiB），日志在 `.quality/release-build-installer-fix.log`。仍需人工验收：交互式新仓库/有效已有仓库/无效数据库/取消/只读路径、卸载后仓库和 pointer 保留、重新安装恢复、无网络且无预装 WebView2 的干净 Windows 测试，以及数字签名（如交付要求）。未经实际执行不得标记已验证。

无界面的部署只接受明确指定的仓库目录；复用时还必须指定 `/REUSE`：

```text
Perfboard-setup.exe /S /REPOSITORY="D:\PerfboardData"
Perfboard-setup.exe /S /REPOSITORY="D:\ExistingPerfboard" /REUSE
```

未指定 `/REPOSITORY=` 的 silent/passive 安装退出 2，避免在无人确认时隐式创建或切换仓库。`/REUSE` 同样经过真实后端只读验证。

## 发布验收补充：精确运行标志与删除边界

静默验收的真实脚本审查发现官方 `GetOptions "/R"` 会按前缀匹配，把 `/REPOSITORY=`、`/REUSE` 误判为安装后启动应用。自定义模板已改用 `CommandLineToArgvW` 与完整参数比较，保留真实 `/R`（不限制前后顺序），并跳过 `/ARGS` 的一个参数值。NSIS 引擎为 x86-unicode；argv 指针按 4 字节读取，内存通过 `LocalFree` 释放，工作寄存器恢复。

隔离的 `verify-exact-flags.ps1` 已执行 12 项原生测试：仓库标志单独出现、复用标志单独出现、`/R` 在仓库标志前/后、含空格的引号包裹程序名、中文/空格/引号参数、应用参数恰好为 `/R`、长前缀、大小写及仓库值中的 `/R`。全部通过。只编译并启动独立参数 helper 测试程序，没有启动应用安装器、GUI，也没有写系统注册表。已有 setup 必须重新 bundle 才能包含修复。

真实生成脚本使用 `MANUFACTURER=perfboard`、`PRODUCTNAME=Perfboard`、`INSTALLMODE=currentUser`、`MAINBINARYNAME=perfboard`、`BUNDLEID=com.perfboard.toolbox`、`ARCH=x64`。注册表为当前用户 64 位视图：

- `HKCU\Software\perfboard\Perfboard`：默认值保存安装目录，`RepositoryPath` 保存上次安装器仓库目录，`Installer Language` 保存语言；卸载保留。
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Perfboard`：卸载登记；正常及 `/UPDATE` 卸载都会删除这一个 key。
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的 `Perfboard` value：仅普通卸载删除，`/UPDATE` 跳过。

`/D=` 必须最后、不加引号。给出不同于 `placeholder\Perfboard` 的绝对目录时，`.onInit` 不执行默认目录恢复，所以不会用注册表路径覆盖明确的 `/D=`。`/NS` 只阻止新建快捷方式；旧快捷方式迁移在该检查之前。因此还必须核实旧快捷方式不存在，或确认其目标不属于这次安装目录。

本机只读审查时：两个 Perfboard HKCU key 均不存在；当前用户桌面及开始菜单的 `Perfboard.lnk` 均不存在；默认文档仓库数据库不存在。WebView2 注册版本为 `154.0.4258.48`，`MINIMUMWEBVIEW2VERSION` 为空，所以在该状态下跳过运行时下载、安装及固定名称 TEMP payload 删除分支。状态变化后应重新核实，不能泛化为所有机器均无系统外文件操作。

当前生成脚本没有额外资源、外部 binary、文件关联或 deep link。`/UPDATE` 卸载的显式文件删除只有 `$INSTDIR\perfboard.exe` 与 `$INSTDIR\uninstall.exe`，另有非递归 `RMDir "$INSTDIR"`。`/UPDATE` 确实跳过所有快捷方式删除、unpin、jump list/recent destinations 清理及 Run value 删除。普通卸载含项目外快捷方式和 jump list 清理，不用于“禁止删除项目外文件”的隔离验收。

`CheckIfAppIsRunning` 向 Windows Restart Manager 注册精确 `$INSTDIR\perfboard.exe` 文件路径，不按所有同名进程扫描。静默模式会强制关闭占用该文件的进程，因此验收前应保证目标文件没有运行实例。

可由最终验收流程给 setup **子进程**设置项目内 `APPDATA` 环境变量，使 Rust 安装初始化 CLI 的 pointer 写入留在项目内；无需改变系统 Known Folder。正常 GUI 的 Tauri `app_config_dir()` 使用系统 Known Folder，不能据此宣称 GUI 也被同样隔离。此审查未执行安装、卸载、GUI，也未修改系统环境或注册表。

NSIS uninstaller 默认会自复制到 TEMP 执行；`_?=` 可指定卸载目录并避免这次自复制，但运行中的原 `uninstall.exe` 可能无法自删除而留下文件。使用时必须是最后一个参数、不加引号，并先核实它是本次安装生成的程序目录及两个已知文件。此机制不能用来绕过路径审核；普通卸载仍禁止用于上述严格边界验收。

NSIS 对 /D 与 _?= 的官方规则见 [命令行源码文档](https://github.com/kichik/nsis/blob/master/Docs/src/usage.but)：两者必须最后且不加引号；_?= 禁止卸载程序自复制到 TEMP。
