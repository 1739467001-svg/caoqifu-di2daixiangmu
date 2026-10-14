"""Build an honest screenshot walkthrough, not a simulated screen recording."""
from pathlib import Path
import json, subprocess, wave, math, re
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
FFMPEG = Path(r'C:\Users\xyzaa\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\app\ffmpeg\ffmpeg.exe')
FFPROBE = FFMPEG.with_name('ffprobe.exe')
PYPS = Path(r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')
regular = r'C:\Windows\Fonts\msyh.ttc'
bold = r'C:\Windows\Fonts\msyhbd.ttc'
W,H = 1280,720
sources = {
 'files': ROOT/'ai-youth-archive/review/all-transparent/files-wide.png',
 'work': ROOT/'ai-youth-archive/review/all-transparent/new-work-modal-medium.png',
 'space': ROOT/'archive-workspace/preview.jpg',
 'folder': ROOT/'archive-workspace/new-folder-steps.jpg',
}
scenes = [
 dict(id='01_intro',title='发现：把创作资料放在一起',state='主站已上线 · 截图讲解',image='files',points=['作品，不再散落在聊天和网盘里','资料自己整理，公开内容自己选择','本片用真实截图介绍怎么用'],voice='参加黑客松时，我发现作品、反馈和参赛材料经常散落在聊天和网盘里。发现要做的，是把这些创作资料整理到自己的空间。下面用真实页面截图，介绍怎么用。'),
 dict(id='02_work',title='第一步：建立作品档案',state='主站现有功能',image='work',points=['点击新建，选择作品档案','填写名称、一句话介绍和自己的贡献','保存演示、代码或视频的链接'],voice='先在主站点击新建，建立一个作品档案。填写作品名称，它解决什么问题，以及你负责了什么。演示、代码和视频，也可以通过链接放到同一个档案里。'),
 dict(id='03_files',title='第二步：上传需要保存的资料',state='主站现有功能 · 私人资料',image='files',points=['进入「我的」→「资料文件」','上传图片、PDF或文字笔记','文件默认私密；链接不等于文件备份'],voice='接着进入我的，打开资料文件，上传图片、文档或文字笔记。这里的文件默认私密。视频和代码先保存链接，但链接不等于备份，对方删掉内容后，链接也可能失效。'),
 dict(id='04_workspace',title='专门的资料整理空间',state='独立原型 · 尚未并入主站',image='space',points=['左边是工具，右边是资料画布','按作品、消息等用途建立文件夹','目前是浏览器草稿，不是服务器备份'],voice='我们还做了一个独立的资料整理原型。左边是工具，右边是你的资料画布。不同作品和不同消息，可以放进不同文件夹。它目前单独演示，资料只保存在这个浏览器。'),
 dict(id='05_folder',title='第三步：四步建立文件夹',state='独立原型现有功能',image='folder',points=['① 文件夹名称','② 保存什么　③ 用来做什么','④ 可选封面，然后创建'],voice='点击新建文件夹后，不用一次填一大张表。它会依次问你：叫什么，保存什么，用来做什么，以及要不要封面。最后再创建，返回上一步也会保留刚刚填的内容。'),
 dict(id='06_messages',title='把想法和反馈也收进档案',state='独立原型现有功能',image='space',points=['记录灵感、困难和伙伴建议','把相关消息归入同一个文件夹','以后回看，知道作品是怎么变好的'],voice='文件之外，创作过程也值得留下。比如一个新想法、遇到的困难，或者伙伴给你的建议。把相关消息整理到同一个文件夹，以后就能回看这个作品是怎么一步步变好的。'),
 dict(id='07_preview',title='第四步：自己选择哪些内容公开',state='原型是公开预览 · 主站公开内容需审核',image='space',points=['私人整理区与公开展示分开','先选内容，再检查公开预览','预览不会自动发帖，也不会自动上链'],voice='自己的档案和公开展示，要分开。你可以先选择想展示的内容，再检查公开预览。原型里的预览不会自动发布，也不会上链。主站的公开内容，需要你主动提交并经过审核。'),
 dict(id='08_chain',title='下一步：用 Solana 记录版本指纹',state='未来计划 · 未接入链上',image=None,points=['公开版本一：留下内容指纹与时间','更新到版本二：增加一条新记录','别人核对版本变化；不能证明作品质量'],voice='下一步，我们希望用索拉纳区块链，记录公开作品每个版本的内容指纹和时间。更新作品时，留下新的一条记录。别人就能核对版本有没有被换过，但这不会自动证明作品质量或获奖。'),
 dict(id='09_backup',title='私人备份：文件与核对记录分开',state='未来计划 · 备份与上链均未接入',image=None,points=['完整文件：放在受保护的存储空间','链上记录：只存核对信息，不公开私密正文','目前浏览器草稿不等于备份'],voice='私人备份也要分清楚。完整文件应该放在受保护的存储空间，链上只留下必要的核对信息，不能把私密正文直接公开。现在还没有接入这套备份，浏览器草稿也不能当成备份。'),
 dict(id='10_end',title='先保存作品，再让别人看懂你',state='现有功能 + 独立原型 + 下一步计划',image='files',points=['现有主站：作品、资料、社区展示','独立原型：文件夹与消息整理','下一步：可靠备份与版本核对'],voice='这就是发现的使用路线：先建立作品档案，保存资料，再把愿意展示的内容分享出去。我们要解决的核心问题，是让青少年创作者的作品和成长过程，有一个可以持续整理和保存的地方。'),
]
short_voice = [
 '黑客松作品常散落在聊天和网盘里。发现要把作品与创作过程，整理到你的私人空间。',
 '点击新建，填写作品名称、简介和自己的贡献，再保存演示、代码或视频链接。',
 '在我的资料文件中上传图片、文档和笔记。文件默认私密，保存链接不等于备份。',
 '独立原型左边是工具，右边是资料画布。文件夹只保存在这个浏览器，尚未并入主站。',
 '新建文件夹，依次填写名称、内容、用途和可选封面。返回上一步，答案也会保留。',
 '把灵感、困难和伙伴建议归到相关文件夹。以后回看，就知道作品怎么一步步变好。',
 '先选择内容，再检查公开预览。原型不会自动发帖或上链，主站公开内容还要审核。',
 '下一步计划用索拉纳记录版本指纹和时间，让别人核对更新。目前还没有接入链上。',
 '备份完整文件要用受保护的存储空间。链上只留核对信息。这套备份还没有接入。',
 '先建立作品档案，保存资料，再分享愿意展示的内容。发现，让创作资料持续整理。',
]
for scene, voice in zip(scenes,short_voice): scene['voice']=voice

def font(size,b=False): return ImageFont.truetype(bold if b else regular,size)
def wrap(text, f, maxw):
 lines=[];cur=''
 for ch in text:
  if ch=='\n': lines.append(cur);cur='';continue
  if ImageDraw.Draw(Image.new('RGB',(1,1))).textlength(cur+ch,font=f)>maxw:
   lines.append(cur);cur=ch
  else: cur+=ch
 if cur:lines.append(cur)
 return lines
def txt(draw,text,xy,size=22,color='#28342d',b=False,width=None,gap=1.45):
 f=font(size,b); x,y=xy
 lines=wrap(text,f,width) if width else [text]
 for line in lines: draw.text((x,y),line,font=f,fill=color);y+=int(size*gap)
 return y

def render(scene,index):
 im=Image.new('RGB',(W,H),'#f8fbf7');draw=ImageDraw.Draw(im)
 draw.rectangle((0,0,W,8),fill='#a9e454')
 draw.rounded_rectangle((36,29,105,63),radius=8,fill='#1c322a')
 txt(draw,'发现',(49,32),21,'#c2f271',True)
 txt(draw,scene['state'],(121,35),20,'#53645a')
 txt(draw,scene['title'],(36,80),34,'#173329',True)
 draw.line((36,139,1244,139),fill='#dce8da',width=2)
 if scene['image']:
  area=(36,162,879,616)
  draw.rounded_rectangle(area,radius=12,fill='white',outline='#d9e5d8',width=2)
  src=Image.open(sources[scene['image']]).convert('RGB')
  src.thumbnail((817,428),Image.Resampling.LANCZOS)
  px=area[0]+(area[2]-area[0]-src.width)//2
  py=area[1]+(area[3]-area[1]-src.height)//2
  im.paste(src,(px,py))
  draw=ImageDraw.Draw(im)
  x=907;y=174
  txt(draw,'操作要点',(x,y),25,'#174337',True);y+=55
  for k,p in enumerate(scene['points']):
   draw.ellipse((x,y+6,x+8,y+14),fill='#80c948')
   y=txt(draw,p,(x+20,y),22,'#304639',width=305)+22
 else:
  draw.rounded_rectangle((36,162,1244,616),radius=12,fill='white',outline='#d9e5d8',width=2)
  txt(draw,'计划示意 · 功能尚未接入',(68,188),24,'#497952',True)
  for k,p in enumerate(scene['points']):
   y=254+k*105
   draw.rounded_rectangle((68,y,116,y+48),radius=10,fill='#e1f6c5')
   txt(draw,str(k+1),(84,y+6),25,'#21482a',True)
   txt(draw,p,(140,y+5),27,'#283a2e',width=1020)
  if scene['id']=='08_chain':
   pass
 # Captions are burned into all frames and the source nature stays visible.
 draw.rectangle((0,635,W,H),fill='#18362c')
 txt(draw,'截图讲解 · 不是实际点击录像',(36,651),19,'#d5eddf')
 txt(draw,f'{index+1:02d} / {len(scenes):02d}',(1166,651),19,'#d5eddf')
 im.save(OUT/(scene['id']+'.png'))

def run(args):
 return subprocess.run(args,check=True,cwd=OUT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace')

def ass_time(t):
 cs=round(t*100);h,cs=divmod(cs,360000);m,cs=divmod(cs,6000);sec,cs=divmod(cs,100)
 return f'{h}:{m:02d}:{sec:02d}.{cs:02d}'

def captions(scene,voice_secs):
 parts=[]
 for clause in re.split(r'(?<=[。！？；，：])',scene['voice']):
  if not clause: continue
  parts.extend(clause[i:i+34] for i in range(0,len(clause),34))
 totalchars=sum(len(p) for p in parts)
 t=.35; events=[]
 for p in parts:
  end=t+voice_secs*len(p)/totalchars
  events.append(f'Dialogue: 0,{ass_time(t)},{ass_time(end)},Default,,0,0,0,,{p}')
  t=end
 content='''[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,25,&H00FFFFFF,&H00FFFFFF,&H001C3629,&H001C3629,0,0,0,0,100,100,0,0,1,1,0,2,40,40,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''+ '\n'.join(events)+'\n'
 (OUT/(scene['id']+'.ass')).write_text(content,encoding='utf-8-sig')

if __name__=='__main__':
 (OUT/'scenes.json').write_text(json.dumps(scenes,ensure_ascii=False,indent=2),encoding='utf-8')
 for i,s in enumerate(scenes): render(s,i)
 run([str(PYPS),'-NoProfile','-ExecutionPolicy','Bypass','-File',str(OUT/'synthesize.ps1'),'-DataPath',str(OUT/'scenes.json')])
 allsecs=0
 timeline=[]
 for i,s in enumerate(scenes):
  with wave.open(str(OUT/(s['id']+'.wav')),'rb') as w: voice_secs=w.getnframes()/w.getframerate()
  duration=max(8.5,voice_secs+1.7)
  captions(s,voice_secs)
  timeline.append(dict(id=s['id'],start=round(allsecs,3),duration=round(duration,3),voice_seconds=round(voice_secs,3)))
  allsecs+=duration
  # Short fades and a very mild push-in; no fake cursor or fake interaction.
  vf=f"zoompan=z='min(zoom+0.00007,1.015)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=24,subtitles={s['id']}.ass,fade=t=in:st=0:d=0.25,fade=t=out:st={duration-0.25:.3f}:d=0.25,format=yuv420p"
  run([str(FFMPEG),'-hide_banner','-loglevel','error','-y','-loop','1','-framerate','24','-i',str(OUT/(s['id']+'.png')),'-i',str(OUT/(s['id']+'.wav')),'-vf',vf,'-af','adelay=350|350,apad','-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','128k','-r','24',str(OUT/(s['id']+'.mp4'))])
  print(f"Completed {s['id']} {duration:.1f}s",flush=True)
 if allsecs>180:raise RuntimeError(f'Duration exceeds user limit: {allsecs}')
 concat=OUT/'concat.txt'
 concat.write_text(''.join("file '"+s['id']+".mp4'\n" for s in scenes),encoding='utf-8')
 target=OUT/'发现-产品使用Demo-截图讲解.mp4'
 run([str(FFMPEG),'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy','-movflags','+faststart',str(target)])
 proof=json.loads(run([str(FFPROBE),'-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height','-of','json',str(target)]).stdout)
 proof['kind']='真实截图讲解；非点击录屏'
 proof['limits']='独立原型未合并主站；Solana版本核对与私人备份未接入'
 proof['timeline']=timeline
 (OUT/'verification.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2),encoding='utf-8')
 (OUT/'讲解文案.txt').write_text('\n\n'.join(s['title']+'\n'+s['state']+'\n'+s['voice'] for s in scenes),encoding='utf-8')
 print(json.dumps(proof,ensure_ascii=False),flush=True)
