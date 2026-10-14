from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
p = root / 'dist/app.js'
s = p.read_text(encoding='utf-8-sig')
def replace_once(old, new):
    global s
    assert s.count(old) == 1, old[:90]
    s = s.replace(old, new, 1)
def replace_function(name, code):
    global s
    match = re.search(r'^(?:async )?function ' + name + r'\(', s, re.M)
    assert match, name
    end = re.search(r'^(?:async )?function |^const field=', s[match.end():], re.M)
    assert end, name
    boundary = match.end() + end.start()
    s = s[:match.start()] + code.strip() + '\n' + s[boundary:]

replace_once("const heading=(title,desc,actions='')=>`<div class=\"page-heading\"><div><h1>${title}</h1><p class=\"muted\">${desc}</p></div><div class=\"action-row\">${actions}</div></div>`;", "const heading=(title,desc,actions='')=>`<div class=\"page-heading\"><div><h1>${title}</h1>${desc?`<p class=\"muted\">${desc}</p>`:''}</div><div class=\"action-row\">${actions}</div></div>`;\nconst demoUI=(method,...args)=>window.DiscoveryDemos?.[method]?.(...args)||'';")
replace_once("active=mine?'archive':p==='home'", "demoPage=context.split('/')[1],active=p==='demo'?({project:'discover',creator:'creators',post:'home',event:'events'}[demoPage]||'home'):mine?'archive':p==='home'")

replace_function('weekly', """function weekly(){return '<section class="weekly-strip"><div class="weekly-symbol">'+icon('trophy',28)+'</div><div class="section-heading"><h2>本周优秀创作者</h2><span class="tag">名单待发布</span></div></section>'; }""")
replace_function('creators', """async function creators(){const warning=await loadFeed(),authors=publicAuthors(),examples=demoUI('creatorCards');return heading('创作者','','<a class="btn small" href="#profile">完善我的介绍</a>')+weekly()+'<div class="page-layout"><div class="main-column">'+warning+'<div class="section-heading"><h2>全部创作者</h2></div><label class="search-box">'+icon('search',18)+'<input id="creator-search" aria-label="搜索创作者" placeholder="搜索昵称、作品或技能"></label><div class="creator-grid" id="creator-results">'+(authors.map(creatorCard).join('')+examples||empty('还没有公开创作者','作品或帖子审核公开后，你会出现在这里。','<a class="btn primary" href="#archive/works">整理我的作品</a>','person'))+'</div></div>'+publicAside(false)+'</div>';}""")
replace_function('communityAside', """function communityAside(){return '<aside class="aside-column community-aside"><section class="card tight"><h3>我的交流</h3><div class="side-links"><a href="#my-posts">'+icon('chat',18)+' 我的帖子</a><a href="#notifications">'+icon('bell',18)+' 消息通知</a><a href="#archive">'+icon('folder',18)+' 我的档案</a></div></section><section class="card tight"><h3>常用入口</h3><div class="side-links"><a href="#discover/bookmarks">'+icon('bookmark',18)+' 我的收藏</a><a href="#prepare">'+icon('compass',18)+' 参赛准备</a><a href="#events">'+icon('trophy',18)+' 查看比赛</a></div></section></aside>'; }""")

replace_once("const posts=state.feed.posts.filter(p=>focusId?p.id===focusId:!kind||p.kind===kind),feedContent=posts.length?'<div class=\"feed-post-list\">'+posts.map(p=>postCard(p)).join('')+'</div>':focusId?empty", "const posts=state.feed.posts.filter(p=>focusId?p.id===focusId:!kind||p.kind===kind),examples=focusId?'':demoUI('postCards',kind),feedContent=posts.length||examples?'<div class=\"feed-post-list\">'+posts.map(p=>postCard(p)).join('')+examples+'</div>':focusId?empty")
replace_once("heading('首页','看创作者发的帖子，分享制作进展、提问或寻找伙伴。',btn('发帖子','new-post','small primary'))", "heading('首页','')")
replace_once('<strong>分享你的进展，或者问个具体问题</strong><small>正文里也可以关联自己的作品</small>', '<strong>分享你的新进展…</strong>')
replace_once("+(warning?'':'<span class=\"feed-count\">'+(focusId?'消息关联的帖子':posts.length+' 条公开帖子')+'</span>')", "")

