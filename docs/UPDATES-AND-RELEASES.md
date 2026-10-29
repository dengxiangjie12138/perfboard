# 软件更新与发布

洞洞板使用 GitHub Releases 分发 Windows x64 NSIS 安装包。软件中的“自动检查更新”默认关闭；开启后启动时检查一次，运行期间每 6 小时检查，隐藏到托盘仍然生效。自动检查只提醒，下载和安装由用户主动操作。从 `0.1.3` 起可在“更新来源”选择 GitHub 或 Gitee 国内镜像，默认 GitHub，选择独立保存在本机配置中。检查、历史版本与下载统一使用所选来源，切换时清除原来源的缓存提示与下载状态；检查、下载或安装时不能切换。

## 用户更新流程

在“版本与说明”中点击“检查更新”。发现新版后，左侧菜单显示更新标记，页面显示新版号和说明。点击“下载更新”，下载并验证完成后，再点击“保存并重启更新”。只有全部窗口保存成功才会启动安装，安装完成后重新打开软件。

更新模式只替换程序文件，保留数据库、附件和仓库路径配置；数据库版本迁移沿用正常启动时的备份和事务迁移流程。仓库未连接或路径失联不应阻止程序更新。便携模式可以检查和下载安装包，首次需手动运行安装包完成安装。

`0.1.1` 是首个接入更新的版本。`0.1.0` 没有更新入口，需要先手动安装一次新版本。以后正式发布必须递增版本号；重新上传同版本 EXE 不会产生常规升级提示。

从 `0.1.2` 起，更新区域还可选择历史发布版本，查看对应说明并下载所选安装包。选择旧版后必须由用户主动确认回退，自动检查仅发现和提醒更高版本，不会自动降级。只有同一发布下安装包、签名和版本清单完整、签名公钥及签名版本验证通过时，才允许在应用内执行；例如缺少更新签名的 `0.1.0` 只提供发布页入口。

回退只替换程序，不回退数据库、附件或仓库路径。若新版已经升级数据库结构，旧版可能无法读取；回退前应保留独立数据备份并确认兼容性，不通过覆盖个人数据库来完成程序回退。

## 更新签名密钥

更新签名使用一对专用密钥。公钥保存在应用配置中，私钥必须保存在仓库之外，并额外保存在安全的离线介质或密码管理器中。私钥及密码不能放进 Git、GitHub Release、数据库快照或交付文件夹。更新签名与 Windows Authenticode 签名是不同用途。

首次配置密钥时执行下列命令；**已有密钥时直接使用原密钥，不重新生成，不使用 `--force` 覆盖。**

```powershell
$updaterKeyPath = Join-Path $env:USERPROFILE '.tauri\perfboard-updater\perfboard.key'
npm run tauri -- signer generate -w $updaterKeyPath
```

