# 变压器设计记录主题修复 · 2026-10-08
版本保持 **0.1.0**。本轮仅响应变压器设计记录与上位机主题不一致的问题。

模块原来引用不存在的 --background、--card、--foreground 和 --muted-foreground，退回独立配色；系统深色媒体查询又绕过应用所选主题。现已映射为全局 --bg、--surface、--text、--muted、--border 和 --accent，输入框使用 --input，记录/标签/候选选中态使用 --wash，侧栏使用 --side。焦点与导入单选框使用全局强调色。警告、错误和成功仍分别使用已有语义变量，文本与触发行为不变；附图继续保留白底以支持透明黑色线稿。

主窗口已有 data-theme 和 setSharedTheme；独立窗口已有 useSharedTheme，先监听广播，再读取共享主题，并防止旧读取覆盖较新事件。本轮不修改这条状态链，CSS 自动继承三种主题。

## 已完成的检查

- TypeScript 和 ESLint 通过。
- 现有变压器模块与窗口的 6 个测试文件、33 项用例通过。
- 隔离浏览器运行实际冻结组件，使用纯内存合成记录：主/独立容器、三主题、两种系统外观共 12 组检查全部通过；系统外观不再覆盖应用主题。额外核对工序、导入对话框/候选/单选框与焦点。
- 六张截图已生成；已人工查看三个主题与 Codex 独立容器，无整片蓝灰配色。它们是浏览器合成容器截图，不是真实 Tauri 窗口。
- 最终生产前端、release EXE 构建通过，169 个最终 JS/CSS 资源键、内置字体与代表性磁芯图片键已核对。
- 源码基线为 85cafc4；已有 CoreLibraryPage.tsx 的磁芯过滤详情同步修正保留并随候选构建，不纳入本轮样式提交。已有 PRD/standing-reminder-preview.html 不改动。
- 本轮未访问真实资料仓库，未改数据结构、计算、导入导出或警告含义；未远程发布，未重建安装器。

## 交付与剩余检查

候选：D:\AI\perfboard-theme-20261008\prepared-delivery\app\perfboard.exe，**38,057,984 字节**，SHA256：3a53030fff48ae2fff54060d6919bfa6a266ceb8f13270584a021aa05f180afd。

旧程序备份：D:\AI\perfboard-theme-20261008\backups\fixed-before-theme，旧 EXE SHA256：67c9bbc0de7db72395dd716366a46df58080c4fa515743921e11e523d5c5cba7。

固定程序 deliverables/Perfboard-0.1.0/perfboard.exe 仍运行，本轮没有强制关闭或覆盖。先保存并正常退出，再只把候选 app 中三个运行文件按原文件名复制到固定目录；不要把整个准备目录覆盖固定目录。原有外部工具和其它交付文件保留。候选 manifest 与 SHA256 清单位于 prepared-delivery。

原生 GUI 由用户测试：在主窗口切换 Codex/浅色/深色，查看变压器记录；打开独立记录窗口，核对打开时继承和已打开后实时同步。原生窗口事件仅完成源码审查，没有宣称已实测。

参考图片 libfile_1a16ff7047d481918984bcd931c930a4 使用当前 Library 技能的 prepare_materialize 与官方 helper 尝试本地读取，下载得到 HTTP 403，没有生成可读取本地原图。本轮依据父线程已实际看图的观察和源码独立确认根因。

证据与缓存仅写入 D:\AI\perfboard-theme-20261008；复用此前 D 盘 Cargo 缓存。quality/theme-browser-checks.json、quality/release-artifact-verification.json 及构建/检查日志记录实际结果。新可运行浏览器快照位于 prd/index.html，历史快照保持原样。
