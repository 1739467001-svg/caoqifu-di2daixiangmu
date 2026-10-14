# 档案馆后端（首版）

仅依赖 Python 3.9+ 标准库。SQLite 和附件放在网页目录之外，监听 `127.0.0.1:8789`，由现有 HTTPS Nginx 转发。默认使用带 Secure 的 HttpOnly Cookie，不直接向公网暴露 Python 端口。启动时增量建立私聊、回复、站内互动消息及私人档案画布表，不清空原有账号、作品或文件。发布后端时须同时包含 `server.py` 和 `community_comments.py`。

## 运行

环境变量：

- `ARCHIVE_DATA_DIR`：私有数据目录，默认 `/var/lib/ai-youth-archive`，服务用户需有读写权限。
- `ARCHIVE_PORT`：默认 `8789`。
- `ARCHIVE_COOKIE_PATH`：默认 `/ai-youth/`。
- `ARCHIVE_SECURE_COOKIE`：默认 `1`；只允许本机测试时设 `0`。
- `ARCHIVE_QUOTA_BYTES`：默认每人 100 MiB 附件空间，单文件 10 MiB。
- `ARCHIVE_TOTAL_QUOTA_BYTES`：默认全站附件 2 GiB 上限；磁盘预留至少 256 MiB，防止占满其他网站共用磁盘。
- `ARCHIVE_MAX_ACCOUNTS`：默认试用上限 200 个账号。每账号最多 500 件作品、500 条动态、1000 个附件。

`python3 server.py`

Nginx 需将 `/ai-youth/api/` 转发至 `http://127.0.0.1:8789/api/`；设置 `proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; client_max_body_size 15m;`。保留原网站其他 location。禁止将后端目录或数据目录作为静态网页发布。`/ai-youth/api/` 路径也可直接被 Python 接收。

保留 Nginx 默认的请求体缓冲 `proxy_request_buffering on;`；可设置 `client_body_timeout 20s;`、`proxy_read_timeout 45s;`。公网默认端口可用 `$host`，自定义端口代理需保留包含端口的 `$http_host` 才与浏览器 Origin 一致。代理必须覆盖 `X-Real-IP`，不能透传访客自带同名头。后端只信任环回代理。

本地联合测试（两进程）：后端进程环境设置 `ARCHIVE_DATA_DIR` 为临时私有测试目录、`ARCHIVE_SECURE_COOKIE=0`、`ARCHIVE_COOKIE_PATH=/ai-youth/`，运行 `python server.py`；另运行 `node preview.cjs`，预览服务器代理 `/ai-youth/api/` 到 `http://127.0.0.1:8789/api/`。预览代理要保留浏览器 Host（含 `4173`），并覆盖 X-Real-IP。浏览器使用 `http://127.0.0.1:4173/ai-youth/`，确保 Cookie 路径匹配。生产不能沿用 `SECURE_COOKIE=0`。

所有写操作需 `X-Archive-Client: 1`，JSON `Content-Type: application/json`；使用同源 Cookie。无 CORS，检查 Origin，短期登录和请求速率限制。错误格式 `{error:"中文说明"}`。时间值均为 Unix 秒。

## API