将生成的 `.pub` 文件内容写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，不是填写文件路径。密钥丢失后，已安装版本不能信任另一把密钥签出的更新，需另行设计密钥轮换或手动重新安装。详见 [Tauri 更新签名说明](https://v2.tauri.app/plugin/updater/#signing-updates)。

## 构建和签名

发布前统一修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本。三个版本必须一致，例如本版均为 `0.1.3`；发布标签使用 `v0.1.3`。

应用配置启用 `bundle.createUpdaterArtifacts: true`、`plugins.updater.requireSignedVersion: true`，默认 GitHub 更新入口为：

```text
https://github.com/dengxiangjie12138/perfboard/releases/latest/download/latest.json
```

Gitee 使用固定 `gitee-updates` 分支中的 `latest.json`、`versions.json` 和 `releases/v<版本>.json`，不依赖 Gitee 按更新时间排列的“最新发行版”。具体镜像发布与验证见 [Gitee 同步说明](GITEE-MIRROR.md)。更新包只接受当前来源认可的 HTTPS 下载主机和重定向，签名及签名版本校验对两个来源均生效。来源与该来源的提示缓存保存在独立 `updater-source.json`；保留旧 `updater-settings.json` 格式，兼容回退到 0.1.2。

在当前 PowerShell 进程中设置构建环境变量。不要把私钥内容直接写在命令历史里，也不要输出或打印变量：

```powershell
$updaterKeyPath = Join-Path $env:USERPROFILE '.tauri\perfboard-updater\perfboard.key'
$env:TAURI_SIGNING_PRIVATE_KEY = $updaterKeyPath
# 若私钥设置了密码，从安全存储注入 TAURI_SIGNING_PRIVATE_KEY_PASSWORD。
npm run tauri -- build --bundles nsis --ci
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
```

构建会生成 `Perfboard_<版本>_x64-setup.exe` 与同名 `.exe.sig`。本项目锁定的 Tauri CLI 2.12.1 支持签名绑定应用版本，`tauri build` 自动绑定；若单独对安装包补签名，必须传 `--app-version <版本>`：

```powershell
npm run tauri -- signer sign --private-key-path $updaterKeyPath --app-version 0.1.3 'src-tauri\target\release\bundle\nsis\Perfboard_0.1.3_x64-setup.exe'
```

`requireSignedVersion` 使下载包的签名版本必须与更新信息中的版本相同，避免旧包被配上较新版本号。不得为绕过失败而关闭签名或版本验证。命令参数可通过 `npm run tauri -- signer sign --help` 核对；参见 [Tauri CLI](https://v2.tauri.app/reference/cli/#signer-sign)。

## 准备发布资产

准备 UTF-8 Markdown 更新说明文件，再执行：

```powershell
node scripts/prepare-update-release.mjs `
  --installer 'src-tauri\target\release\bundle\nsis\Perfboard_0.1.3_x64-setup.exe' `
  --notes 'docs\releases\v0.1.3.md' `
  --output 'deliverables\releases\v0.1.3'
```

脚本使用 Node 内置加密库，不需要安装依赖，也不会读取私钥或上传文件。它会：

- 核对三个项目版本、稳定版号和安装包名称。
- 使用应用配置公钥，实际验证 EXE 的 Minisign 签名及可信注释签名，检查签名内的版本与文件名。
- 生成 `latest.json`，内嵌签名内容，下载地址固定指向此仓库对应 `v<版本>` Release 的 EXE。
- 从该版源码读取数据库 `SCHEMA_VERSION`，写入 `repositorySchemaVersion`，用于手动回退前的兼容检查；已发布 `0.1.1` 清单缺少此字段时按其已知 schema 6 处理。
- 复制验证后的 EXE 和 `.sig`，生成 `SHA256SUMS.txt`。已有同名资产内容不同时停止，不自动覆盖。

可加 `--verify-only` 仅校验而不生成文件；加 `--date '2026-10-29T12:00:00+08:00'` 指定发布信息时间，否则使用执行时的 UTC 时间。重复生成时如时间改变，`latest.json` 也会改变，因此应保留第一次生成的整套发布资产，或重复使用相同 `--date`。

## 发布和验证

在 GitHub 创建对应标签的草稿 Release，上传下列四个文件，确认完整后一起发布为正式最新版本：

1. `Perfboard_<版本>_x64-setup.exe`
2. `Perfboard_<版本>_x64-setup.exe.sig`
3. `latest.json`
4. `SHA256SUMS.txt`

更新程序使用前三项；校验和供人工核对。不要把个人数据库放入更新安装包。只推送源码、只上传 EXE 或发布为预发布版本，都不等于正式更新源已经就绪。旧版本 Release 如果没有 `latest.json`，检查会提示更新服务尚未就绪，应保留明确错误而不是显示“已经最新”；完整更新版发布后，固定入口应能读取该清单。

发布后核对固定更新入口能够下载正确的 `latest.json`，其中版本与对应 EXE、`.sig` 和标签一致。使用独立测试安装、合成仓库和隔离配置验证从上一版检查、下载、保存、安装和重启，核对数据与路径保留，不在个人实际仓库上试安装。

发布脚本测试：

```powershell
node --test --test-isolation=none scripts/tests/prepare-update-release.node-test.mjs
```

测试只使用临时合成 EXE 和内存生成的临时 Ed25519 密钥，覆盖包被修改、签名/版本/文件名不匹配、可信注释被修改以及拒绝覆盖旧资产，不读取实际发布私钥，不连接 GitHub。

## 隔离原生升级验收

`scripts/validate-updater-native.py` 使用已有 CDP helper 和 `websocket-client`，针对提前准备好的独立测试安装器验证真实升级链路。测试安装器和应用必须使用相同的 GUID 测试产品名、独立应用标识及合成仓库；脚本拒绝普通产品、外部目录、目录联接和符号链接。所有路径及计划文件必须位于同一隔离根目录中。

```powershell
python scripts/validate-updater-native.py `
  --plan '.quality\updater-native\plan.json' `
  --signature '.quality\updater-native\update-0.1.1-setup.exe.sig'
```

计划包含 `validationRoot`、`productName`（`PerfboardUpdateValidation-` 加 32 位十六进制 GUID）、`manufacturer: "perfboard"`、`programDirectory`、`applicationConfigDirectory`、`repositoryDirectory`、`initialInstaller` 和 `updateInstaller`。`initialVersion`、`updateVersion` 指定测试升级版本。可增加 `rollbackVersion`、`rollbackInstaller` 及对应 `.sig`，验证升级后明确选择旧版再回退；`--rollback-signature` 可显式指定旧版签名路径。仅支持签名完整且不低于 `0.1.1` 的回退目标。

签名由构建环节提前生成，验收脚本不需要生产私钥。`--inspect-plan` 只检查路径约束；默认使用本机 CDP 端口 9345 和随机本机 HTTP 端口，不连接 GitHub。

使用 `.quality/updater-native` 这样的短测试根目录。GUID 测试产品名较长，Tauri 会在临时目录和安装文件名中各使用一次产品名；路径过深可能超过 Windows ShellExecute 的 260 字符限制。脚本会预先拒绝这种测试路径。

脚本创建合成物料、笔记和附件，验证手动检查、侧栏标记、自动开关和隐藏托盘启动检查、篡改包拒绝、有效包下载、独立笔记窗口拒绝保存阻止安装、随后正常保存并升级和自动重启。最后比较核心记录、附件、仓库路径配置，退出并卸载 GUID 测试产品，清理其精确注册项，保留合成数据、截图和 JSON 报告。故障注入只包装该测试 WebView 的调试回调表，使真实保存屏障收到 `saved=false`，不修改应用代码或绕过验签。

带回退参数时，还会验证历史列表、无签名旧版不可执行、schema 不兼容拒绝安装、缺少明确回退确认时不执行，以及回退后旧版能继续读取原更新偏好和数据。`0.1.1` 测试清单故意省略 schema 字段，覆盖旧版兼容分支。整个流程仅操作 GUID 测试产品，不能替换或退出用户正式安装。

## 0.1.3 来源选择验证

前端回归 849 项通过（另有 1 项既有跳过），Rust 回归 306 项通过（另有 2 项既有忽略），其中更新模块 26 项。代码检查与发布签名工具 15 项测试通过。界面验证覆盖明暗主题、440px 窄窗口、保存失败重试、切换来源时丢弃旧请求，以及来源绑定的安装确认。

使用独立 GUID 产品、临时测试签名、隔离配置和合成仓库完成 42 项 Windows 原生验收：默认 GitHub、Gitee 来源保存和重启恢复、后台检查、网络失败重试、签名拒绝、独立窗口保存失败阻止退出、NSIS 升级及回退、数据库和附件以及仓库指针保留。两个测试二进制均来自 0.1.3 功能源码，通过构建配置分别标为 0.1.2、0.1.3，用于验证安装与回退流程；真实旧版配置兼容性由旧设置格式和字节保持测试保证，不将测试程序视为实际已发布 0.1.2 二进制。正式用户安装与个人数据库不用于安装验收。

补充便携原生验收 6 项通过：未配置仓库时可选择 Gitee、检查和下载验签，更新过程不会创建仓库配置；重启后保留来源，仓库路径失联仍可检查。所有下载均位于本次隔离 TEMP，未执行便携安装包。

真实公网原生验收 11 项通过：独立 GUID 便携测试使用生产公钥与固定公开端点，GitHub/Gitee 的检查和历史目录均可读取；分别下载 0.1.1 安装包，经 Rust 更新器验证签名与签名版本，两包 SHA256 完全一致。测试仅下载验签，不执行下载包，不配置仓库；两个来源的真实 CDN 跳转策略均已覆盖。
