# Perfboard 0.1.0 实际验证记录

资料维护说明（2026-10-27）：以下路径、截图数量和文件保留状态记录各批次验收时的历史事实。旧 PRD 原型、截图及重复源码已按用户要求清理；验证结果继续保留，现行资料范围见 [PRD 文字历史](../PRD/CHANGELOG.md)。

## 2026-10-08：变压器设计记录主题修复
只修改 transformer-design.css 与开发记录。TypeScript、ESLint、现有变压器/窗口 6 个文件共 33 项用例通过；生产前端和 0.1.0 release EXE 构建通过。隔离无头 Edge 对实际冻结组件运行主/独立容器 × Codex/浅色/深色 × 系统浅色/深色共 12 组颜色检查，另核对工序层、导入对话框、单选强调色和焦点，生成 6 张截图，已人工查看三个主题与 Codex 独立容器截图。真实 Tauri 主/独立窗口的主题读取与广播链仅完成源码审查，原生 GUI 仍待用户测试。

候选 EXE 为 D:\AI\perfboard-theme-20261008\prepared-delivery\app\perfboard.exe，SHA256 为 3a53030fff48ae2fff54060d6919bfa6a266ceb8f13270584a021aa05f180afd。169 个最终 JS/CSS 资源名、内置字体与代表性磁芯图片键已在候选内核对。固定 EXE 仍运行，SHA256 保持 67c9bbc0de7db72395dd716366a46df58080c4fa515743921e11e523d5c5cba7，旧版备份字节匹配；尚未替换。未访问或修改真实 1918 条物料仓库。参考 Library 图片按当前技能流程尝试本地化但得到 HTTP 403，未宣称在此环境查看过原图。

本轮证据位于 D:\AI\perfboard-theme-20261008\quality：typescript.log、eslint.log、focused-tests.log、frontend-build.log、release-build.log、theme-browser-checks.json、release-artifact-verification.json 与六张 PNG。详见 [本轮交付记录](TRANSFORMER-THEME-20261008.md)。

## 2026-10-07 五组更新（当前批次，固定 EXE 已更新，GUI 待验收）

版本保持 **0.1.0**。本轮包括变压器设计记录与工艺 PDF、物料页仓库显示筛选、磁芯原表和图片、开发日志链接保存，以及久坐提醒恢复确认。功能与单个未审核 36W 示例见 [五组更新说明](FIVE-GROUP-UPDATE-20261007.md)。本节记录已执行的检查，不代表 GUI 或安装器验收通过；以下历史日期批次继续保留原记录。

证据根目录：`D:\AI\Perfboard\update-20261007\quality`。

| 检查 | 已执行结果 | 证据 |
|---|---|---|
| TypeScript | 通过 | `typescript-final.log` |
| ESLint | 通过 | `eslint-final.log` |
| 完整前端套件 | 51 个文件、326 项全部通过 | `frontend-final-tests.log` |
| Rust 库套件 | 174 项通过、1 项 ignored | `rust-library-tests.log` |
| 实际原 XLSX 定向用例 | 默认 ignored 的用例已显式单独运行通过 | 实际工作簿的单项运行结果；默认 suite 的 ignored 计数保留 |
| 提醒监测停用失败回归 | 单独重跑通过；属于上述 suite，不能重复计入独立用例总数 | `reminder-disable-failure-test.log` |
| 真实数据副本原生迁移 | 实际 debug EXE CLI 自动备份、v3→v4、重开通过 | `real-clone-native-migration.json` |
| 正式 PDF 模块 | 示例 2 页、带图 3 页、溢出 6 页；像素与文本通过 | `pdf-final-approved/render-report.json` 及同目录 PDF / 页面图 |

### 实际原生迁移与真实仓库保护

使用真实仓库的隔离副本，由新构建的 debug EXE 命令行调用实际 RepositoryManager，未打开 GUI。副本首次从 v3 升级 v4 前，自动生成并核验完整迁移前备份；备份 schema 为 v3。重开副本成功，且不重复创建迁移备份。

