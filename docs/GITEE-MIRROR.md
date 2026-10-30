# Gitee 自动镜像

GitHub 主仓库为 [dengxiangjie12138/perfboard](https://github.com/dengxiangjie12138/perfboard)，Gitee 镜像为 [deng-xiangjie/perfboard](https://gitee.com/deng-xiangjie/perfboard)。GitHub 继续负责开发与正式发布，工作流负责把代码和已验证的发布文件同步到 Gitee。

工作流：[gitee-mirror.yml](../.github/workflows/gitee-mirror.yml)。Git 与索引协调脚本：[run-gitee-mirror.py](../scripts/run-gitee-mirror.py)。发布镜像脚本：[mirror-gitee-release.mjs](../scripts/mirror-gitee-release.mjs)。

## 首次配置

1. 准备一个能够写入目标 Gitee 仓库、创建 Release 和上传附件的 Gitee 访问令牌。它的账号必须拥有该仓库的相应权限。
2. 打开 GitHub 仓库的 [Actions Secrets 设置](https://github.com/dengxiangjie12138/perfboard/settings/secrets/actions)，新增 Repository secret，名称为 **`GITEE_TOKEN`**，值为该令牌。
3. 在 GitHub 的 **Actions → Mirror to Gitee → Run workflow** 中选择 `main`，`mode` 选择 `sync`，勾选 `seed_history`，执行首次补齐。它会依次处理已发布的 `v0.1.1`、`v0.1.2`。

令牌只填写到 Secret；不要放进源码、README、Git remote URL 或聊天记录。工作流固定 Gitee 用户名为 `deng-xiangjie`，GitHub 读取凭据使用自动提供的只读 `github.token`，无需另配 GitHub 个人令牌。

**令牌尚未配置时，自动任务正常跳过。** Actions 摘要会写明“尚未配置 GITEE_TOKEN，未同步”，不会因为缺少令牌而让每次推送报错。配置好后再手动执行一次 `sync` 即可补齐。

## 自动触发与手动补齐

| 操作 | 同步内容 |
| --- | --- |
| 推送 GitHub `main` | 当前 `main` 和所有正式语义版本标签 |
| 推送 `vX.Y.Z` 正式标签 | 同步代码与正式版本标签；安装附件等到正式 Release 发布后再同步 |
| 发布正式 GitHub Release | 同步代码、标签及该版本的发布文件，验证后更新镜像索引 |
| 手动 `sync`，只填写 `tag` | 补齐指定正式发布，例如 `v0.1.2` |
| 手动 `sync`，勾选 `seed_history` | 补齐 `v0.1.1` 与 `v0.1.2`，同一次提交发布完整索引 |
| 手动 `sync`，不填写 `tag` 且不勾选历史 | 仅同步代码与正式版本标签 |

发布输入与镜像标签统一使用带 `v` 的正式格式，例如 `v0.1.2`。无 `v` 标签、预发布、草稿、测试分支和本地备份分支不会进入自动发布镜像。`v0.1.0` 的代码标签可同步；该旧安装包没有更新签名，不进入已验证的应用内更新索引。

任务按同一队列串行执行。补齐历史版本和重复运行不会把镜像最新版本倒退到旧版。

正式 `sync` 遇到网络连接、传输超时、HTTP 408/429/5xx 或更新索引竞争时，最多尝试 **3 次**（首次加 2 次自动重试），重试前分别等待 **30 秒、60 秒**。每轮重新读取远端代码、Release、附件和更新索引；已存在的附件必须通过大小、哈希校验才会复用，缺少的才补传。无需人工反复点击重新运行。权限、签名、内容冲突等确定性错误会立即停止。

Actions 整个任务的硬时限为 75 分钟。连续暂态失败会显示红色失败状态，并在任务摘要列出重试情况；是否收到邮件或站内通知取决于 GitHub Actions 通知设置。手动取消、运行器中断或触及任务硬时限不会自动启动另一个任务。

## 不配置令牌也能检查流程

在 **Run workflow** 选择：

- `mode=validate`：运行 Python 临时本地 Git 仓库测试及 Node 发布镜像脚本隔离测试。覆盖精确分支/标签同步、不同历史拒绝、JSON-only 独立索引、索引并发保护和缺令牌跳过；不访问真实 Gitee 写接口，不推送真实远程仓库。
- `mode=dry_run`：填写 `tag` 或勾选 `seed_history`，只读下载并验证 GitHub 发布材料与签名，不上传 Gitee 附件、不推送 Git，也不写入镜像更新索引。

这两种模式不需要 `GITEE_TOKEN`。`dry_run` 能确认源发布是否完整、签名是否匹配；目标 Gitee 的实际写入权限与附件上传是否成功，需要配置令牌后的 `sync` 才能验证。

本地只运行隔离测试的命令：

```sh
python -m unittest discover -s scripts/tests -p test_gitee_mirror.py
node --test --test-isolation=none scripts/tests/mirror-gitee-release.node-test.mjs scripts/tests/probe-gitee-upload.node-test.mjs
```

工作流通过 `python3 scripts/run-gitee-mirror.py` 执行协调过程；`--authorize-only` 与 `--select-releases` 分别用于授权状态和发布标签选择。模式与标签由 Actions 输入转成环境变量，用户输入不拼进 shell 命令。测试只写临时本地仓库，正式镜像通过工作流运行。

## 单次隔离上传验证

`mode=verify_upload` 仅可手动运行，需要已配置 `GITEE_TOKEN`；`tag` 留空、不要勾选 `seed_history`。它使用固定的已签名 `v0.1.2` 安装包，创建唯一的 `mirror-upload-probe-...` 临时标签和预发布，验证云端实际上传及公开下载的哈希与签名。它不修改正式版本、源码分支或更新索引，也不会自动重试上传。

隔离探测使用 curl 原生 multipart 编码及 IPv4，curl 传输期限为 590 秒，外层总传输期限为 600 秒。日志只记录经过校验的传输字节数、耗时、IP、协议与 HTTP 状态，不记录令牌、请求正文或原始错误输出。

只有确认临时 Release 已移除后，任务才按原始提交校验并删除自己创建的临时标签。归属发生变化、接口结果无法确认或标签被其他操作更新时，任务停止并在摘要中保留临时标签名称供检查；不会扩大清理范围或删除正式版本。该诊断与同步任务共用同一个串行队列。

中断后需要恢复清理时，手动选择 `mode=cleanup_upload`，`tag` 填完整临时探测标签，`release_id` 填已确认的临时 Release ID，不勾选 `seed_history`。此模式仅核对归属并清理该临时 Release 与标签，不创建标签、发布或上传安装包；正式版本标签不被接受。标签已经不存在时仍可确认临时 Release 已清理，结果不明时保留资源并报错。

## 代码、发布附件与更新索引

代码同步只推送 `main` 和符合正式 SemVer 的标签。它不用 `--mirror` 或 `--all`，不会带上本地旧历史备份分支；不会强推 `main`、覆盖已存在的不同版本标签或删除 Gitee 其它分支。已有 Gitee 内容与 GitHub 历史不一致时，任务停止并提示人工处理，不会自动丢弃内容。

Release 附件独立于 Git 历史。镜像脚本读取正式 GitHub Release，校验安装 EXE、更新签名、清单与校验文件，再上传或复用 Gitee 对应附件。签名密钥不参与镜像任务；安装包与签名保持原样，镜像清单使用验证后的 Gitee 稳定下载地址，不保存会过期的临时 CDN 签名链接。

正式上传默认使用已验证的 curl 原生 multipart、IPv4，curl 期限 890 秒、外层期限 900 秒（15 分钟），元数据仍为 180 秒。令牌只通过 stdin 作为普通表单字段传入；临时文件仅包含已验证的公开附件，操作结束即清理。2026-10-30 的[真实云端隔离验证](https://github.com/dengxiangjie12138/perfboard/actions/runs/40924742555)已上传约 28.65 MB 安装包，获得 HTTP 201，公开下载的哈希及签名一致，随后确认临时 Release 和标签均已移除。

正式期限按实测慢链路调整：0.1.4 首次同步在 590 秒时已发送约 26.74 MB，达到 28.67 MB 安装包的约 93%，仍在传输而非静止等待。因此将正式上传窗口扩展至 15 分钟，保留 curl 比外层提前 10 秒结束的边界。底层不会直接重放上传 POST；暂态失败由外层同步协调器等待后重新查询远端，再决定复用或补传。隔离探测仍固定为外层 600 秒、curl 590 秒，不随正式期限扩大，也不启用这套正式同步重试。

**`gitee-updates` 是专用更新索引分支，只有 JSON 文件，不含程序源码或数据库。** 其中：

- `latest.json`：已经完整同步并验证的最新正式版本。
- `versions.json`：可供后续国内镜像功能读取的正式版本列表。
- `releases/vX.Y.Z.json`：对应历史版本的更新清单。

工作流先完成附件验证，最后把该次索引改动提交为一个 Git 提交。推送使用 compare-and-swap 校验：如果期间索引分支被其它操作更新，本轮推送会被拒绝；协调器在重试次数内丢弃本轮临时索引，重新读取远端索引、验证附件并提交。不会沿用旧索引强行覆盖其它更新。任务不会用 Gitee 的“最新 Release”排序来判断资产是否完整。

请将 `gitee-updates` 保留给自动任务维护。它不会被普通代码同步覆盖。

## 失败与重试

- **缺少令牌**：任务跳过；添加 `GITEE_TOKEN` 后手动运行 `sync`。
- **认证或权限不足**：检查令牌是否有效，账号是否具有仓库写入、Release 与附件权限；不要把令牌贴到日志或问题描述中。
- **代码历史或标签冲突**：先核对两端历史，保留需要的内容，再重试；工作流不会自动强制覆盖。
- **源文件缺失、签名或哈希不符**：修复 GitHub Release 后重试。未验证的内容不会进入更新索引。
- **上传超时、连接失败、408/429/5xx 或索引竞争**：自动等待并重试，最多 3 次。三轮均失败后，再等待服务恢复并重新运行同一 `tag`；脚本会核对已有材料，完整一致的资产可以复用。

元数据 GET 和公开附件下载 GET 的连接或 DNS 失败在单轮内最多重试两次，所有尝试共用同一请求或重定向跳的 180 秒期限。公开下载的每一跳仍检查来源白名单，且始终不携带 API 凭据。其它可识别的暂态 HTTP、响应头或正文传输错误交给外层同步重试；底层 POST、PATCH、DELETE 不自动重放。上传结果不明时，下一轮先重新查询并验证同名附件，已被服务接收的包可以直接复用；若发现重复、异名或不同内容，立即停止，不擅自删除或覆盖。
- **签名能上传、EXE 持续超时**：代码同步成功不代表发行版附件已完成。可先在 Gitee 对应版本的编辑页上传原始、同名的安装 EXE，保留预览状态、标签、标题和说明，再重跑该 `tag`。任务会匿名下载并校验已有附件，补齐清单与校验文件后才发布更新索引；不要改名、重新打包或重新签名来绕过校验。

## 与洞洞板现有更新功能的关系

这套流程准备国内镜像的代码、附件和更新索引。当前 `0.1.2` 客户端的检查、历史版本列表及下载地址校验仍使用 GitHub；接入“国内镜像”选项时，还需要在应用中配置并验证 Gitee 来源。创建镜像仓库或同步附件不会自动改变已经安装的客户端更新源，也不会替换本机正式程序。

工作流使用最小 `contents: read` GitHub 权限，不在 Pull Request 中运行。官方 Actions 固定提交：

- [actions/checkout v7.0.1](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1)
- [actions/setup-node v7.1.0](https://github.com/actions/setup-node/tree/949feb2413d6458794dcd2491c4babbbce0c15c1)

并发队列行为依据 [GitHub Actions 官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