| 方法 /api 路径 | 请求 / 返回 |
|---|---|
| GET `/status` | `{ready,auth:{password:true,sms:false},limits:{fileBytes,storageBytes},publishing:"review-required"}` |
| GET `/me` | `{user:null 或 {id,username,profile:{name,bio,skills,intent},role:"creator"},usage:{used,limit}}` |
| POST `/auth/register` | `{username,password,name?}`，返回 `{user}` 并设置 Cookie；账号 3–32 位字母数字下划线，密码 10–128 位 |
| POST `/auth/login`、`/auth/logout` | 登录输入 username/password，退出返回 `{ok:true}` |
| PUT `/profile` | `{name,bio,skills,intent}` → `{profile}` |
| GET `/projects` | `{projects:[...]}`，仅本人 |
| POST `/projects` | `{title,summary,tech,role,event,url,status,notes,visibility:"private"或"public"}` → `{project}` |
| GET/PUT/DELETE `/projects/:id` | 本人读写删除；新增/修改公开作品进入 pending |
| GET `/projects/:id/history` | `{versions:[{id,createdAt,...旧版作品字段}]}`，保留最近 30 个文字版本 |
| GET `/files` | `{files:[{id,name,size,category,projectId,createdAt,downloadUrl}]}` |
| POST `/files` | `{name,content:base64,projectId?,category?}` → `{file}`，支持 JPG/PNG/WebP/PDF/UTF-8 TXT/MD，校验类型与容量 |
| GET `/files/:id/download` | 仅本人附件下载，无公开附件地址 |
| DELETE `/files/:id` | 本人永久删除；UI 必须明确确认，当前没有回收站 |
| GET `/archive-workspace` | `{workspace:{version:1,folders,selected,canvasHeight},revision,updatedAt}`，仅本人私人档案画布 |
| PUT `/archive-workspace` | `{workspace,revision}` → 同 GET；每次成功 revision 加1，旧版本提交返回409，防止不同窗口互相覆盖 |
| GET `/posts` | `{posts}` 本人的待审/已审动态 |
| POST `/posts` | `{body,kind:"update"或"question"或"team",projectId?}` → `{post}`，默认待审核 |
| DELETE `/posts/:id` | 仅作者可删 |
| POST `/posts/:id/like`、`/posts/:id/bookmark` | `{active:true或false}`，返回 `{post}`，只允许已审核动态；每账号每项仅计一次 |
| GET `/notifications` | `{notifications:[...],unreadTotal}`，仅本人收到的新点赞和已审核回复，最多返回200条；GET不自动标已读 |
| POST `/notifications/read` | `{all:true}` 或 `{ids:[消息id]}`，最多200个id，返回 `{ok:true,unreadTotal}`；仅将本人当前可见消息标为已读 |
| GET `/feed` | `{projects,posts}` 仅公开且审核通过；不含私人 notes、比赛自述 event 和附件 |
| GET `/public/projects/:projectId` | `{project}` 单件公开且审核通过的作品；用于详情直达链接，每次重新校验可见范围。私密/撤回/待审核均404 |
| GET `/public/:userId` | 有审核通过公开作品或帖子才返回公开主页；只公开昵称、已审作品与帖子，不公开用户名/私人简介 |
| GET `/export` | 本人文字档案、历史、帖子、回复、本人参与的对话及消息、附件清单，以及 `archiveWorkspace` 画布；附件文件需另外下载 |

动态含 `{id,body,kind,projectId,review,createdAt,author:{id,name},likes,bookmarks,liked,bookmarked}`。作品含输入字段 + `id,visibility,review,createdAt,updatedAt`。`review` 为 private/pending/approved/rejected。前端必须将所有用户输入用 textContent 或转义后显示，禁止直接当 HTML。

### 私人档案画布

每个登录账号保存一张自己的画布；未保存时返回空画布、`revision:0`、`updatedAt:null`。一次保存请求最多4MiB（含JSON、文字和图片封面），每人最多40个文件夹，每夹最多60条内容。只保存最新画布；`revision` 是防止覆盖的编号，不是历史版本列表，也不是备份。已有作品的文字历史功能不变。

文件夹字段：`{id,name,type,purpose,color,cover,x,y,items}`。id为1–40位字母、数字、下划线或短横线，name最多60字，purpose最多1000字。type为`message/note/file/link/mixed/event/project`；color只接受固定颜色编号`mint/lime/sky/violet/pink/sand/white`，不接受CSS、十六进制色值或其他自定义字符串。缺color的旧记录和旧保存请求默认mint；读取旧记录不修改数据库或revision，下一次本人保存时写入color。x、y是0–1之间的位置比例。`canvasHeight`为540–12000，`selected`为当前文件夹id或null。封面为null、内置`sample`，或真实PNG/JPEG/WebP的base64 data URL；每张解码图片最多512KiB。不接受SVG或远程图片地址。

内容字段：`{text,source,public,picture,kind,refId}`。text为必填纯文字，最多4000字；source最多300字。public、picture只接受布尔值；kind为`note/message/link/file/project/event`，默认note。file和project的refId必须引用本账号已经保存的附件或作品，不按客户端传入的owner判断权限；其他kind不能带refId。来源说明和参赛经历只是本人记录，不表示主办方核实或获奖认证。