8 个旧表的全部元组与原始基线一致：`parts` 1918 条、`notes` 1 条、`dev_log_projects` 3 条、`dev_log_pages` 4 条、`dev_log_page_history` 30 条、`external_tools` 2 条、`settings` 3 条、`attachments` 0 条。迁移备份的旧表内容同样逐项一致，新 `transformer_designs` 记录数为 0。

真实原库 `D:\洞洞板\洞洞板仓库` 仍为 v3，内容原样保留。本轮对真实原库仅只读核验与完整备份，没有真实库迁移或历史设计批量导入。旧程序回退需恢复匹配的完整备份，不能以副本迁移成功声称真实库已升级。

### PDF、字体与 PRD

PDF 检查直接执行正式生产导出模块：36W 示例 2 页、带图片方案 3 页、长文本溢出方案 6 页。实际像素与文本核对通过，每页标题、中文、待确认项、工程标识和数字保留，长文本末尾未截断，无替代字符或页外文本。

字体为 **10,595,948 字节（约 10.6 MB）的完整静态 Noto Sans SC TTF**，来源为官方 [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notosanssc)，使用 [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt)。完整嵌入、不使用 subset，禁用会将工程标识和数字替换成其它字形的整形特性。PDF 导出和字段填写不会自动批准设计用于生产。

最新独立 PRD 快照在 `D:\AI\Perfboard\update-20261007\prd`，已冻结 717 个源码文件并构建 257 个本地产物；`prd-final-build.log`、快照的 `source-manifest.json` 和 `artifact-manifest.json` 保留证据。尚未进行浏览器实测，快照不连接真实仓库。

### 正式构建与安全交付

正式 release 及隔离 debug 构建成功。Windows `frontendDist` 带盘符绝对路径被 Tauri 解析为 URL，已改成指向同一生产目录的相对路径；实际 EXE 含当前入口 JS、NotoSansSC-Regular.ttf 与 11 张磁芯图片。生产资源逐字节一致；实际 release 只读 CLI 对迁移副本验证成功，生产配置不变。证据：`release-final-build.log`、`debug-qa-embedded-build.log`、`release-artifact-verification.json`。

固定交付 `D:\_project\AI_pro\Perfboard\deliverables\Perfboard-0.1.0\perfboard.exe` 已更新，38,057,984 字节，SHA256 `b438a4aaf29b8bc9ccd2fe5939ad83c741a7910548bf73b63e2b5ff6e063818f`，版本仍为 0.1.0。源码提交 `ee9ea97d30b8325557c24b566cc4d173363cbaad`。旧同名文件先复制至 `D:\AI\Perfboard\update-20261007\backups\fixed-delivery-before-five-groups-20261007T153541Z` 并逐文件核验，然后原子替换；218 个其他原文件和外部工具原字节保留，没有强制关闭进程。证据 `delivery-update.json`；当前固定目录另有 `SHA256.txt` 和 `manifest.json`。安装器未重建。

### 尚未完成的范围

桌面由 FleetMind 优先占用，本批尚未执行 GUI、真实键鼠恢复确认或 PRD 浏览器实测；原 Library 截图尚未完成查看。无界面 CLI、单元测试和 PDF 像素检查分别按上述范围记录，不替代这些待验项。



## 2026-10-03 统一搜索与工具多窗口（历史批次）

版本仍为0.1.0。搜索采用完整已保存快照上的缓存分词AND匹配，支持全拼、首字母和混合输入；数字、封装与物理m/M边界保持严格。八种工具使用固定本地窗口清单，输入独立、仓库和主题共享；JSON主/子窗口分别保存原文草稿。

