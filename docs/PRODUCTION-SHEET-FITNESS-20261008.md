# 制作单、工作与健身和每日久坐记录 — 2026-10-08
版本保持 **0.1.0**。在原工程内延续已确认的轻量制作单和全局主题，没有重新搭建应用。

变压器页面直接使用 React、既有仓库服务与修订历史。名称用于导出文件名，磁芯型号/材质自由填写；绕组按顺序记录线径、股数、圈数、胶带和起止套管，电气指标可填写任意引脚对和 kHz 频率。线径/股数单行，单股显示“单股并绕”；所有表头和短字段居中。紧凑 PRI/SEC 端点图、SEC 镜像、BOBBIN 层次图由同一 SVG 实现生成预览、SVG 和中文 A4 PDF。长备注保留换行，标题和表格使用字体实际尺寸分页。

兼容性：仅给旧 schemaVersion 1 DTO 增加可选 productionSheet。保留旧字段、来源、磁芯参数/冲突和附件，不批量导入旧示例，不升级仓库结构。旧记录只在编辑时投影，完整旧 PDF 仍可导出。保存仍使用既有 CAS 校验；保存失败不离开。制作单切换/结束/窗口关闭提供保存并离开、放弃并离开、继续编辑；无效草稿可放弃，跨窗口实际关闭取消时保留草稿。

“工作与健身”位于常用小工具的久坐提醒之后，可搜索和开独立窗口。一个原生 500ms 采样服务共用既有输入来源，健身使用独立状态机和 fitness_state 配置行。默认关闭，10 分钟活动阈值、30 秒空闲阈值可调整；俯卧撑、深蹲、马步初始均未勾选，动作可编辑。只对勾选动作等概率随机；空动作池有明确提示。完成、稍后、跳过分别记入最近200条处理记录，收起不代表完成。提示使用既有无激活窗口策略，不自动锁屏。活动属于估计，键盘鼠标不会重复相加；锁屏、睡眠、输入来源不可用、异常大间隔、停机时间不补算。设置草稿离开前保存，失败保留草稿；损坏 JSON 原文不被默认状态覆盖。

久坐页面新增按本机日期浏览的每日工作/休息时段和汇总。activity-log.sqlite 位于独立应用配置目录，不属于用户物料仓库。日志直接消费旧状态机分配的时间段，保留短暂触碰不结束休息、非注入聚合操作满5秒确认恢复的规则。固定 monotonic/UTC 映射避免每次采样细碎分段；午夜按真实本地日历切分并保存历史偏移。只允许在已确认系统休息起点之后截断延迟恢复；先处理队列事件再切换墙钟映射，未知间隔不补算。正常退出封闭最后确认端点；异常退出/重启不延伸尾段，标记未完整。写入失败事务回滚、保留待写批次并显示错误。

## 验证与边界
- 前端 TypeScript、相关 ESLint 检查通过。
- 原生久坐/健身/日志相关76项及变压器保存/导出20项通过；真实旧 XLSX fixture 默认 ignored，未重复运行。
- 制作单/导航/窗口/久坐前端73项、13个文件全部断言通过，runner退出码0；存在既有Vite服务清理超时提示，已如实记录。正式组件内外部三选离开、root inert下真实点击、失败保存保护通过；六组主题/容器和最终排版短验通过。实际中文PDF生成两页A4，已逐页渲染并查看，无裁切、重叠或缺失。
- 参考图使用 Library prepare_materialize 官方流程尝试本地传输，返回 HTTP 403；按父线程已实际看图确认的要求独立实现，不声称本地原图可读。
- 原生 GUI、实际跨应用焦点、键鼠/锁屏/睡眠与系统保存对话框由用户测试，未宣称完成。没有修改系统安全/网络设置。
- 未访问或改写 D:\洞洞板\洞洞板仓库，未修改1918条物料、笔记或附件。保留原有 CoreLibraryPage.tsx 和 PRD/standing-reminder-preview.html 未提交改动，未纳入本轮提交。
- 当前构建及交付事实以本轮 completion.json 为准。缓存、构建、证据与旧程序备份都放 D:\AI\perfboard-production-sheet-20261008。安装器未重建，无远程发布。

## 实际交付 — 已完成

固定入口：`D:\_project\AI_pro\Perfboard\deliverables\Perfboard-0.1.0\perfboard.exe`。候选：`D:\AI\perfboard-production-sheet-20261008\prepared-delivery\app\perfboard.exe`。新EXE **38657536 字节**，SHA256 `6e9532f7587a314f7acb727deb633a12e761318b8db653035b9b2e97b692006e`，两者逐字节一致。源码提交 `19a77ed3479a587f99483791726a9986da35281c`。

旧程序及交付元数据备份：`D:\AI\perfboard-production-sheet-20261008\backups\fixed-before-production-sheet`，旧EXE SHA256 `3a53030fff48ae2fff54060d6919bfa6a266ceb8f13270584a021aa05f180afd`。替换前确认没有运行中的Perfboard，没有强杀进程。仅合并三个运行文件，并更新固定目录的manifest/SHA256；237个其他交付文件逐项核验保持原样。没有重建安装器或远程发布。

实际证据：本轮 completion.json、quality/delivery-applied.json、quality/release-artifact-verification.json、quality/qa-summary.json、quality/source-hashes-before-build.json。正式release使用既有D盘Cargo缓存，169个JS/CSS资源及变压器字体/资源名称在EXE中核对；源码哈希在构建期间保持不变。

同一个独立HTML原型已完成最后排版，D:\AI\perfboard-transformer-prototype-20261008\index.html 为 58987 字节，SHA256 `bf5b6fc66a90defa45387ef485553347ea6e380bba9deb62bed073a85b4f82cd`；全部30个表头居中、线径单行、无body横向溢出的最终8项短验通过。原型localStorage不参与正式仓库保存。
