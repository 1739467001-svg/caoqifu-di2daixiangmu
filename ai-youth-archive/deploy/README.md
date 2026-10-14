# 当前服务器的增量发布

目标：`https://112.74.63.237/ai-youth/`。本目录只准备脚本，不表示已发布。

## 分离代码与私人资料

- 静态网站：`/var/www/ai-youth-archive/releases/<版本>/`；`current` 原子切换。
- API 与运营工具：`/opt/ai-youth-archive/releases/<版本>/server.py`、`manage.py`；独立 `current`。**不得把后端源码放进 Nginx 静态目录。**
- 数据：`/var/lib/ai-youth-archive/archive.sqlite3`；附件在同目录 `files/`。数据不随代码发布替换、不设静态路由。
- 服务：`ai-youth-archive.service`，专用非登录用户 `ai-youth`，Python 3.9+ 标准库，只监听 `127.0.0.1:8789`。
- 原 Nginx 配置：`/etc/nginx/sites-available/tanxun`。在两个已有 `/ai-youth/` 静态路由前，加入该应用专用 `/ai-youth/api/` 前缀代理至 `http://127.0.0.1:8789/api/`，上传请求上限 15 MiB。该 API 的 HTTP 请求重定向到同一授权网站的 HTTPS；原站其他路由、证书与代理配置不变。
- 可选私有运行配置：`/etc/ai-youth-archive/runtime.env`；不会创建、读取输出、复制或覆盖。不要将任何短信密钥放进 dist。
- 每人附件容量当前 100 MiB，单文件 10 MiB，全站附件预算 2 GiB、试用账号上限 200，以后端实际状态为准；短信没有配置时保持不可用，不模拟验证码成功。

## 发布前只读检查

在工作区运行 `node deploy/prepare-package.cjs`。在阿里云目标实例的命令助手运行生成的 `deploy/generated/preflight-command.sh`。检查：

1. Python >= 3.9、Nginx 原配置语法通过，剩余内存和磁盘能承担新服务。
2. 8789 空闲；若已有该应用服务，确认其状态与归属。
3. 静态 current 指向预期 releases 下的版本，线上源码是本轮准备改动的基线。
4. HTTP/HTTPS 原站可访问。脚本会比较原主页内容，不能趁本次发布修改其他项目。

历史部署记录中的内存和配置哈希不能当作当前状态。本脚本从当前文件计算哈希并保留原件，不使用旧哈希。

## 分段上传与校验

`prepare-package.cjs` **只打包公开静态文件、backend/server.py、backend/manage.py、backend/community_comments.py、服务定义及安装工具**。不会打包项目笔记、浏览器数据、环境变量、`.private-notes`、原探询文件或密钥。

1. 代码和测试完成后重新运行打包，避免发布编写过程中的旧包。
2. 按 generated/manifest.json 列出的顺序，将 `001-upload.sh`、`002-upload.sh` 等作为独立命令助手命令运行。整条命令经过 Base64 编码后仍不超过 16 KiB；每段有哈希，重复运行同一段安全。每次重新打包都会使用不同摘要目录，不混用旧段。文本源码使用 UTF-8 直接压缩，二进制仍使用 Base64，恢复后逐个核对原始字节摘要。
3. 运行 `verify-and-plan.sh`，重新组装校验全部文件，执行只读检查与只读发布计划。**这一步不发布。**
4. 核对目标和计划，再运行 `apply-release.sh`。该脚本才传入 `--apply` 实际更新。

阿里云命令助手的当前长度限制应以控制台为准。若单段仍超限，只调低打包器 11500 字符分段长度后重新生成整套命令，不手工截断。

## 实际变更与回退

安装器用进程锁避免重复发布，准备新目录，显式设置代码目录 0755（不受 root umask 影响），检查服务账号、数据目录和备份所需空间，备份当前 Nginx/服务定义/版本指针；已有 API 服务会短暂停止，私人数据复制到服务器上的 root-only 备份目录。服务只拥有自己的数据目录权限。

先启动并检查回环 API，再切换静态 current、插入 Nginx 路由、执行 `nginx -t` 并 reload。验证公网 HTTPS 状态接口（正常校验证书）、全部静态文件摘要与原探询首页。成功写入 `/var/backups/ai-youth-archive/<版本>/receipt.json`。

若服务启动、配置校验或网站验证失败，恢复前一份配置、静态/后端指针与服务定义，恢复之前的服务运行状态。部署中若发现其他进程修改配置或指针，拒绝覆盖对方变更并要求检查备份。**自动回退不覆盖数据库**，避免丢失更新期间的新数据。历史发布目录、数据和备份都保留。不要自动清理私人资料。

首次更新会留下专用系统账号、数据目录和未启用的新版本用于排查；这不影响原网站。手工回退数据库前应检查是否已有新用户资料、另做备份，并确认兼容性。

## 发布后还要检查

- 公网 HTTPS 正常；`/ai-youth/api/status` 返回 ready。
- 未登录读取私人项目/附件被拒绝；不同账号不能互读。
- 注册/登录、刷新后恢复、文件上传下载、导出、社区投稿状态符合界面说明。
- 后端源码、SQLite、笔记、私有环境文件不能从网址访问。
- 短信保持真实状态：未接通就是未接通，不声称手机号已经验证。
- 审核工具仅供运维使用：`runuser -u ai-youth -- env ARCHIVE_DATA_DIR=/var/lib/ai-youth-archive python3 /opt/ai-youth-archive/current/manage.py pending` 查看待审项；`review project <id> approve` 或 `review post <id> reject` 执行具体审核。审核命令不通过公网暴露，不在聊天里输出用户私人资料。
- 服务端备份是首次发布保护，不等于已有定时备份和恢复演练；未补齐前不能对用户承诺。

当前部署通道是阿里云网页命令助手。没有发现已配置的 SSH 密钥或 Aliyun CLI；若控制台回到登录页，应由用户恢复会话，不擅自添加云密钥或改变登录方式。