- 47项相关前端用例通过，包含两个实际搜索入口、1918条完整输入、词序/跨字段/拼音/数字/mM边界、刷新后匹配、窗口清单与原文草稿隔离/损坏保护。历史全量前端套件未运行。
- 8项Rust窗口协调和路由测试通过：本地导航、固定工具路由、子窗关闭、主窗隐藏、请求ID/标签校验、全部窗口退出及保存失败取消。相关ESLint、TypeScript和修改的Rust文件格式检查通过；历史全量Rust套件未运行。
- 61次实际原生断言加5次完整重启补验，共66次通过。范围包括两处搜索、1320/900/680/420/320宽度控件、主/子输入隔离、三个工具并行与同工具复用、权限拒绝、库存增改删实时刷新、主题共享和实际外观UI同步、JSON大整数原文刷新/重开/完整重启恢复、失败保存取消整应用退出、WM_CLOSE隐藏主窗/单独关闭子窗及正常保存退出。断言中存在重复打开动作，不把66次称为66个独立测试用例。
- 原生仅启动独立identifier com.perfboard.toolbox.searchwindowtest，使用项目内私有config、SQLite、WebView profile及9359端口；未打开用户仓库。生产源码116项哈希与成功debug构建和正式release构建一致。私有实例正常IPC退出，没有强制关闭用户程序。
- PRD/search-windows-20261003冻结98个当前生产文件，安全浏览器适配器提供1918条合成内存物料与浏览器子窗演示。私有隐藏Edge上45次断言通过，覆盖搜索、三种主题、五档宽度、工具复用/独立输入、原文恢复及CRUD跨窗刷新；无脚本异常和外部HTTP请求。浏览器演示不代替原生权限、托盘与关闭验收。旧PRD的214个非索引历史文件字节不变，仅更新三处入口/历史元数据。
- 默认正式release构建成功，identifier com.perfboard.toolbox、ProductName Perfboard、FileVersion/ProductVersion均0.1.0，EXE 27,904,512字节，SHA256 8213bf3b52cc73d092220d556a099f52147c2daacc4e5c7656ac16132f8e5b5c。未重建安装器或运行用户安装程序。

本轮证据位于 .quality/search-update-20261003：frontend-tests.json、debug-build-gate.json、debug-build.log、native-20261003T130158Z/results.json与summary.json、native-restart-20261003T131008Z/results.json与summary.json、prd-browser-20261003T132356Z/results.json、release-build.json及release-build.log。PRD内保留validation.json、source/artifact清单和实际截图。早期验收脚本的选择器错误记录保留，不计入成功断言数。

新EXE和说明仅准备在 .quality/search-update-20261003/prepared-delivery。固定交付目录仍是用户上次手工复制后核实的205个文件，EXE SHA256 314bebda9bc942d599d77ce00ed16c052fc3160d8dc28cbffa3d1aa5f4e0e829；本轮没有自动覆盖。完整固定目录、163个SuperConnectX文件和来源元数据再次逐文件哈希核对，结果见completion.json。用户需先保存并退出原应用，再将本次prepared-delivery内的内容手工合并到固定目录；保留external-tools及其他原有文件。

本批未执行：笔记并发编辑、外部EXE嵌入、全量历史回归、完整GUI安装/卸载、干净机器WebView2安装和数字签名。计算器窗口关闭重开恢复初始值，JSON使用本机配置草稿；仓库备份不包含工具草稿。

## 2026-10-02 工具可用性更新（历史批次）

当前源码将常用小工具放在工具下，与硬件和STM32同级折叠；通用外部记录按名称与必填介绍参与全部记录搜索，结果只定位记录。线径改为50行AWG参考表和期望电流筛选，磁芯保留137条原记录并采用紧凑布局。旧专用自动发现与64项J筛选的通过记录保留在下方历史初轮，不代表本轮功能或验收。

- 42项相关前端用例通过：共享导航/搜索/注册/仓库连接28项、线径6项、外部工具3项、磁芯5项。磁芯检查在本轮暂停前通过，恢复后其源码和137条JSON记录未再修改，未记为重复运行。
- 共享源码、线径与外部工具的定向ESLint通过；全局TypeScript编译通过。6项隔离Rust外部配置/命令检查通过，修改的lib.rs和external_tools.rs格式检查通过。
- 线径原表审计核对50行、150个参考电流，mismatches为空；数据来自原表，不以J生成。
- 共享回归覆盖整行折叠、实际搜索按钮定位但不启动、超过物料/笔记预览数量的12条外部记录，以及CRUD后的两处搜索更新。相关git diff --check通过。

