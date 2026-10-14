# 发现（原 AI 少年档案）部署记录

## 最新发布：2026-10-11 11:32（北京时间）

- 原入口已替换为最新“发现”全站版本：https://112.74.63.237/ai-youth/#home 。五主页面及登录、编辑、通知、发帖、参赛工具、弹窗和私聊统一米白／黄绿／青绿透明渐变；沿用原有功能，未借本轮发布重做业务。
- 静态版本：`/var/www/ai-youth-archive/releases/20261011-033252-4b207a`；后端版本：`/opt/ai-youth-archive/releases/20261011-033252-4b207a`。原账号、作品、附件及私有数据目录保持；回复、私聊和通知为此前本地已验收功能的本次发布。
- 发布前完整备份：`/var/backups/ai-youth-archive/20261011-033252-4b207a`。失败回退代码与路由，保留数据；不自动破坏性回退数据库。
- 阿里云命令助手预检：`t-sz06zoh1del45xc`。正式 apply 通过已登录 Aliyun Workbench UI 以 admin＋sudo 执行，回执 `status=deployed`；正式执行没有命令助手执行ID，不记录临时会话链接或凭据。
- Nginx 前后均为 `c01f5c32b2efb9717f9ce6b7757298f31fe5110d063f0ebba3efb4b9a402a02b`，没有改变其他站点路由。原 HTTPS `/` 根页本来为410，发布后状态与SHA256 `6f3e8074b56b03df96970db1432b6c885fc930529d2d5d6e13efe7dc643ed6b7` 完全保持；不是本次发布造成的错误。
- 公网正常TLS验收通过：17个静态资源均200且哈希匹配本轮清单；API ready=true；7个实际私有接口未登录均401；11个源码、笔记及数据库路径均404。安全回执摘要与资源哈希：`release/deployment-transparent-20261011.json`；验收：`release/transparent-deployment-verification-20261011.json`；基线：`release/transparent-deployment-baseline-20261011.json`。
- 实际线上首页截图：`review/all-transparent/live/home.png`。只发布dist资源、三份后台运行代码及服务文件，没有上传笔记、测试资料、数据库或凭据；展示层示例明确标“演示”。
- 独立资料夹工作区及模拟主办方确认演示未并入主站；短信、真实榜单、主办方认证、自动备份和Solana上链仍未接入。规则参赛建议与未签名未上链凭证草稿维持原边界。

## 历史发布：2026-10-10 20:55（北京时间）

- 正式入口：https://112.74.63.237/ai-youth/#archive 。原网址已更新，不是仅本机预览。
- 本轮最终UI：仅借鉴观猹布局，米白主色、深灰文字、绿色按钮/选中点缀；电脑窄侧导航、主内容及辅助栏，紧凑卡片与统一图片比例。原名称、用途与业务逻辑保持。桌面和390像素手机18个路由检查无横向溢出，新建作品弹窗正常。
- 同时完成此前已授权的档案后端发布：账号密码、私人作品和附件、文字版本、审核公开、动态与点赞收藏。短信未接入，规则建议和未签名未上链凭证草稿保留。
- 静态版本：`/var/www/ai-youth-archive/releases/20261010-125536-e47ed0`。
- 后端版本：`/opt/ai-youth-archive/releases/20261010-125536-e47ed0`，systemd服务 `ai-youth-archive`，监听127.0.0.1:8789，Nginx同源代理，真实数据在`/var/lib/ai-youth-archive`。
- 旧版及配置备份：`/var/backups/ai-youth-archive/20261010-125536-e47ed0`。旧静态版本profile-page-20261008-153832保留。发布器检查原探询首页哈希未变、nginx配置检查成功。
- 正式执行：`t-sz06zmcnkfttyps`，status=deployed。完整回执：`release/deployment-compact-20261010.txt`；预检：`release/preflight-compact-20261010.txt`。
- 公网正常TLS校验：index.html、style.css、app.js、tools.js、hash.js、mark.svg均200且SHA256与dist一致；status ready=true；me user=null；feed为空，没有本机测试用户或作品；未登录projects返回401。浏览器已实际打开线上新版。
- 截图：`review/compact-layout/live-archive.png`为线上当前窗口；archive-desktop.png为1440宽本机功能验收页面；archive-mobile.png为390宽本机页面。
- 本轮只上传站点运行代码，未上传项目笔记、测试数据库、敏感原文或浏览器资料。自动定时备份、密码找回、短信、真实赛事认证和上链仍未启用。

以下为历史发布记录，涉及“无后端”“仅浏览器保存”的旧描述已被上述最新状态替代。

2026-10-07 17:33（北京时间）已部署成功。

- 正式入口：https://112.74.63.237/ai-youth/
- 服务器：cqf大鸡吧，阿里云深圳，实例 304cd7cc166449678c5b50fce566054d。
- 发布目录：/var/www/ai-youth-archive/releases/20261007-093356；current 符号链接指向该目录。
- 在现有 /etc/nginx/sites-available/tanxun 的 HTTP、HTTPS 两个 server 中添加独立静态入口。保留原探询代理、证书和 ACME 路径；不新增常驻进程，不修改 Docker 或私有环境配置。
- 配置备份与服务器回执：/var/backups/ai-youth-archive/20261007-093356/。
- 命令助手执行：预检查 t-sz06zb4anolq9z4；第一段 t-sz06zb4z671s2dc；第二段 t-sz06zb5aok3epkw。发布退出码 0，nginx -t 成功。
- 原 Nginx SHA256：94afd05071c2b3cc1a902e08e7ebfc399f30a2362808ce9bd0b469a4fdff6bc5。
- 新 Nginx SHA256：138feb2f3ffa920c6c142623341c7e3527adc8262b292236355878c571359e3f。

公网验收详见 release/verification.json：四个文件 SHA256 与本地完全一致；HTTPS 首页返回 200；/ai-youth 自动跳转至 /ai-youth/；原探询首页与部署前内容一致且返回 200。浏览器已实际打开线上首页并验证参赛助手导航。未调用任何付费模型。

部署前资源：系统可见内存 1613 MiB，其中 available 532 MiB；2 GiB swap 未使用；磁盘可用 26 GiB。静态资源共 33338 字节，不需要单独 Node 服务。

当前功能仍是演示版：规则生成建议、浏览器本地作品档案、未签名凭证草稿。没有新增云端个人数据同步、真实大模型调用或 Solana 上链。本次上传仅含 dist/index.html、app.js、style.css、hash.js。

本地启动：node preview.cjs（127.0.0.1:4173）。原顺飞宇宙项目中的源文件和本地服务已保留；当前项目下的副本用于后续维护。

本次生成的部署脚本仅适合首次安装，包含旧配置哈希及“current 不得已存在”的保护条件，后续更新需制作新发布版本，不可直接重跑。回退前应核对线上配置未被其他任务修改，再恢复对应备份并运行 nginx -t 后 reload；保留发布目录用于排查。
