# 运放参考目录全部完成 — 2026-10-22

本轮在已完成的 9 个基础电路与 8 个比较器之上，完成当前参考目录剩余 21 项，共 38 项。保持模块独立目录、左侧分组选择、中央拓扑、下方公式与曲线；全局、侧栏、工作台与模块内均使用原搜索规则。未增加依赖，未修改后端、数据库结构或用户仓库。

## 已完成的参数确认修复

图上双击或键盘 Enter 打开编辑器，输入只进入草稿；Enter 或“完成”一次提交数值和单位。Esc、X、点空白及切换电路丢弃草稿，未确认内容不参与计算、公式或比较器记忆。图内模型参数同样需要 Enter / 勾号确认，失焦取消。详见前一修复记录 OPAMP-CONFIRM-EDIT-20261022.md。

## 实现

- `src/tools/opamp/library/` 包含新增电路元数据、标签、理想网络解、拓扑、数学步骤、响应曲线和工作区，原有基础和比较器模块保留。
- 复数节点解采用理想运放约束 V+ = V− 和零输入电流；电容导纳为 j2πfC。直流、正弦稳态及每级内部输出分别检查。
- 反馈比例可独立修改，不自动强制匹配。双向电流检测计入电阻输入支路对分流节点的负载；Howland 区分分流、反馈和真正负载电流，并检查反馈稳定方向。
- Sallen-Key 同时显示固有频率、Q 和 −3dB 频率，避免将三者混淆。TI 多反馈带通实际是两级二阶级联，全部电阻电容保留。
- 数字电位器 R1 允许 0Ω，由串联 R3 限制最大增益；反馈电容模型的高频增益趋近 1，不误画成完全低通到零。
- 麦克风通过灵敏度、测试负载阻抗和 RMS 声压换算电流，保留偏置、输入/输出耦合、反馈补偿及参考旁路；输出区分 RMS 和峰值。

## 模型范围

- 本模块为电路计算器，未接入 SPICE。交流曲线使用理想运放，GBW 仅供适用范围提示，未加入有限开环增益、压摆率、失调及寄生。
- PWM 保留 TI 的误差放大器/比较器平均值反馈，按平均平衡计算占空比，按积分充放电计算载波；波形相位仅示意，无传播延迟与开关纹波。
- 正弦振荡器对三个不同 RC 级求相位闭合与所需增益，环路增益不足时暂停波形。Vp 是显式可调假设，未预测稳态幅值和起振时间。
- 精密整流采用理想二极管的分段静态映射；全波 C1 作为过渡补偿列出，不将其当作平滑电容，未预测恢复和过零失真。
- 高压驱动按总反馈计算理想增益、输出峰值电流及负载功率。TI 文档的峰峰值不直接当作峰值；10 Vpp 输入对应本工具 Vp=5 V，输出约 50.2 Vpp、峰值电流约 251mA（100Ω）。静态偏置分压单独以 Vdrive=0 V 核算；MOSFET 阈值、交越、热行为、限流和实际稳定性未建模。
- 输入串联保护电阻和参考旁路等器件在理想条件下可能不改变信号增益；计算过程保留其阻值/极点/负载指标，不编造对输出的影响。

## TI 中文来源