- 独立Tauri/WebView2原生窗口最终96/96断言通过，14张截图已检查三主题、单位、状态、紧凑磁芯布局和选中记录边框。13条合成外部记录覆盖全量名称/介绍搜索、CRUD即时更新、精确记录定位及滚动后进入可见区域；删除保留空EXE样本与其余12条记录，全部流程未调用启动IPC。
- 原生线径检查覆盖50行、滚动表头、A/mA一致、100A下AWG2/3区间命中与AWG1/4相邻标签、非法输入和清空恢复。137条磁芯渲染值、15字段详情及组合筛选核对不变，仓库物料数量保持零。
- 独立debug构建成功，应用版本0.1.0；117项构建源码哈希复核无改动。全部自有测试PID通过正常IPC退出，9357端口释放，没有强制关闭用户进程。
- 默认正式配置的release构建通过：identifier为com.perfboard.toolbox，ProductName为Perfboard，FileVersion/ProductVersion均为0.1.0，程序27,585,536字节，SHA256为314bebda9bc942d599d77ce00ed16c052fc3160d8dc28cbffa3d1aa5f4e0e829。构建源码117项哈希与debug/原生验收一致；源码映射与固定交付实际覆盖结果以本轮交付核对记录为准。
- 当前实际组件PRD快照57/57浏览器检查通过，5张截图保留；59项实际源码依赖哈希匹配，包含真实WorkbenchPage及合成ExternalToolsProvider。旧130个快照文件逐字节哈希不变；file URL离线运行无外部HTTP请求或浏览器异常，快照构建、定向类型检查与diff检查通过。记录定位、说明搜索和更新只使用合成数据，不执行外部程序。

证据：.quality/usability-update-20261002/native-acceptance.json、native-20261003-002213/results.json及summary.json、build-gate.json、debug-build.log、release-build-provisional.json及release-build.log、wire-data-audit.json；PRD/usability-20261002/validation.json、source-manifest.json、artifact-manifest.json和preserved-snapshots.json。原生目录名按本机UTC+8生成，最终记录的UTC日期仍为2026-10-02。

构建与验收对应同一组117项应用源码哈希；该历史批次自动复制曾被审批阻止，随后用户手工复制；只读核对25个更新文件及固定目录205个文件均符合准备清单。其EXE为上述314bebda…；本轮新EXE交付状态见当前批次。本轮未重跑历史全量套件或重建安装器；原生检查仅使用项目内私有config/仓库/WebView profile与空EXE样本，未启动任何外部程序，未读写用户剪贴板、已安装程序或用户仓库。

## 2026-10-02 八工具初轮增量验收（历史批次）

本节记录初轮新增进制转换、LED限流、串联、并联、JSON解析、独立磁芯库、SuperConnectX外部启动及线径计算，版本保持0.1.0。当轮只检查相关范围，未重跑旧全量套件或重建安装器。

- 63项相关前端测试（12文件）通过；相关目录ESLint、TypeScript编译通过。修改的Rust文件格式通过，外部启动2项隔离Rust测试通过；磁芯原表导入2项检查通过。全项目Rust格式检查发现既有repository模块格式差异，本轮未改动该模块。
- 实际Tauri/WebView2共82个合并有效断言通过，保留每轮构建哈希与记录。独立仓库/config/profile及端口9353在项目私有目录，测试窗口全部安全IPC退出，没有强制关闭用户程序。
- 进制覆盖64位最大值、补码/扩展/截断、位运算、移位、位翻转、错误原文及复制反馈；LED覆盖理论、标准与库存、额定功率三态和缺货排除；串并联覆盖不同阻值的0.375W瓶颈、动态行与非法输入。
- 官方JSON编辑器真实双击修改普通叶后保持18446744073709551615；数值叶改为18446744073709551616后精确回写，转义/反转义、搜索、折叠、无效原文与复制反馈通过。修复真实回调text:undefined与json并存的边界。
- 磁芯137条参考搜索、15原字段、未注明单位及双空格类别联合筛选通过；修复option隐式value合并原始空格的问题，源ExcelSHA256不变。
- 外部启动核对自动相对路径、手动覆盖、缺失路径与清除恢复；无真实外部launch。官方v1.2.10 portable下载同时匹配官方digest及SHA256SUMS，163文件完整，主EXE签名NotSigned；保留完整目录用于用户明确授权的本机个人用途，未公开上传或安装驱动/服务。
- 线径覆盖64候选、J默认空、18AWG面积与向上公称匹配、I/J阈值、A/mA一致、零/非法/倒置与溢出。候选不代表标准安全载流。
- 八项工作台/全局搜索、三主题及窄窗口实际像素检查通过。离线实际组件快照22项浏览器检查通过，保留第三方notices，未访问真实库存。