附件仍始终私密，file条目的public会强制设为false。其他条目的public仅表示加入本人的公开预览，保存画布不会创建帖子、公开作品、公开文件地址或链上记录。画布没有公共读取接口，也不出现在feed、公开作者页或搜索中。

原附件或作品删除后，对应条目返回`unavailable:true`，并取消公开预览选取；保留用户自己写下的文字，不查询或显示其他人的资料。可继续保存原文件夹内的旧引用，或从文件夹移除该条目；新建不存在或他人引用仍返回404。关联条目移除或文件夹移除不删除原附件/作品。服务重启后画布保留，升级旧库只增表；已有一致数据库备份会包含画布，运营通过外键删除账号时画布一起删除。

保存冲突409时，前端应保留当前未保存内容，提示重新加载或导出草稿；不得自动拿新revision重试覆盖。工作区首次保存也进行事务版本检查。

### 站内互动消息

消息字段：`{id,kind:"like"或"reply",actor:{id,name},targetKind:"post",targetId,title,createdAt,read}`。`title`为本人帖子前80字；回复消息另含`commentId`和`body`（已批准回复前240字），作为文字显示。只返回互动人的公开昵称与id，不返回登录账号、私人简介、附件或私聊正文。作品当前没有点赞功能，不生成作品点赞消息；收藏不通知。

数据库触发器在新的帖子点赞、回复首次变为审核通过时记录消息；新增回复待审时不通知帖子作者。自己点赞、自己回复不通知。升级不补发历史点赞或早已批准的回复。撤赞、撤回公开帖子、回复撤审后不再显示对应消息；重新点赞或重新批准同一回复不会重复创建消息或重置已读。删除帖子、回复或相关账号时，消息随对应记录删除。已读和消息记录在重启后保留。

作品与帖子审核状态继续由本人原作品/帖子列表提供，审核不代表参赛或原创认证。私聊未读属于独立的对话接口；站内消息不是短信、邮件或系统推送，不将私聊正文混入消息列表。

### 私聊

以下接口全部需要登录，全部返回 `Cache-Control: no-store`。写操作沿用本站来源、自定义请求头与 JSON 检查。显示名只取公开昵称，不返回登录账号、手机号、私人简介或技能。

| 方法 /api 路径 | 请求 / 返回 |
|---|---|
| GET `/chats` | `{chats:[chat],unreadTotal}`，仅本人参与的对话，按最新活动排序 |
| GET `/chats/contacts?q=` | `{users:[{id,name}]}`，仅查找有审核通过公开作品或帖子的创作者；按昵称搜索，最多30人；不提供账号查找 |
| POST `/chats` | `{recipientId,body}`，新建两人的唯一对话并发送一条邀请，返回201 `{chat,messages,olderCursor:null}`；相同两人已有对话则返回200原对话及最近消息，不重复发送 body |
| GET `/chats/:id?before=序号` | `{chat,messages,olderCursor}`；默认最近60条，按seq从小到大返回，before不含该序号；无更早消息时olderCursor为null |
| POST `/chats/:id/messages` | `{body}` → 201 `{chat,message}`；对方接受邀请后才能继续发送 |
| POST `/chats/:id/accept` | `{}` → `{chat}`；只有收到邀请的人可接受，接受后记录邀请已读 |
| POST `/chats/:id/read` | `{}` → `{chat}`；只将本人当前可读消息标为已读；GET不自动清除未读数 |
| POST `/chats/:id/block` | `{blocked:true或false}` → `{chat}`；仅修改自己的屏蔽状态，任一方屏蔽时双方不能发信或接受邀请；双方仍能读取历史 |

`chat` 字段：`{id,peer:{id,name},preview,updatedAt,unread,state:"pending"或"accepted",incoming,blockedByMe,blockedByPeer}`。`incoming` 表示本次邀请是否由对方发起。消息字段：`{id,seq,senderId,body,createdAt}`。预览最多120字，每条消息最多2000字。私聊记录只出现在参与者的对话接口和个人导出，不出现在公共feed、公开主页或公开作品。