参考电路来自 [TI 中文模拟电路资料库](https://www.ti.com.cn/zh-cn/design-development/analog-circuits.html)。本轮下载 21 份中文 PDF，提取公式并查看原图，重绘交互 SVG；参考 PDF 仅在本地验证缓存中，不打包到应用或交付资料。

| 电路 | TI 中文设计 |
| --- | --- |
| 交流耦合反相放大 | [ZHCA782](https://www.ti.com.cn/cn/lit/pdf/ZHCA782) |
| 交流耦合同相放大 | [ZHCA783](https://www.ti.com.cn/cn/lit/pdf/ZHCA783) |
| 低通反相放大 | [ZHCA855](https://www.ti.com.cn/cn/lit/pdf/ZHCA855) |
| Sallen-Key高通 | [ZHCADR0](https://www.ti.com.cn/cn/lit/pdf/ZHCADR0) |
| Sallen-Key低通 | [ZHCADQ8](https://www.ti.com.cn/cn/lit/pdf/ZHCADQ8) |
| 多反馈带通 | [ZHCADR2](https://www.ti.com.cn/cn/lit/pdf/ZHCADR2) |
| 跨阻放大器 | [ZHCA758](https://www.ti.com.cn/cn/lit/pdf/ZHCA758) |
| 低侧单向电流检测 | [ZHCA851](https://www.ti.com.cn/cn/lit/pdf/ZHCA851) |
| 低侧双向电流检测 | [ZHCA753](https://www.ti.com.cn/cn/lit/pdf/ZHCA753) |
| 改进型Howland电流泵 | [ZHCABC3](https://www.ti.com.cn/cn/lit/pdf/ZHCABC3) |
| PWM发生器 | [ZHCA756](https://www.ti.com.cn/cn/lit/pdf/ZHCA756) |
| 可调基准电压 | [ZHCA897](https://www.ti.com.cn/cn/lit/pdf/ZHCA897) |
| 正弦波振荡器 | [ZHCABD0](https://www.ti.com.cn/cn/lit/pdf/ZHCABD0) |
| 高压放大与电流提升 | [ZHDA138](https://www.ti.com.cn/cn/lit/pdf/ZHDA138) |
| 精密半波整流 | [ZHCA784](https://www.ti.com.cn/cn/lit/pdf/ZHCA784) |
| 精密全波整流 | [ZHCA779](https://www.ti.com.cn/cn/lit/pdf/ZHCA779) |
| 单端转差分 | [ZHCA752](https://www.ti.com.cn/cn/lit/pdf/ZHCA752) |
| 同相放大与基准偏移 | [ZHCA763](https://www.ti.com.cn/cn/lit/pdf/ZHCA763) |
| 分立可编程增益放大 | [ZHCA845](https://www.ti.com.cn/cn/lit/pdf/ZHCA845) |
| 同相麦克风前置放大 | [ZHCA853](https://www.ti.com.cn/cn/lit/pdf/ZHCA853) |
| TIA麦克风放大 | [ZHCA854](https://www.ti.com.cn/cn/lit/pdf/ZHCA854) |

## 验证与交付

本轮测试及生产前端交互结果原记录在 `.quality/opamp-remaining-20261022/`；交付清单以当时的 validation.json 和 delivery.json 为准。界面截图已按用户要求于 2026-10-27 清理。固定 EXE 替换前备份旧文件，候选与固定入口哈希一致后交付。保持 0.1.0，不重建安装器，不自动提交 Git 或推送远端；该轮原生桌面最终效果待用户验收。


验证结果：最终前端 **616 项通过、1 项原有跳过**，包含 **185 项运放测试**；类型检查、运放/注册/版本记录定向 ESLint、生产前端和正式 release 构建通过。原有 Vite 服务器退出超时提示及 Rust 10 条既有未使用警告保留，进程退出码为 0。

生产前端逐项核对新增 21 种电路的 **231 个图上编辑入口**：打开目标正确，留空草稿与 Esc 取消均不改变已生效图、公式或结果；每项另测提交后结果变化与恢复示例。比较器逐键输入 `2`、`2.`、`2.5` 保持低输出；确认 2.5 后仍保持低，真正确认越过阈值后才翻转，再确认 2.5 保持新的高状态。外点取消、模型确认、单位变更、0Ω 电位器、无效电容、切换取消、全局搜索与拼音搜索通过。三种主题无整页横向溢出，最终浏览器控制台无警告或错误。

最终源码对应构建重新抽查目录已开放 38 项、公式区布局与振荡器器件编号；正常 Howland 网络不再显示不适用的失稳结论。浏览器交互验证覆盖生产前端；未宣称已经完成原生桌面人工验收。本轮未重跑 Rust 测试（后端未变），不将既有 Rust 检查计作本轮新增证据。