证据：.quality/tools-expansion-20261002/focused-tests-final.log、merged-checks.json、native-20261002-175606/results.json及PRD/tools-20261002/validation.json。计算/原表/线规边界见TOOLS-CALCULATION-RULES.md。

限制：复制反馈通过测试写入接口验证，未读取用户剪贴板；没有真正启动SuperConnectX或连接COM。公开再分发许可仍未确认，不能据本机部署推导公开分发权限。本机便携包首次执行及可能的Windows安全提示由用户处理，验收未移除或绕过安全限制。

初轮完成记录：2026-10-01 19:29 UTC；发布验收补充完成于 20:04 UTC。测试使用本机实际 Tauri + WebView2 程序与真实 SQLite；原生测试仓库和配置隔离在项目 `.quality` 下，不修改用户现有仓库。

## 检查结果

| 项目 | 实际结果 | 证据 |
| --- | --- | --- |
| TypeScript 与 ESLint | 通过 | `npm run typecheck` / `npm run lint`，最后改动的 App 再单独检查 |
| 前端计算、场景、自动保存 | 25/25 通过 | `npm test`，3 个测试文件 |
| Rust 数据层与路径保护 | 15/15 通过 | `cargo test`；含两个真实 Windows junction 回归 |
| Rust 格式与编译 | 通过 | `cargo fmt --check` / `cargo check` |
| 生产依赖审计 | 0 项漏洞 | `npm audit --omit=dev` |
| 基础原生回归 | 16/16 通过 | `.quality/native-20261002-032242/results.json` |
| 扩展原生回归 | 18/18 通过 | `.quality/extended-20261002-032820/results.json` |
| SVG 原生回归 | 11/11 通过 | `.quality/svg-20261002-032831/results.json` |
| 安装器原生路径保护 | 15/15 通过 | `src-tauri/installer/verify-template.ps1`，详情见 Windows 安装器文档 |
| 正式 release 与 NSIS | 修复安装参数后重新构建成功 | `.quality/release-build-installer-fix.log` |
| 发布程序只读仓库验证 | 退出码 0 | 实际运行交付 `perfboard.exe --validate-repository` 检查基础测试的完整备份 |
| 数字签名状态 | NotSigned | 对交付 setup 执行 Windows `Get-AuthenticodeSignature` |

正式安装包 `Perfboard_0.1.0_x64-setup.exe` 为 **233,758,714 字节（222.93 MiB）**，内嵌实际 Microsoft x64 WebView2 离线安装程序。不是替代 payload 或仅模板语法产物。

## 原生验证覆盖

基础验证从空仓库开始，使用真实界面创建物料、保留可选数量及多行简介、复制图片且保留源文件、内部动态搜索、创建并导入完整带图片 Excalidraw 笔记、标题离开前保存、在线 SQLite 完整备份、保存退出并重启恢复。图片 JSON 与 elements 未被载入过程中的空场景覆盖。

扩展验证覆盖取消新建和简介编辑、两行同时展开与独立收起、PDF 副本与删除保留原文件、三种主题持久化、真实隐藏窗口保持进程、第二实例恢复窗口、实际 SQLite `BEGIN IMMEDIATE` 写锁导致保存失败后阻止导航并保留草稿、释放锁后重试提交、原版图片导出预览和冷字体、主题重启、数据库丢失后的恢复页面且不创建新空数据库。

SVG 验证使用原生 DOMParser 和原版 Excalidraw，覆盖 UTF-8 百分号和 base64 两种自包含图片、编辑及保存、冷重启恢复；不安全导入先确认，取消保留场景；不安全已有场景禁止编辑并提供原始 JSON 导出，离开与退出重启不覆盖原始字节。fixture 显式包含 viewBox，避免将原版编辑器的正常 SVG 尺寸补全误认为丢失。

