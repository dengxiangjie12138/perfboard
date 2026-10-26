# Perfboard 0.1 架构与实现约定

## 2026-10-07：设计记录与 v4 数据边界

当前 SQLite 结构版本为 v4。打开已有 v1/v2/v3 仓库时，先生成并验证完整迁移前备份，再在事务内迁移；失败回滚。v3→v4 只增加 `transformer_designs` 与 `transformer_design_history`，保留全部旧表与附件。仓库指针格式仍为 version 1。真实仓库的备份复制件已通过新调试 EXE 的无 GUI 迁移、重开和旧表逐行比较；真实仓库仍为 v3，等待用户正常打开新版。

变压器设计保存采用 revision 比较和原子历史记录。导入预览 token 与仓库路径绑定，用户每次确认一个候选，切库清空预览；JSON/XLSX 有输入大小、ZIP 展开和单元格数量限制。磁芯、来源参数和经 SHA256 验证的 PNG 字节属于设计自己的快照，后续库更新不会改变旧图纸。导出原子写入用户选择的仓库外文件。中文 PDF 使用随应用分发的 SIL OFL 字体，离线全量嵌入。

久坐提醒的恢复确认使用专用 Windows 低级输入钩子过滤明确注入事件，只保留活动时间聚合，不保存按键内容。休息中需要持续活动满 5 秒，事件间隔不超过 1 秒；确认期间仍计休息。过滤事件标志不能证明是真人，虚拟 HID 等来源无法认证。停用、暂停和退出负责停止监控，保存失败的停用也会清理线程。

以下段落保留既有模块及早期迁移的说明；本节和 [本轮说明](FIVE-GROUP-UPDATE-20261007.md) 描述当前新增行为。


记录：2026-10-03；版本仍为 0.1.0，包含统一搜索与工具多窗口。

## 数据流

React 模块 → `src/services/api.ts` → Tauri invoke → Rust commands → 单个 Repository Mutex → 用户目录内 SQLite / attachments。DataProvider 保存 committed snapshot，导航、工作台和搜索共用同一份数据。主窗成功变更调用refresh，Rust在成功提交后广播data-changed，所有窗口重读同一仓库；不维护第二套搜索数据库。

仓库指针位于 `app_config_dir/repository.json`，格式为 `{"path":"绝对路径","version":1}`；指针格式版本与数据库结构版本不同。仓库含 `perfboard.sqlite3`、`attachments`、`backups`。指针或数据不可用时显示恢复页面，不隐式创建空仓库。内部规范路径保留 Windows verbatim 形式，只有界面文字通过 `formatDisplayPath` 显示普通盘符/UNC 路径。

## 统一搜索与工具窗口（2026-10-03）

`src/services/search/` 将分词、数字边界、全拼与首字母别名集中到同一缓存匹配器，仓库、全局、页面和外部工具搜索共用它。记录字段变化会重新生成别名；提交后的完整snapshot是唯一数据来源，筛选全部匹配后才截取全局预览，不增加SQLite搜索表。物料采用现有无LIMIT快照，约1918条记录不需要额外索引服务。

`src/windows/tool-windows.json` 同时由TypeScript与Rust读取，限定八个工具、标签和本地路由。`src-tauri/src/tool_windows.rs` 异步创建Windows WebView，重复打开复用既有标签，只允许本地应用导航。主窗有打开工具、修改仓库/设置/附件、外部程序启动等权限；子窗仅有受控工具上下文、读取仓库、接收事件及自身关闭/显示主窗权限，不授予通用创建窗口、对话框、shell或事件发送能力。

`main.tsx` 按受控工具hash选择内容宿主，子窗不装载主侧栏和外部工具provider。各WebView具有独立React状态和保存注册表；所有窗口使用同一Rust Repository Mutex。变更提交并释放锁后发送data-changed，各DataProvider重新读取完整snapshot；主窗主题变更通知现有子窗，新子窗读取当前主题。Notes继续只在主窗编辑。

关闭协调器按窗口/动作/请求ID收集保存确认；旧确认和错误窗口确认不生效。子窗关闭只保存并销毁自身，主窗hide只隐藏自身；quit等待所有现有窗口，任一失败取消整批并恢复错误窗口。JSON草稿按稳定窗口标签隔离保存在WebView localStorage，版本化封装保存原字符串；读写失败不覆盖原值并阻止关闭。仓库备份不包含这些本机工具草稿。细节见[SEARCH-AND-WINDOWS.md](SEARCH-AND-WINDOWS.md)。

## 数据契约与兼容升级

