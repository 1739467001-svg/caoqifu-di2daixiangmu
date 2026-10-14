(() => {
  'use strict';

  // 只供前端展示的虚构内容，不进入账号、数据库、认证或互动统计。
  const creators = [
    {
      id: 'demo-creator-star',
      demo: true,
      name: '口袋里的星球',
      avatar: '星',
      skill: '产品设计 · 前端开发 · AI 创作',
      tags: ['交互设计', 'AI 小工具'],
      bio: '喜欢把很大的想法做成可以点一点的小网页。最近在试着给自己的作品建一座小星球。',
      experience: [
        '把聊天记录里的作品想法整理成可以浏览的卡片。',
        '正在做第一个可交互的作品时间线，先解决“东西放哪了”的问题。'
      ],
      projectIds: ['demo-project-pocket-planet'],
      note: '虚构创作者，用于展示个人介绍与作品关联。'
    },
    {
      id: 'demo-creator-soda',
      demo: true,
      name: '苏打脑洞',
      avatar: '苏',
      skill: '视觉设计 · 原型制作 · 团队协作',
      tags: ['界面设计', '脑洞整理'],
      bio: '擅长把大家七嘴八舌的点子画成草图。希望每个好想法都有地方留下来，而不是下一次开会再想一遍。',
      experience: [
        '做过纸面原型和小型网页原型，喜欢先让朋友试用。',
        '正在整理一次创作冲刺的想法、修改理由和遇到的问题。'
      ],
      projectIds: ['demo-project-idea-wall'],
      note: '虚构创作者，不代表真实参赛或获奖记录。'
    },
    {
      id: 'demo-creator-island',
      demo: true,
      name: '岛上有代码',
      avatar: '岛',
      skill: '网页开发 · 动效设计 · 使用体验测试',
      tags: ['专注工具', '网页动效'],
      bio: '喜欢做打开就能用的小工具。现在在做一个安静的计时页面，想让开始做事比设置工具更简单。',
      experience: [
        '写过计时器和简单任务清单，并记录朋友试用后的问题。',
        '正在学习怎样区分“功能很多”和“真正好用”。'
      ],
      projectIds: ['demo-project-focus-island'],
      note: '虚构创作者，用于演示技能和制作经历。'
    }
  ];

  const projects = [
    {
      id: 'demo-project-pocket-planet',
      demo: true,
      title: '口袋星球：把作品装进口袋',
      summary: '把作品链接、制作过程和下一步想法放在同一张卡片里，再按时间整理。',
      problem: '做了几个小作品后，链接在聊天里、截图在相册里。想给朋友介绍时，要重新到处找。',
      solution: '每个作品都有一张卡片，收下介绍、链接和制作笔记。时间线把作品连起来，能看见上次做到了哪里。',
      role: '我负责确定卡片内容、画页面草图，并制作网页原型。',
      tags: ['作品整理', '时间线', '网页原型'],
      tech: '原生 JavaScript、HTML、CSS',
      status: '原型制作中',
      cover: 'assets/demo/work-pocket-planet.svg',
      authorId: 'demo-creator-star',
      changelog: [
        { title: '先把资料放到一起', body: '整理了作品名称、简介、链接和制作笔记，删掉了暂时用不到的表单项。' },
        { title: '做出可以点的卡片', body: '完成列表和详情原型。接下来测试作品变多后，能不能快速找到想看的那件。' }
      ],
      visibility: 'demo',
      note: '演示作品，没有可用的外部产品链接或真实认证。'
    },
    {
      id: 'demo-project-idea-wall',
      demo: true,
      title: '脑洞贴贴墙',
      summary: '把小组的想法贴在一起，分清“先试什么”和“以后再做什么”。',
      problem: '组队讨论时，消息刷得太快。有人已经开始写代码，其他人还不知道最后选了哪个点子。',
      solution: '想法变成便签，放进“刚想到、准备试、已试过”三栏。每张便签记下改动原因，让后来加入的人也能跟上。',
      role: '我负责讨论流程、便签界面和第一次试用反馈整理。',
      tags: ['组队创作', '想法便签', '协作原型'],
      tech: 'HTML、CSS、JavaScript',
      status: '正在收集试用反馈',
      cover: 'assets/demo/work-idea-wall.svg',
      authorId: 'demo-creator-soda',
      changelog: [
        { title: '把讨论拆成三栏', body: '先用纸面便签试了一轮，发现“准备试”和“已经决定做”需要写清楚。' },
        { title: '给想法加上修改理由', body: '网页原型可以查看便签说明。下一步准备让两位朋友测试他们是否能看懂项目进度。' }
      ],
      visibility: 'demo',
      note: '演示作品，展示的是虚构的制作过程。'
    },
    {
      id: 'demo-project-focus-island',
      demo: true,
      title: '专注小岛：先做一件事',
      summary: '写下一件要做的事，开一个短计时，结束后留一句进度。',
      problem: '本来想开始做作品，却先花很久设置待办、分类和提醒。工具本身又变成了一件新任务。',
      solution: '打开页面只填一个小目标，选好时长就开始。结束后记一句“做到哪了”，下次打开不用重新回想。',
      role: '我负责计时逻辑、暂停状态和页面动效。',
      tags: ['专注计时', '进度记录', '轻量工具'],
      tech: 'JavaScript、浏览器计时器、CSS 动效',
      status: '交互测试中',
      cover: 'assets/demo/work-focus-island.svg',
      authorId: 'demo-creator-island',
      changelog: [
        { title: '跑通一次完整计时', body: '完成开始、暂停和结束，先确认中途切换窗口不会让计时混乱。' },
        { title: '把结束页改成一句进度', body: '去掉复杂打分，改为记下一步。正在检查刷新页面时该怎样提示未完成的任务。' }
      ],
      visibility: 'demo',
      note: '演示作品，未提供真实运行入口。'
    }
  ];

  const posts = [
    {
      id: 'demo-post-planet-progress',
      demo: true,
      kind: 'update',
      title: '作品卡片终于能点开了，下一步做时间线',
      body: '今天把口袋星球的作品列表和详情页连起来了。一张卡片先放名称、简介、链接和制作笔记，暂时不塞一堆用不到的字段。\n接下来想试试：如果有十几个作品，按时间排是不是比按工具分类更好找？我准备拿同一批卡片做两种排列来比较。',
      authorId: 'demo-creator-star',
      projectId: 'demo-project-pocket-planet',
      tags: ['作品进展', '卡片设计'],
      note: '虚构进度帖，用于演示社区内容。'
    },
    {
      id: 'demo-post-wall-question',
      demo: true,
      kind: 'question',
      title: '大家组队时，怎么让后来加入的人跟上？',
      body: '我在做脑洞贴贴墙。现在能看见选了哪个想法，但还看不见“为什么不做另外两个”。后来加入的人还是要翻聊天记录。\n我想在便签下面加一小段修改理由，又担心大家嫌填写麻烦。你们更愿意写一句原因，还是录一小段说明？',
      authorId: 'demo-creator-soda',
      projectId: 'demo-project-idea-wall',
      tags: ['提问交流', '组队协作'],
      note: '虚构提问帖，不代表已有用户讨论。'
    },
    {
      id: 'demo-post-island-progress',
      demo: true,
      kind: 'update',
      title: '我把专注小岛的打分删了，改成记一句进度',
      body: '最初做了完成率、连续天数和一排统计。试用时发现，做了一半的人反而不知道应该点哪。\n现在计时结束只问“这次做到哪了”。没有完成也能写进度，下次接着做。我在检查暂停、刷新和切换窗口这几个最容易出问题的情况。',
      authorId: 'demo-creator-island',
      projectId: 'demo-project-focus-island',
      tags: ['作品进展', '使用体验'],
      note: '虚构进度帖，没有真实试用统计。'
    },
    {
      id: 'demo-post-planet-team',
      demo: true,
      kind: 'team',
      title: '想找一个喜欢画小图标的伙伴，一起做作品封面',
      body: '口袋星球的页面能浏览了，但封面现在还不够有辨识度。我想给作品整理、游戏和小工具各画一套简单图形，不追求复杂插画。\n如果你也喜欢做界面，我们可以先一起讨论一张封面：需要看见什么，哪些东西可以删。这里展示的是组队帖的形式，不是真实招募。',
      authorId: 'demo-creator-star',
      projectId: 'demo-project-pocket-planet',
      tags: ['寻找伙伴', '视觉设计'],
      note: '演示组队帖，不提供真实联系或招聘。'
    },
    {
      id: 'demo-post-wall-progress',
      demo: true,
      kind: 'update',
      title: '三栏便签试了一轮，最难的是说清楚下一步',
      body: '脑洞贴贴墙现在有“刚想到、准备试、已试过”三栏。我用一个小练习模拟了从想法到原型的过程。\n发现“做一个好看的首页”太大了，改成“先画标题区和一张作品卡片”就能开始。准备给便签加一句下一步，但先不做复杂的项目管理。',
      authorId: 'demo-creator-soda',
      projectId: 'demo-project-idea-wall',
      tags: ['作品进展', '想法整理'],
      note: '虚构制作日志，用于展示内容排版。'
    },
    {
      id: 'demo-post-island-question',
      demo: true,
      kind: 'question',
      title: '一个小工具的第一次打开，应该解释多少？',
      body: '专注小岛现在打开就能写目标、选时长、开始。朋友问我能不能先放一页说明，但我担心说明比工具还长。\n我想把必要提示放在对应按钮旁边，第一次用时看得见，熟悉后就少一点。你们会先看说明，还是先按一下再说？',
      authorId: 'demo-creator-island',
      projectId: 'demo-project-focus-island',
      tags: ['提问交流', '界面体验'],
      note: '虚构提问帖，不含真实回复或点赞数。'
    }
  ];

  const events = [
    {
      id: 'demo-event-mini-universe',
      demo: true,
      title: '迷你宇宙造物赛',
      summary: '把一个小脑洞做成能点、能玩、能讲清楚的网页作品。',
      description: '选一个日常场景，给它造一个小宇宙。可以做探索小游戏、能回答问题的角色，或帮你整理想法的小工具。先让一个主要功能跑起来，再录下从打开页面到完成操作的过程。',
      theme: '造一个只有你想得到的小宇宙',
      format: '个人或小队创作冲刺',
      duration: '演示设定：48 小时',
      deliverables: ['一份可展示的作品原型', '一段简短演示视频', '写清楚你负责了什么'],
      tags: ['网页创作', '趣味交互', 'AI 工具'],
      cover: 'assets/demo/event-mini-universe.svg',
      note: '虚构赛事，仅展示活动页结构；没有真实报名、奖金或主办方认证。'
    },
    {
      id: 'demo-event-6767',
      demo: true,
      title: '6767 脑洞大赛',
      summary: '给生活里一件离谱的小事，做一个认真能用的解决办法。',
      description: '选一件你经常吐槽的小事：找不到东西、组队点子太乱，或者每天忘记下一步。先写清哪里麻烦，再做一个能演示的解决办法。题目可以很怪，但要让第一次看到的人知道怎么用。',
      theme: '脑洞可以很怪，作品得说得明白',
      format: '个人或小队创作挑战',
      duration: '演示设定：一个周末',
      deliverables: ['问题和解决办法各写一段', '一个能演示的页面或模型', '一份制作过程记录'],
      tags: ['脑洞创作', '生活小工具', '快速原型'],
      cover: 'assets/demo/event-6767.svg',
      note: '虚构赛事，名称和规则为页面演示编写。'
    },
    {
      id: 'demo-event-weekend',
      demo: true,
      title: '周末发明家冲刺',
      summary: '挑一件平时嫌麻烦的事，周末结束前做出第一版。',
      description: '和伙伴选一个能在一天内做出原型的小问题。分清谁画界面、谁做功能、谁试用并记录问题。最后展示第一版，也说清还有哪一步没有完成。',
      theme: '先解决一件小事',
      format: '小队协作与作品分享',
      duration: '演示设定：24 小时',
      deliverables: ['第一版作品或交互原型', '展示从想法到成品的过程', '说明还没解决的问题'],
      tags: ['轻量工具', '组队协作', '制作记录'],
      cover: 'assets/demo/event-weekend.svg',
      note: '虚构赛事，无真实日期、报名入口、名次或奖项。'
    }
  ];

  const freezeItems = items => Object.freeze(items.map(item => {
    for (const value of Object.values(item)) {
      if (Array.isArray(value)) {
        value.forEach(entry => { if (entry && typeof entry === 'object') Object.freeze(entry); });
        Object.freeze(value);
      }
    }
    return Object.freeze(item);
  }));

  window.DISCOVERY_DEMO = Object.freeze({
    label: '演示内容',
    notice: '以下内容为虚构示例，不是真实用户、作品或赛事记录。',
    posts: freezeItems(posts),
    projects: freezeItems(projects),
    creators: freezeItems(creators),
    events: freezeItems(events)
  });
})();