junction 回归只使用项目内自建仓库和 sibling 目标。附件目录或仓库根目录被替换后，读取/打开/导入/删除/备份/写入拒绝越界；目标文件和数据库字节保留，失败的删除保留 SQL 记录，失败的备份未创建目标目录。测试只移除自建联接本身及自己的临时样本。

冷启动、原版图片导出和 SVG 恢复未产生外部 HTTP/HTTPS 请求。Tauri 的 `tauri.localhost` / `ipc.localhost` 属于本机虚拟协议来源，未误计为联网。未通过放宽 CSP 达成此结果。

已查看原生截图：基础笔记恢复、图片导出预览、两种 SVG 恢复与原始场景阻止编辑界面。相应 PNG 保存在上述 `.quality` 目录。

## 尚未实际验收

- 正式 setup 的交互式安装/取消及普通卸载 GUI。实际静默新安装、明确复用及严格 `/UPDATE` 卸载已经执行，见下方发布验收补充。
- 无网络且无预装 WebView2 的干净 Windows 机器安装。离线 payload 已实际打包，本机已有 WebView2，不能替代该环境验收。
- 原版图片导出已验证预览与字体；原生保存对话框最终写入 PNG/SVG 尚未人工验收。
- 代码签名未配置，当前交付明确为未签名版本。

这些事项不标记为通过。权限没有阻塞构建或项目工作；Windows 原生对话框受到下方工具缺失限制。未重复安装系统工具链，也未初始化远端仓库。

## 复现

构建 debug 后在项目根目录执行 `python -X utf8 scripts/native-e2e.py`、`scripts/native-extended.py`、`scripts/native-svg.py`。脚本需要现有 Python websocket-client；仅在 debug 版本允许项目内 `PERFBOARD_TEST_CONFIG_DIR` 覆盖，release 忽略该测试变量。启动的远程调试接口只用于本机隔离测试。

PRD 验证与完整历史继续保存在 `PRD`。早期失败尝试保留在 `.quality`，本表只采用列出的完整通过记录。

## 发布验收补充

- NSIS 完整 `/R` 参数匹配 12/12 通过，修复后的 setup 已重新构建。`/REPOSITORY=` 与 `/REUSE` 不会导致隐式启动 GUI；确切 `/R` 与带空格、中文的 `/ARGS` 仍可识别。
- 真实 setup 静默安装与仓库复用 10/10 通过：`.quality/installation-20261002-034836/results.json`。程序路径为“安装程序 中文 空格”，仓库路径为“仓库 数据 中文”。使用 `/S /NS`，且 APPDATA、TEMP/TMP 均隔离在项目内。没有覆盖原安装（测试前安装登记及快捷方式不存在），WebView2 已存在，未运行或删除外部运行时安装文件。
- 安装后真实 release 程序 9 项通过：`.quality/release-runtime-20261002-035743/results.json`。首次使用页打开所选仓库、真实 UI 创建物料、完整 Excalidraw 图文保存、原版图片导出预览、保存退出重启恢复，以及交付中的 standalone release 实际启动均已执行。标准路径配置原先不存在，由应用创建；结束后连接新建的空白项目内仓库。合成测试数据没有变成初始业务数据。
- 严格项目内卸载 8/8 通过：`.quality/installation-20261002-034836/uninstall-results.json`。预先检查真实生成脚本，只执行 `/S /UPDATE _?=<已核实项目内安装目录>`；跳过外部快捷方式、取消固定、跳转列表和自启动清理。仓库全部文件字节、隔离 pointer、标准 pointer 均保持；未知文件哨兵保留。只删除明确安装文件，未做递归清理。自卸载文件的项目内残留经路径核对后清理；普通卸载未执行。
- 本次新建的安装路径/仓库提示值经确切匹配后清空，避免下一次安装向导预填测试目录。没有删除外部文件或原用户配置。
- 已补充交付中的“开始使用.txt”及两张真实 release 应用截图。

安装后的 EXE 仅在官方 bundle 标记的三个字节（UNK → NSS）与 standalone EXE 不同，其他字节完全一致。这是匹配版本 bundler 的正常打包/恢复机制，[Tauri 2.12.1 源码](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle.rs) 有相应实现；两种实际运行形态均已验证。