JSON 使用 camelCase，错误通过 Result String 展示。数据库写入事务后响应；附件用随机文件名与相对路径，导入复制原件。仓库根目录、附件目录和文件每次操作都验证解析后的边界。

`parts`：id/name/category/packageName/parameters/stockStatus/quantity/location/brief/url/lcscNumber/brand/createdAt/updatedAt。`name` 保持稳定内部字段，显示标签为“型号”；`parameters` 仅为历史兼容字段，表单和列表不再提供重复参数。品牌和商城编号都是默认空文本，编号不转为数值。

数据库 `user_version` 从 v1 到 v2 在同一事务中新增 `lcsc_number` / `brand` 默认空文本列。旧参数非空、不同于型号且未出现在简介中时，以“历史参数：”追加到简介；原字段保留。成功后设置 v2，重复打开不再执行；失败回滚。只读验证接受支持的 v1/v2，不执行迁移；真正打开已有仓库时才兼容升级。旧程序不支持 v2，更新前完整备份方便恢复。

`notes`：id/title/category/searchText/sceneJson/createdAt/updatedAt。sceneJson 含 elements、appState、files；摘要查询不返回大场景。`attachments` 与 `settings` 继续共用现有接口。

## 模块边界

| 目录 | 职责 |
| --- | --- |
| `src/tools/feedback/` | 反馈电阻界面、电流/功耗算法、库存阻值解析、私有示意图与测试 |
| `src/tools/stm32-timer/` | 定时器界面、PSC/ARR 算法、私有波形与测试 |
| `src/tools/shared/` | 数值校验、单位显示、公共表单与计算样式 |
| `src/tools/registry.ts` | 工具分组、标题、搜索词、图标和页面入口 |
| `src/navigation/` | 主导航、全局搜索、路由内容、页面标签与共享数据搜索 |
| `src/features/parts/` | 物料界面、位置候选与相关测试 |
| `src/features/notes/` | 概览/分类画布布局、场景恢复与笔记测试 |

旧 `src/domain/calculations.ts` 只做兼容导出，`src/features/calculations/` 保留兼容入口，不再集中承载算法。增加工具时建立独立目录并注册入口，保持共享组件与私有组件边界；不引入动态插件引擎。

反馈电流为 `Vref/Rbottom`，功耗分别为 `I²Rtop` / `I²Rbottom`。候选计算出的实际 Vout、误差、电流与功耗使用同一组阻值。标准值和库存执行同一个硬上限过滤器；显示误差归零不改变算法比较。

## 保存与笔记布局

hydrate 完成才接收变更；编辑保存绑定 note ID。debounce 600ms、最大延迟 3000ms，串行队列避免旧快照覆盖新快照。切换笔记、页面、分类或关闭/托盘退出前 flush；失败保持草稿和当前窗口。native close 请求前端保存，完成后确认隐藏/退出。

只有笔记概览显示介绍横幅和完整笔记本面板。分类页固定当前分类，使用紧凑选择器和新建操作，画布扩展。移动当前笔记到其他分类先保存，再清除当前分类中已不适用的选择。无法完整恢复的场景继续阻止覆盖并可导出原始 JSON。

## 本地运行与交付

Excalidraw 原版编辑器及字体本地打包；CSP 阻断隐式外网。Windows 使用单实例和托盘。完整备份使用 SQLite backup API，并复制附件。

默认安装配置为 Tauri `downloadBootstrapper`，检测缺少 WebView2 时下载运行时；应用业务功能离线工作。原离线包为旧构建备用历史产物。调试验收用不同 identifier、`PERFBOARD_TEST_CONFIG_DIR` 和项目内 WebView2 profile，避免与用户实例或真实仓库交互。实际覆盖和未验范围记录在 `VALIDATION.md`。

## 接入外部开源工具

有正规的 npm/Cargo 包时使用依赖管理与锁文件，如 Excalidraw，不复制整仓库。需要 vendor 完整源码时放在 third_party/工具名，保留上游许可证、来源地址和锁定版本；接入代码放在对应 src/tools/工具名 模块。优先保持上游原样，将适配放在自己的模块中；必须修改上游时单独记录差异与升级方法。本批只确立约定，没有下载新工具或创建空模块。


## 2026-10-03 仓库结构与窗口工作流

窗口与记录、近似搜索、开发日志、自动备份和主动登录启动已实现；版本仍为0.1.0。规则、迁移与剩余验证边界见 [WORKFLOW-UPDATE.md](WORKFLOW-UPDATE.md)。本批新构建放在独立准备目录，固定交付未自动合并；没有匹配最新功能的安装器。
