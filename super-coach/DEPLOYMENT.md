# 探询部署记录

更新于 2026-10-10。

## 当前状态：已按所有者要求删除服务器部署

2026-10-10所有者明确要求删除探询AI教练。已删除tanxun-coach-1容器、tanxun-coach镜像、专用Docker网络及/opt/tanxun下全部应用文件、发布包、历史版本、日志和runtime.env。HTTP及HTTPS入口均返回410。删除前容器内存约98.62MiB；目录由约244M降至47M。

仅保留/opt/tanxun/certbot及证书续期、共享Nginx配置，因为另一项目/ai-youth/正在共用；复验其返回200，Coolify容器健康。共享Nginx中的探询转发已改为410。本地源码及浏览器聊天记录不在此次服务器删除范围。未经用户重新要求，不重新部署。以下为历史记录，不代表仍在线。

## 历史线上版本（已删除）

- 最新外观：等待时温和倾听提示；停止后原位置显示暂停符号和“当前对话已被暂停”，空草稿发送键显示双竖线，输入后恢复箭头。仅改变呈现，不提供恢复生成。118项测试及三种桌面/手机宽度模拟检查通过，无付费模型调用。

- 产品版本7.0；正式网址：https://112.74.63.237/，原HTTP入口保留。
- 发布版本20260926-135123；目录/opt/tanxun/releases/20260926-135123；当前链接/opt/tanxun/current。
- 镜像tanxun-coach:20260926-135123；容器tanxun-coach-1；Compose项目tanxun。
- 发布包SHA256：84128acc1e8573c3d79ab3a7c0312613cced57cdfda5a6a9fbec8b5c0297ab16。
- 上一线上版本20260926-134218及更早版本保留供回退。
- 最新纠正：方块彻底停止任务，没有暂停后恢复。输入框有字时点方块也只停止，草稿保留；排队消息不再自动发送。停止后直接发送仍在同一窗口和侧栏条目，新段不传旧上下文或笔记；只有消息下的“从这里继续”建立带历史的分支，原消息保持可见。
- 自动保存记录、草稿和未发送队列；旧暂停状态及刷新中断的请求转为已停止。不自动调用付费模型。右上角图案、手机布局、深度策略、版本和字重沿用。
- 本次未调用付费模型，未修改服务器密钥、账号、Nginx或证书。用户纠正已保存到项目知识和提醒，并将旧暂停说明标记为已替代。

## 运行配置

- Node.js 24；容器非 root、只读、自动重启、256 MB 内存限制和日志轮转。
- Docker 仅映射 127.0.0.1:3210；Nginx 对外提供 80 和 443 端口。
- Nginx 配置：/etc/nginx/sites-available/tanxun，链接至 sites-enabled/tanxun；当前模板为 deploy/nginx.https.conf。
- 升级前备份：/opt/tanxun/nginx-before-https-20260921.conf。
- 环境变量：RELEASE_TAG=20260926-135123，APP_ORIGIN=http://112.74.63.237,https://112.74.63.237，USE_MOCK=false，AI_PROVIDER=doubao，HOST=0.0.0.0，PORT=3210。
- 模型请求超时55秒，低于当前Nginx的60秒；浏览器等待75秒，以接收应用错误。长JSON回复上限5000输出token，可见正文最多6000字符。
- APP_ORIGIN 使用逗号分隔的精确来源，拒绝其他 Origin。不依赖客户端传入的代理协议头放开来源。
- 真实模型接入位置 src/ai.mjs；AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3，AI_MODEL=doubao-seed-2-0-lite-260428。
- 新网页请求 coachProtocol:1，传入当前任务的 coachState、interactionMode 和 action；模式可不选，开场及主动选择后的话题提示不付费。真实调用使用 text.format 的 json_schema 严格结构输出，name/strict/schema 与 type 同层。旧文字接口保留兼容，新版Mock可演示完整流程。
- 私有配置 /opt/tanxun/runtime.env：root 所有、权限 600，由 Compose env_file 读取，保存 USE_MOCK、AI_PROVIDER、AI_BASE_URL、AI_MODEL、DOUBAO_API_KEY。密钥不写入项目、发布包、镜像、部署记录或浏览器。不要输出完整环境或展开后的 docker compose config。
- 健康接口 mode=live 只表示配置为真实模式，不证明模型账户可用。此前试聊触发SetLimitExceeded；用户自行调整并充值后已恢复，3次公网真实调用全部成功。未修改用户账户设置；用量上限错误仍会明确提示。
- 更换密钥后，仅重新创建探询容器即可；发布目录变更不会覆盖 runtime.env。设 USE_MOCK=true 并重新创建容器可暂时切回模拟。用户曾在聊天中粘贴完整密钥，已提醒轮换；本文件不保存该密钥。
- Coolify 等其他容器继续运行，其管理端口仍仅监听服务器本机。