当前 release 检测到 File System Access 原生保存 API 可用，但没有模拟或替换 picker 来制造保存成功。交互式 NSIS 页面与 PNG/SVG 原生保存对话框仍未验证：[Computer Use 技能](C:/Users/AW/.codex/plugins/cache/openai-bundled/computer-use/26.928.31416/skills/computer-use/SKILL.md) 指向的指南要求“Use `node_repl` JavaScript for all Computer Use actions”，当前工具集中没有 `node_repl`。未改用直接 PowerShell UI Automation，也未绕过 Windows/浏览器安全提示。干净机离线安装和数字签名仍保留原先限制。

## 2026-10-02：物料与工具批次（仍为 0.1.0）

本批限定检查物料兼容、字段持久化、工具拆分、电流/功耗、笔记分类布局和保存流程，没有重复整套安装/卸载验收。真实安装目录和用户仓库未打开或修改。

- 相关前端 13 个测试文件的 67 项用例通过（整合检查后对最后修改的计算/笔记文件增量复查）。变动前端文件 ESLint、最后修改文件与配置增量 ESLint、TypeScript 和 Vite 发布构建通过。
- 5 项 Rust 精确过滤检查通过，TEMP/TMP 显式指向项目内隔离目录：v1 旧参数保留/重复打开、物料增改重启、品牌与商城编号清空重启、只读验证保持数据库字节与版本、第二次 ALTER 失败回滚第一次 ALTER 并保留旧数据。
- 独立 identifier 的真实 Windows WebView 应用通过 34 项原生检查：型号/封装独立列与同排输入、删除参数输入/列、品牌和商城编号文本/前导零/留空、位置子串候选与新位置、多行简介编辑和重启恢复；概览与四类画布布局、全局导航保留；笔记标题/画布保存、切换、离开页面、重启后的实际画布 hydrate；标准和库存来源的电流/功耗列、非法上限无候选。
- 原生检查发现并修复受控选择器的延迟事件读值问题：先同步读取笔记 ID/分类，再排队保存与切换。修复后重新构建的隔离程序通过全部检查。
- 反馈算法检查包含理想模型实际 Vout、I=Vref/Rbottom、上下 P=I²R、精确电流边界、略低上限排除、E24/E96/库存来源一致过滤、有限正数校验、空候选不放宽，以及 3.3V/0.8V 分压的显示噪声归零。算法误差比较保持原值。
- 正式 release 为原 identifier、x64 PE，FileVersion/ProductVersion 都是 0.1.0。NSIS 小在线包构建成功，18,627,896 字节（17.76 MiB）；生成模板明确为 downloadBootstrapper，未嵌入离线运行时。

证据在 `.quality/batch-native-20261002-112857/results.json`、三张截图、`.quality/batch-rust-focused.log`、最终 debug/release 构建日志。可复用原生入口为 `scripts/native-batch.py`，必须使用验证过的独立 debug identifier、项目内配置/仓库/profile、哈希门禁与独占 CDP 端口。仅通过自身 IPC 退出测试实例，没有强制终止用户进程。

未执行：本批完整 GUI 安装/卸载回归、缺少 WebView2 的干净机器联网下载验收、网络失败验收、代码签名，以及当前完整离线安装包重建。本机已有 WebView2；运行时检测/下载逻辑来自固定版本 Tauri 模板并已编译入小在线包，实际干净机器路径仍需人工确认。原约 223 MiB 离线包为旧功能历史产物，不包含本批改动。


## 2026-10-03 工作流专项验证

窗口与记录、近似搜索、开发日志、自动备份和主动登录启动已实现；版本仍为0.1.0。规则、迁移与剩余验证边界见 [WORKFLOW-UPDATE.md](WORKFLOW-UPDATE.md)。本批新构建放在独立准备目录，固定交付未自动合并；没有匹配最新功能的安装器。


### 工作流批次最终验收 — 2026-10-03 UTC

