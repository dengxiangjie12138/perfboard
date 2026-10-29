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

## 不配置令牌也能检查流程

在 **Run workflow** 选择：

- `mode=validate`：运行 Python 临时本地 Git 仓库测试及 Node 发布镜像脚本隔离测试。覆盖精确分支/标签同步、不同历史拒绝、JSON-only 独立索引、索引并发保护和缺令牌跳过；不访问真实 Gitee 写接口，不推送真实远程仓库。
- `mode=dry_run`：填写 `tag` 或勾选 `seed_history`，只读下载并验证 GitHub 发布材料与签名，不上传 Gitee 附件、不推送 Git，也不写入镜像更新索引。

这两种模式不需要 `GITEE_TOKEN`。`dry_run` 能确认源发布是否完整、签名是否匹配；目标 Gitee 的实际写入权限与附件上传是否成功，需要配置令牌后的 `sync` 才能验证。

本地只运行隔离测试的命令：

```sh
python -m unittest discover -s scripts/tests -p test_gitee_mirror.py
node --test --test-isolation=none scripts/tests/mirror-gitee-release.node-test.mjs
```

工作流通过 `python3 scripts/run-gitee-mirror.py` 执行协调过程；`--authorize-only` 与 `--select-releases` 分别用于授权状态和发布标签选择。模式与标签由 Actions 输入转成环境变量，用户输入不拼进 shell 命令。测试只写临时本地仓库，正式镜像通过工作流运行。

## 代码、发布附件与更新索引

代码同步只推送 `main` 和符合正式 SemVer 的标签。它不用 `--mirror` 或 `--all`，不会带上本地旧历史备份分支；不会强推 `main`、覆盖已存在的不同版本标签或删除 Gitee 其它分支。已有 Gitee 内容与 GitHub 历史不一致时，任务停止并提示人工处理，不会自动丢弃内容。

Release 附件独立于 Git 历史。镜像脚本读取正式 GitHub Release，校验安装 EXE、更新签名、清单与校验文件，再上传或复用 Gitee 对应附件。签名密钥不参与镜像任务；安装包与签名保持原样，镜像清单使用验证后的 Gitee 稳定下载地址，不保存会过期的临时 CDN 签名链接。

**`gitee-updates` 是专用更新索引分支，只有 JSON 文件，不含程序源码或数据库。** 其中：

- `latest.json`：已经完整同步并验证的最新正式版本。
- `versions.json`：可供后续国内镜像功能读取的正式版本列表。
- `releases/vX.Y.Z.json`：对应历史版本的更新清单。

工作流先完成附件验证，最后把该次索引改动提交为一个 Git 提交。推送使用 compare-and-swap 校验：如果期间索引分支被其它操作更新，本次推送会失败，重新运行即可基于最新索引重试。任务不会用 Gitee 的“最新 Release”排序来判断资产是否完整。

请将 `gitee-updates` 保留给自动任务维护。它不会被普通代码同步覆盖。

## 失败与重试

- **缺少令牌**：任务跳过；添加 `GITEE_TOKEN` 后手动运行 `sync`。
- **认证或权限不足**：检查令牌是否有效，账号是否具有仓库写入、Release 与附件权限；不要把令牌贴到日志或问题描述中。
- **代码历史或标签冲突**：先核对两端历史，保留需要的内容，再重试；工作流不会自动强制覆盖。
- **源文件缺失、签名或哈希不符**：修复 GitHub Release 后重试。未验证的内容不会进入更新索引。
- **上传、限流或索引竞争失败**：等待服务恢复，重新运行同一 `tag`。脚本会核对已有材料，完整一致的资产可以复用。
- **签名能上传、EXE 持续超时**：代码同步成功不代表发行版附件已完成。可先在 Gitee 对应版本的编辑页上传原始、同名的安装 EXE，保留预览状态、标签、标题和说明，再重跑该 `tag`。任务会匿名下载并校验已有附件，补齐清单与校验文件后才发布更新索引；不要改名、重新打包或重新签名来绕过校验。

## 与洞洞板现有更新功能的关系

这套流程准备国内镜像的代码、附件和更新索引。当前 `0.1.2` 客户端的检查、历史版本列表及下载地址校验仍使用 GitHub；接入“国内镜像”选项时，还需要在应用中配置并验证 Gitee 来源。创建镜像仓库或同步附件不会自动改变已经安装的客户端更新源，也不会替换本机正式程序。

工作流使用最小 `contents: read` GitHub 权限，不在 Pull Request 中运行。官方 Actions 固定提交：

- [actions/checkout v7.0.1](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1)
- [actions/setup-node v7.1.0](https://github.com/actions/setup-node/tree/949feb2413d6458794dcd2491c4babbbce0c15c1)

并发队列行为依据 [GitHub Actions 官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
