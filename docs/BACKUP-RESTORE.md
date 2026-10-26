# 当前数据导出与恢复

`data/current/` 保存本次推送时的当前数据：完整主仓库 SQLite、当前附件目录、三份本机设置数据库，以及存在的两份外部工具配置。它不含历史数据库备份、导入前备份、SQLite 的 WAL/SHM 临时文件或 `repository.json` 本机仓库指针。

主数据库包含物料、笔记、开发日志及其历史、日志资源 BLOB、变压器记录和仓库设置。笔记画布中的图片数据与日志资源均随完整 SQLite 快照保留。导出时排除旧备份目录，应用业务数据中的修订历史仍保留在当前数据库；本地既有备份不受影响。

## 重新导出

在项目根目录运行，使用 Python 自带的 `sqlite3`，无需安装额外依赖：

```powershell
python scripts/export-github-data.py --repository 'D:\我的洞洞板仓库'
```

`--repository` 可指定仓库目录或其中的 `perfboard.sqlite3`。设置来源默认是 `%APPDATA%\com.perfboard.toolbox`，也可用 `--settings-dir` 指定；输出默认是项目的 `data/current/`。

源库只以 SQLite URI `mode=ro` 打开，使用 SQLite backup API 生成快照，不直接复制正在写入的数据库文件。每份数据库在一个只读事务内导出并比较逐表行数、逻辑摘要和 BLOB 摘要，再执行 `integrity_check`；日志资源另按数据库记录中的大小和 SHA256 核验。普通附件及工具配置复制前后校验 SHA256。

应用运行时也能导出单份数据库的一致快照；四份数据库依次捕获，不承诺它们属于同一瞬间。需要所有页面和设置同时停止变化时，先从托盘保存并退出应用，再运行导出。源数据库或 WAL 的前后字节发生变化会在脚本汇总中注明，这可能来自运行中的应用。

更新时先在临时目录生成并验证，各文件用原子替换写入，最后替换 `manifest.json`；不生成额外历史副本。若导出中断，应重新运行并核验清单后再提交。已有输出中出现不受清单管理的文件时，脚本会拒绝覆盖。

仅核验现有快照：

```powershell
python scripts/export-github-data.py --verify-only
```

`manifest.json` 只记相对文件名、字节数、SHA256、各表行数/逻辑摘要和创建时间，不写来源目录的本机绝对路径。数据库和工具配置内部可能保存外部程序的本机路径，这些记录按原内容保留。

## 恢复主仓库

1. 保存并退出洞洞板。
2. 必须将 `data/current/repository/` 的内容复制到一个新的空数据目录，保留 `perfboard.sqlite3` 与 `attachments/` 的相对位置。不要覆盖正在使用的仓库或残留旧 WAL/SHM 文件的既有库。
3. 启动洞洞板，在首次使用或仓库设置中选择这个目录作为已有仓库。

不要把仓库放进程序安装目录。无需恢复原机器的 `repository.json`：应用在选择仓库后自行保存新位置。Git 不保存空目录；若快照没有独立附件文件，恢复时可自行创建空的 `attachments/`，应用也会管理该目录。

## 可选恢复本机设置

在应用完全退出后，将 `data/current/settings/` 中需要恢复的文件复制到 `%APPDATA%\com.perfboard.toolbox\`，替换对应文件：

| 文件 | 内容 |
| --- | --- |
| `activity-log.sqlite` | 工作、休息等活动记录 |
| `standing-reminder.sqlite` | 久坐/健身提醒设置与状态 |
| `view-state.sqlite3` | 页面选择状态 |
| `external-tools.json` | 本机外部工具列表（存在时） |
| `external-tools-warehouse-import.json` | 外部工具仓库导入标记（存在时） |

替换某份设置数据库前，确认应用已经退出，并移除目标目录中该数据库同名的旧 `-wal`、`-shm` 临时文件，避免旧日志与新快照混用。不要复制其他机器的仓库指针。

跨电脑恢复后，外部程序路径需要按实际安装位置重新选择。与原仓库路径关联的页面选择状态在新目录下可能不适用；界面缩放、滚动等 WebView 本机状态也不全部保存在这三份设置数据库里。