- 最终当前源码的136项定向前端断言通过；类型检查、实际src全量lint和14个改动Rust文件的格式检查通过。Vitest明确排除PRD、.quality和第三方冻结副本，未运行历史全量套件。
- 59项定向原生单元/集成断言通过：仓库迁移/备份5、窗口10、外部工具5、自动备份13、统计5、启动6、写入租约10、日志5。自动备份包含失败保留、非软件文件/重解析点保护、当天一次及校验后的保留策略。
- 私有测试标识com.perfboard.toolbox.workflowtest的实际Windows EXE通过77项断言，代码与本地资源543文件SHA256门禁一致。证据：.quality/workflow-update-20261003/native-20261003T172720Z/results.json与summary.json。
- 确认原关闭误报的根因：Tauri的默认Any事件监听也接收emit_to的标签事件，其他窗口错误响应。关闭请求改为当前WebviewWindow定向监听；保留原生未知ACK拒绝与全局同步事件。初次仅查看子窗存活的试验未覆盖主窗误报，最终明确检查全部存活窗口，涵盖工具栏连续点击、故障注入、原生WM_CLOSE与备份/切库。
- 故障注入时保存失败提示是预期结果，草稿与窗口保留；修复后不再产生“No close request is pending”误报。故障注入的跨窗取消提示可能保留在当次测试截图中，不作为正常使用错误。
- 实际同文档双窗单写入/只读、版本冲突拒绝、日志自动保存/Ctrl+F/独立行号、Excalidraw原JSON字节保留、完整手动/自动备份、切库前保存、重启草稿与--autostart隐藏主窗均通过。仅向本次自建PID发送WM_CLOSE，Windows登录启动注册前后指纹相同；未操作用户仓库、系统剪贴板或外部EXE。
- 新离线PRD workflow-20261003使用真实冻结UI和独立内存适配器，29项file://浏览器检查通过，无运行时异常及外部请求；665个原文件/268个官方编辑器文件及241个运行资源核对SHA256。旧338个PRD文件构建前后完整保留，随后仅根index/history/CHANGELOG入口元数据授权更新，保留335个历史文件原字节。
- 久坐提醒standing-reminder-preview.html是独立概念预览，只有HTML状态模拟；未集成应用，也未调用系统锁屏或睡眠接口。基本JavaScript语法、唯一ID和DOM引用检查通过。

## 2026-10-04：开发日志三项改进（0.1.0）

本轮只涉及标题/树行改名、回收站永久删除/清空、按仓库和窗口恢复项目/页面。基准为用户已验收的 b658be4fe15b11d333f5128e1ac68dfe82cdc56a；不重复旧十二项验收，不升级版本、安装依赖或迁移仓库结构。

前端定向 35 项、相关文件 ESLint 与 TypeScript 通过；Rust 日志事务 24 项（新增永久删除 19 项）、选择存储/权限 17 项，共 41 项通过。Windows 核心交互加同一私有仓库续验 67 条有效断言通过。最初脚本定位/表达式及启动等待错误的中止记录保留，不计入有效总数；完成的交互不重复。实际双击、IME 合成 Enter、Win32 页面拖动、A/B 选择隔离、主/副窗及只读保护、正常退出重启、删除/永久缺失列表回退、确认取消与跨窗恢复竞态均通过。活动记录、笔记与合成 PNG 附件字节保全。

实际截图复核后仅剥掉删除冲突对话框的内部诊断前缀，原生错误码保留；最终构建只对此路径补验 7 条并通过，有效原生总数 74，结果与两次构建来源见本轮统一原生报告。所有本任务自有进程正常 IPC 退出，不处理用户应用或真实仓库。debug 与 release 仅本项目输出，源码清单分别记录核心与最终提示构建；最终仅一行可见提示差异，其他生产文件一致。

三张 Library 图的官方转存因 Windows os.setxattr 不可用失败，未绕过元数据，参考图视觉对照待用户确认。WebView 输入法合成、HTML 页拖动、附件原生接口分别不覆盖硬件候选窗、资源管理器文件拖动或操作系统选择器。未重新构建安装器。精确三文件 app、哈希、完整本地提交和复制边界在 .quality/dev-logs-refinement-20261004/completion.json 与 prepared-delivery/COPY-GUIDE.txt；旧包及历史快照保留，固定交付未覆盖。