## HTTPS 与自动续期

- 本轮用户要求处理安全连接和麦克风权限后，使用已准备的 Certbot 开通 IP 证书。
- Certbot 5.8.0 位于 /opt/tanxun/certbot/bin/certbot。
- 证书：/etc/letsencrypt/live/112.74.63.237/fullchain.pem；私钥：同目录 privkey.pem。不要复制私钥到代码、聊天或发布包。
- 颁发机构：Let's Encrypt，签发者 YE1；SAN 为 IP Address:112.74.63.237。
- 本次证书有效期 UTC：2026-09-21 09:32:20 至 2026-09-28 01:32:19。IP 证书有效期短，必须保留续期任务。
- ACME webroot：/var/www/tanxun-acme；Nginx 开放 /.well-known/acme-challenge/。
- systemd：tanxun-certificate-renew.timer，已 enable --now，每天 00:00 和 12:00 检查，随机延迟最多一小时，Persistent=true。
- 续期服务只处理 112.74.63.237 证书；成功后执行 /etc/letsencrypt/renewal-hooks/deploy/tanxun-nginx，检查并重载 Nginx。
- 已执行 certbot renew --cert-name 112.74.63.237 --dry-run --run-deploy-hooks，返回 0，模拟续期成功，重载钩子验证通过。
- 未设置 HSTS 或强制 HTTP 跳转，以便原有用户带入本地记录。

## 语音及记录

- 网页仅在点击麦克风后尝试浏览器 SpeechRecognition / webkitSpeechRecognition，语言 zh-CN；默认不收音。
- 本站 Permissions-Policy 为 microphone=(self), camera=(), geolocation=()；浏览器/系统麦克风授权仍由用户操作。
- 语音服务由浏览器提供，可能使用其在线识别服务；探询服务器不接收或保存音频。浏览器支持及服务网络可用性会影响识别。
- 识别后的最终文字进入当前草稿，由用户确认后发送；录音中不能发送。单次最多 60 秒，切换任务或离开页面会停止收音，迟到结果不写入其他任务。
- 所有对话仍保存在用户浏览器的 localStorage（tanxun.tasks.v1），没有服务端聊天数据库。
- 真实模型会处理每次发送的当前任务上下文。请求设置 store=false，不使用供应商 previous_response_id；删除后的后续请求不再发送已删除消息。该设置不保证供应商不保留运营或安全日志，不能撤回已经处理过的内容。
- HTTP 页点击麦克风后出现“带上对话，进入安全页面”。通过 origin 与 source 双重校验的 postMessage 在标签页之间传输此应用的记录，不将聊天放进 URL、服务器或剪贴板，原 HTTP 副本保留。
- 仅向空白 HTTPS 存储带入记录；HTTPS 若已有聊天或草稿，保留现有内容，不覆盖。HTTP/HTTPS 后续不持续同步，应从此使用安全网址。
- 不打包旧 data/、浏览器聊天、本地 .env 或任何密钥。

## 本次验证

- 正式HTTPS已复验1365/390/320px全部停止/刷新/新任务/分支流程；app.js、task-store.js、styles.css与本地SHA256一致，容器健康、live模式。截图stop-online-*，没有付费模型调用。
- 118项自动测试通过；新增停止不可恢复、草稿与冻结队列保留、迟到响应不推进、新任务无旧上下文、仅显式分支继承历史、旧暂停记录迁移，以及删除待回复提问仍不解锁任务。
- 隔离Edge在1365/390/320px验证停止、刷新保存、无恢复入口、新任务隔离、从提问处续聊和手机键盘44px按钮；使用本地Mock，无付费请求。模拟不等于实体微信或Safari测试。脚本stop-ui.cjs，截图stop-local-*，日志stop-tests.txt。