数据库事务确保同两人只产生一段对话，阻止并发重复邀请、接受或屏蔽后继续发送。发送邀请每人每小时最多5次、每天20次；发消息每分钟最多30条、每小时500条；这些成功发送记录的计数在数据库中保留，服务重启或更换来源地址不绕过限制。同时有内存快速限流。每人最多200段对话，每段最多10000条消息。达到上限不自动删除旧记录。私聊首版仅支持文字及手动刷新/前端轮询，没有图片、群聊、语音、推送或端到端加密（即连服务运营方也无法读取的加密）。生产依然必须使用HTTPS。

## 审核和备份

审核只能由有服务器权限的运营人员进行，不提供自动成为管理员、主办方的注册入口。

```
python3 manage.py pending
python3 manage.py review project <id> approve
python3 manage.py review post <id> reject
python3 manage.py review comment <id> approve
```

审核只表示内容允许公开，不代表原创、参赛、获奖认证。公开作品再次编辑会重新进入待审。没有经过本人公开选择的私密作品不能被 CLI 审核公开。

一致备份：短暂停服务后，以服务用户运行 `python3 manage.py backup <私有备份父目录>`，然后启动服务。备份包含密码哈希与私人资料，目录需严格限权，禁止上传到站点目录。恢复需要停服务，把备份中的数据库与 files 一起恢复到数据目录，检查权限后重启。上线前应实际演练备份恢复。没有配置计划任务前，不宣称自动定期备份已经启用。

## 明确限制

- 短信服务尚未接入，手机号登录不可用；账号密码可用。无假验证码。
- 尚无自助找回密码、换绑手机号、注销账号界面；注册时提示用户妥善保存密码。运营可处理导出/删除请求。
- 无主办方确认比赛 API、钱包、上链、邮件通知、自动能力榜。真实一对一文字私聊已接入；邀请须对方接受，双方可屏蔽。
- 文件当前为永久删除，没有回收站，也不自动剥离图片隐私元数据；所有附件默认且始终私密。
- 存储链接不等于备份链接指向的内容。
- 公共页面依赖人工内容审核；运营未审核时显示真实空状态。
- 简易速率限制在单进程内，重启后重置。公网扩大使用前需网关限流、反滥用和合规运营配套。
- 登录按 IP 与账号双重限流；每账号每 15 分钟最多 15 次登录尝试，IP 每 10 分钟 20 次；正常多用户共用网络也可能触发限制。请求线程最多 12 个，大附件内存处理最多同时 2 个。
- 只应通过真实 HTTPS 同源页面访问；不要在没有 TLS 的公网环境关闭 Secure Cookie。

## 验证

`python3 -m unittest -v test_api.py test_chats.py test_comments.py test_archive_workspace.py`

`test_archive_workspace.py`只使用工程`.private-notes/integration-tests`内的隔离临时数据库，覆盖私人读取、来源校验、账号隔离、并发版本冲突、附件及作品引用、被删引用、附件强制私密、封面/正文/数量限制、导出、重启、账号删除外键和旧库增量升级；也覆盖七种文件夹颜色的持久保存、旧记录无颜色兼容，以及无效颜色不会覆盖原记录。测试脚本和临时库不发布。

互动消息验证（在工程根目录）：`python3 review/white-space/test_notifications.py`。只创建本机隔离临时数据库和HTTP服务，验证消息权限、点赞去重与撤回、回复审批、已读、重启和旧库增量升级；测试脚本、临时库和截图不发布到网站。

测试使用临时 SQLite 和独立本机 HTTP 进程，覆盖账号权限、自授角色拒绝、会话、来源校验、私密文件隔离、文件类型、版本历史、公开审核、字段最小化、重复点赞去重、导出隔离。`test_chats.py` 另外覆盖私聊双方与第三人权限、邀请接受、屏蔽、未读数、分页、重启持久保存、持久限流和旧库增量升级。私聊测试数据放在Git忽略的 `.private-notes/integration-tests`，结束自动清理，禁止部署。
