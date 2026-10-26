# Perfboard 正式开发交接

2026-10-27 资料维护说明：本文保留最初开发交接的历史事实。用户已要求清理旧原型、截图和重复源码，下面完整保留 PRD 版本快照的历史约定已被替代；当前入口为 PRD/index.html，文字历史见 PRD/CHANGELOG.md。

记录时刻：2026-10-01 17:29 UTC 之后的首轮环境检查。用户要求暂停当前轮，由父线程在下一轮显式指定 gpt-6.1-sol 继续；本文不推断当前运行模型。

## 已有可接受基线

- 工程：D:\_project\AI_pro\Perfboard。
- PRD 主入口：PRD/index.html，当前为 V3.1；V1/V2/V3/V3.1 完整历史快照保留。
- 当前根目录原有 README.md + PRD，正式应用代码尚未搭建。
- 未发现适用 AGENTS.md；项目内未发现 .agents/skills。

## 用户已明确确认

- 正式应用：Tauri 2 + React + TypeScript + Vite + SQLite，按 V3.1 界面基线迭代，不重设计。
- 状态库存为个人默认，精确数量可选；不强制扣料、不扩展多用户 ERP。
- 只搜索应用内部工具、物料、笔记；完全本地离线，无账号或云同步。
- 笔记接原版 Excalidraw，不实现自定义富文本卡片；本地打包字体/资源。
- 安装向导必须选择独立仓库数据目录，首启选择可作为恢复机制而非替代安装要求。
- 代码/缓存/测试数据尽量在本项目。不得删除项目外文件；必要软件允许官方来源下载并按默认目录安装。保留 PRD 历史。
- README 记录用户变更。用户授权并行独立子任务。
- 8 小时目标截止：2026-10-02 01:27 UTC。

## 已完成的环境只读检查

- Node v24.20.0；npm 11.19.0；Git 已安装。
- rustc / cargo 未在 PATH；工具链子任务进一步确认默认 .cargo/bin/rustc.exe 不存在。
- vswhere.exe 存在，但完整查询无 Visual Studio / C++ Build Tools 安装记录。
- Microsoft Edge WebView2 运行时目录存在。
- 主要风险：安装 VS C++ Build Tools 需数 GB 和数十分钟，Rust MSVC 也待安装。
- Windows 普通 sandbox exec 受 split writable roots 问题阻塞；此前 require_escalated 的具体项目操作通过自动审查。不能改安全设置。

## 已启动子任务与暂停要求

子任务 windows_packaging（/root/windows_packaging）：独占 src-tauri/installer/** 与 docs/WINDOWS-INSTALLER.md，负责官方工具链与 NSIS 目录向导方案。
本轮已要求其停止启动新下载/安装，在安全边界保存研究并结束。如安装已启动，保留进程实际状态，不强制中断。最终状态以该子任务回报为准。
未启动其他子任务。未搭建框架、安装 npm 依赖或启动正式应用。

## 下一轮建议先做

1. 读取子任务实际安装状态与 docs/WINDOWS-INSTALLER.md，再决定是否续接安装，避免重复启动。
2. 核实官方文档和许可证后锁定依赖版本；先写精简架构/数据流与共享接口，再分模块实现。
3. 使用统一 Rust SQLite 数据层控制用户选定的绝对仓库路径，勿默认 SQL 插件 AppConfig 路径已满足需求。
4. 前端共享仓库快照/查询，所有写入成功后统一刷新或失效，确保新建修改删除后工作台动态检索同步。
5. Excalidraw 保存 elements + appState + files，恢复 initialData.files/addFiles；本地 fonts 与 EXCALIDRAW_ASSET_PATH 在组件加载前设置，图片不发送外部服务。
6. 建立仓库/附件/笔记端到端闭环，随后托盘与安装包；执行 typecheck/lint/tests/build 和取消/重启恢复验证。

## 尚待设计而非已实现

- 数据库 schema / 迁移、事务、受管附件导入副本、完整备份恢复。
- Excalidraw 场景与图片的可靠 SQLite / 受管文件保存策略。
- NSIS 安装目录页与仓库目录页、权限验证及配置交接。
- 纯 TS 计算模块、模块注册、前后端接口、Windows 构建及安装包。

## 后续完成状态 — 2026-10-01 19:29 UTC

以上内容是首轮暂停时的历史记录。后续按用户授权的 Sol 并行任务完成正式应用、Rust/VS 工具链安装、真实原生回归和 NSIS 发布构建。当前状态以 README、CHANGELOG.md、docs/VALIDATION.md 及 deliverables/Perfboard-0.1.0 为准，不能继续把本文中的初始缺失工具链视为现有阻塞。

## 2026-10-08 当前补充

原有工程、D盘Rust缓存和当前0.1.0交付继续使用。最新制作单/健身/每日日志的源码、检查与交付事实见 docs/PRODUCTION-SHEET-FITNESS-20261008.md 和 D:\AI\perfboard-production-sheet-20261008\completion.json；不要把首轮缺失工具链或早期仅主题范围当作最新状态。未提交的磁芯详情修正和 PRD 草稿独立保留。