### 20260926-130129历史验证（暂停/恢复已被替代）

- 117项自动测试通过，新增暂停/继续、忽略迟到响应、打断保留原提问、排队顺序与上下文、失败/刷新后独立草稿和队列、任务隔离、保存失败回退、客户端断开传播以及供应商fetch取消。旧版草稿迁移仍通过。
- 隔离Edge模拟1365/390/320px完成输入可编辑、排队、暂停重开、继续、打断立即发送、Enter排队、普通刷新及键盘缩到430px验证；按钮44px，无横向溢出，右上角不再重复标题。没有新增付费请求。模拟不等于实体微信或Safari验证。
- 本次截图与脚本：上级.deploy-cache/pause-local-*、pause-ui.cjs；测试日志pause-tests.txt。
- 正式HTTPS上重复完成1365/390/320px全部暂停/排队/重开流程，截图pause-online-*；index.html、app.js、styles.css、task-store.js与本地SHA256一致。容器健康、配置为live，私有知识文件及.env返回404。没有创建额外测试容器或新增模型调用。

### 20260926-123330深度与长文验证

- 107项自动测试通过，覆盖深度评估、超过三轮仍可追问、用户主动要答复、临时知识题保留项目笔记、历史窗口、状态恢复/分支/删除和长答彩绘兜底。
- 隔离Edge模拟1365/390/320px验证长答、高亮持久化、键盘收缩、44px按钮、滚动位置和无横向溢出；实际试聊文本在375/360px与微信UA回放验证。浏览器模拟不等于实体微信或Safari测试。
- 真实模型先完成6次请求，长项目答复缺少有效highlights触发断言；修复后限定4次补测，陪伴长文只有单换行且漏标，再针对已保存原文修复与回放，不增加付费请求。10次全部HTTP 200；格式断言失败已保留记录，不能表述为10次检查全过。
- 最终候选与补测模型规则一致，末次修改仅针对漏标兜底和普通换行排版。原始虚构记录在上级.deploy-cache/depth-first-results.jsonl及depth-final-results.jsonl，界面截图depth-*。
- 正式HTTPS健康、真实模式配置和容器镜像已核对；index.html、app.js、styles.css、coach-protocol.js、task-store.js、message-presentation.js与本地SHA256相同，私有知识与.env路径返回404。公网重复完成1365/390/320px流程与375/360px实际文本回放，未新增模型调用。

### 20260926-114338界面验证

- v7.0：18项现有教练流程与笔记测试通过；隔离Edge在1365、390、320px验证品牌版本位置、可见界面文案统一400字重、教练强调700字重、无横向溢出与正常Mock收发。公网重复验证，前端文件哈希与本地一致。
- 本次无付费模型调用；移动检查为浏览器模拟，不等于实体微信或Safari测试。截图在上级目录.deploy-cache/v7-local-*和v7-online-*。

### 20260926-112917及此前验证

- 20260926-112917：98项自动测试通过；公开前端1365/390/320px自适应对话流程和6种手机/微信UA/桌面布局检查通过。浏览器测试使用Mock，不额外调用模型；模拟不等于实体微信或Safari验证。
- 真实模型：早期候选缺少选项，诊断后改为独立options字段。修正版6次连续HTTP 200，覆盖选择题转答案、明确要办法、卖书需求和计算；收紧措辞与排版后又完成2次答案请求。查看COACH-EVALUATION.md中的语义局限，不能把结构验证当作建议全部正确。
- 新容器健康，公开HTTPS可用；上线版本与本地文件哈希核对，知识源文件仍不公开。测试容器清理，原线上版本105026保留供回退。

### 以下为此前发布的历史验证

- 本次线上复验：上述手机/微信UA/桌面及键盘场景均通过，三份公开前端文件与本地SHA256一致；这轮没有付费模型调用。