replace_function('discover', """async function discover(sub=''){const warning=await loadFeed();if(sub==='bookmarks')return heading('我的收藏','收藏过的社区动态，集中在这里。')+myTabs('bookmarks')+warning+(state.feed.posts.some(p=>p.bookmarked)?state.feed.posts.filter(p=>p.bookmarked).map(p=>postCard(p)).join(''):empty('还没有收藏的动态','在社区动态下面点“收藏”，以后就能在这里找到。','<a class="btn" href="#home">去社区看看</a>','bookmark'));const examples=demoUI('projectCards');return heading('作品','',btn('添加我的作品','new-work','small primary'))+'<div class="page-layout"><div class="main-column">'+warning+'<div class="search-row"><label class="search-box">'+icon('search',18)+'<input id="discover-search" aria-label="搜索公开作品" placeholder="搜索作品、技能或创作者"></label></div><div class="work-grid" id="discover-results">'+(state.feed.projects.map((p,i)=>workCard(p,i,true)).join('')+examples||empty('还没有公开作品','先保存作品，准备好再提交公开。',btn('添加我的作品','new-work','primary'),'folder'))+'</div></div>'+publicAside(false)+'</div>'; }""")
replace_function('events', """function events(){const examples=demoUI('eventCards');return heading('比赛','','<a class="btn small" href="#archive/events">我的参赛资料 →</a>')+'<div class="page-layout"><div class="main-column">'+(examples?'<div class="section-heading"><h2>脑洞挑战</h2><span class="demo-badge">演示活动</span></div><div class="demo-event-grid">'+examples+'</div>':'')+'<section class="event-directories"><div class="section-heading"><h2>真实赛事平台</h2></div><div class="directory-links">'+directories.map(d=>'<a href="'+d.url+'" target="_blank" rel="noopener noreferrer"><strong>'+d.name+'</strong><span>'+d.label+'</span><b aria-hidden="true">↗</b></a>').join('')+'</div><p class="small-text muted">日期、参赛资格与报名以官网为准。</p></section></div><aside class="aside-column"><section class="card tight"><h3>参赛工具</h3><a class="btn primary wide" href="#prepare">生成参赛建议</a></section><section class="card tight"><h3>我的参赛资料</h3><div class="side-links"><a href="#archive/events">作品与参赛经历 →</a><a href="#archive/files">截图、文档与材料 →</a><a href="#credential">制作凭证草稿 →</a></div></section><p class="side-note">演示活动不提供报名；主办方认证尚未开放。</p></aside></div>'; }""")

replace_once("if(page==='search'){html=await searchPage();title='搜索';}", "if(page==='demo'){html=demoUI('detail',sub,decodeURIComponent(state.route.split('?')[0].split('/')[2]||''));title='演示内容';}\nelse if(page==='search'){html=await searchPage();title='搜索';}")
replace_once("const needle=q.toLowerCase(),ps=", "const demoResults=demoUI('search',q),needle=q.toLowerCase(),ps=")
replace_once("ps.length||posts.length||authors.length?(ps.length?", "ps.length||posts.length||authors.length||demoResults?(ps.length?")
replace_once("+'</section>':''):empty('没有找到相关内容'", "+'</section>':'')+demoResults:empty('没有找到相关内容'")
replace_once("关键词：'+esc(q)+' · 仅搜索已经公开的内容", "关键词：'+esc(q)+' · 公开内容与标注的演示样例")
replace_once("$('#creator-results').innerHTML=authors.length?authors.map(creatorCard).join(''):empty", "const examples=demoUI('creatorCards',q);$('#creator-results').innerHTML=authors.length||examples?authors.map(creatorCard).join('')+examples:empty")
replace_once("$('#discover-results').innerHTML=found.length?found.map((p,i)=>workCard(p,i,true)).join(''):empty", "const examples=demoUI('projectCards',q);$('#discover-results').innerHTML=found.length||examples?found.map((p,i)=>workCard(p,i,true)).join('')+examples:empty")
p.write_text(s, encoding='utf-8')

p = root / 'dist/index.html'
s = p.read_text(encoding='utf-8-sig')
for key,label in [('home','首页'),('discover','作品'),('creators','创作者'),('events','比赛'),('archive','我的')]:
    old = 'data-nav="'+key+'" title="'+label+'"><span>'+label+'</span>'
    assert s.count(old) == 1
    s = s.replace(old, 'data-nav="'+key+'" title="'+label+'" aria-label="'+label+'">',1)
s = s.replace('20261011-white-notices','20261011-icon-demos')
needle='<script defer src="app.js?v=20261011-icon-demos"></script>'
assert s.count(needle)==1
s=s.replace(needle,'<script defer src="demo-content.js?v=20261011-icon-demos"></script><script defer src="demo-ui.js?v=20261011-icon-demos"></script>'+needle)
p.write_text(s, encoding='utf-8')