- 手机布局更新：95项回归测试通过；隔离Edge模拟390×844、375×667、360×740、320×568及微信UA，覆盖新对话、聊天、打字、键盘收缩、小结选项、侧栏和仅VisualViewport缩小的情况；1365×950桌面回归通过。模拟环境不等同于实体iPhone/Safari或微信App。
- 390px手机模拟对比：普通聊天输入框以下空间由125.56px降至28.5px，提示与输入框间距由61.78px降至6px；语音与发送均为44×44px。设备安全区另按浏览器提供值保留。测试截图和测量在上级目录.deploy-cache/mobile-before/after-*，仅使用模拟对话，无付费请求。

- 恢复后补测：2026-09-26用户表示已关闭免费体验限制并充值后，公网真实接口补测3次全部HTTP 200：未选模式直接回答2+3；保存明确提醒；模拟JSON恢复并不携带之前的聊天消息，仅凭任务笔记正确回忆“先举具体例子，再解释原因”。没有修改账户限额，没有重启或重新发布网站。原始虚构测试结果在项目上级目录.deploy-cache/restored-model-results.json。

- 95项自动测试通过，覆盖请求格式、项目笔记注入、明确提醒原话保留、刷新恢复、任务隔离、分支快照、删除重建、失败状态不前进、L0临时回答与L2收敛。
- 本地隔离Edge检查1365px、390px、320px：可不选模式直接输入，模式切换、其他项自由输入、多问题确认、更正、三轮小结、刷新、无笔记协议泄露和无横向溢出。
- 真实模型在严格schema下完成两段虚构场景，共10次成功付费回复、4次免模型开场/话题提示：选择题连续三次回答后阶段小结；多问题部分回答确认、纠错、确认后继续、换选择题、二选一均走通。随后第11次调用L0计算题时触发账户SetLimitExceeded；事实题和明确提醒回忆没有完成真实模型验证，仅有自动测试覆盖。
- 早期候选中纯提示词/JSON Object仍出现遗漏笔记或选项，已改为严格json_schema；曾按SDK类型使用嵌套json_schema导致请求失败，现采用实际Responses格式的同层name/strict/schema。失败候选没有发布正式站。
- 真实试聊仍发现提问质量局限：有过早提供产品方向、重复猜测已被用户否认的情绪、部分开放问题未充分覆盖不同维度。结构与保存机制通过不等于语义始终准确，更不代表真实客户问题已经解决。
- 线上隔离Edge再次通过1365px、390px、320px相同流程，API替换为本地Mock以免消耗额度；HTTPS证书验证正常，公开前端文件哈希与本地一致，服务端知识文件请求返回404。
- 正式容器使用tanxun-coach:20260926-105026，部署后核对运行镜像、HTTPS健康和本次4个变更文件的SHA256；源设计附件与桌面原稿字节一致。
- 发布前版本20260926-101248保留，运行环境、API密钥、Nginx、证书与用户浏览器记录沿用。详见COACH-EVALUATION.md的新版本说明。

## 后续发布

先检查服务及此记录；只更新探询。使用新的时间戳目录，不覆盖旧版本。发布包仅包含 package.json、server.mjs、Dockerfile、.dockerignore、dist、src、deploy、tests、README.md、.env.example、AGENTS.md。

在新发布目录中设置 RELEASE_TAG 为新版本，并保留 APP_ORIGIN=http://112.74.63.237,https://112.74.63.237，再执行 docker compose -f deploy/compose.production.yaml build 与 up -d --no-build --wait --wait-timeout 45。保留 /opt/tanxun/runtime.env 及 env_file 配置，不复制进发布包。不要把旧 Compose 中写死的 USE_MOCK=true 覆盖回来。

确认公网 HTTPS、聊天接口和容器健康后更新 /opt/tanxun/current 及本文件。Nginx 无变化时无需重载。不更改其他服务、不重启整机。

上一线上版本 /opt/tanxun/releases/20260925-231854 保留以供回退；它使用上一版教练提示词，同样保留加深彩绘与无框提示，仍接入真实豆包。回退会恢复该旧提示词。保留服务器私有环境文件、HTTPS Nginx、证书自动续期及双来源配置。


