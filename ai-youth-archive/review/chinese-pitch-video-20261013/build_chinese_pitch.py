"""Build a short Chinese pitch video from verified product screenshots and labelled plans."""
from pathlib import Path
import json
import math
import re
import subprocess
import wave
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
FFMPEG = Path(r"C:\Users\xyzaa\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\app\ffmpeg\ffmpeg.exe")
FFPROBE = FFMPEG.with_name("ffprobe.exe")
POWERSHELL = Path(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
W, H, FPS = 1280, 720, 24
REGULAR = r"C:\Windows\Fonts\msyh.ttc"
BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

ASSETS = {
    "logo": ROOT / "icon-design/site-icon-mobius-solid-v6.png",
    "home": ROOT / "ai-youth-archive/review/all-transparent/home-wide.png",
    "create": ROOT / "ai-youth-archive/review/all-transparent/new-work-modal-medium.png",
    "files": ROOT / "ai-youth-archive/review/all-transparent/files-wide.png",
    "workspace": ROOT / "archive-workspace/preview.jpg",
    "folder": ROOT / "archive-workspace/new-folder-steps.jpg",
    "community": ROOT / "ai-youth-archive/review/community-chat/home-desktop.png",
}

SCENES = [
    {
        "id": "01_opening",
        "title": "超级富 AI 少年档案",
        "subtitle": "把少年创作，留下来",
        "tag": "中文路演 · 真实界面与明确规划",
        "image": "home",
        "voice": "我们在做发现，给年轻创作者一份属于自己的作品档案。",
        "duration": 13.2,
    },
    {
        "id": "02_problem",
        "title": "作品完成后，过程常常散落",
        "subtitle": "聊天、截图、文件和链接分在不同地方",
        "tag": "为什么做这件事",
        "image": "files",
        "voice": "聊天、截图、文件和链接常常散在各处，作品的过程很容易丢掉。",
        "duration": 14.4,
    },
    {
        "id": "03_product",
        "title": "先给每件作品一个清楚的位置",
        "subtitle": "作品档案记录目标、简介和自己的贡献",
        "tag": "主站已有功能",
        "image": "create",
        "voice": "先建立作品档案，写清项目目标和自己的贡献，让每个作品从开始就有位置。",
        "duration": 14.4,
    },
    {
        "id": "04_private",
        "title": "资料先私人保存，再由本人决定展示",
        "subtitle": "图片、文档、文字笔记和链接围绕同一作品收好",
        "tag": "主站已有功能",
        "image": "files",
        "voice": "图片、PDF、笔记和链接先私人保存，再由创作者选择哪些内容展示。",
        "duration": 13.7,
    },
    {
        "id": "05_workspace",
        "title": "资料画布，让整理像创作一样直观",
        "subtitle": "左边管理工具，右边自由摆放文件夹",
        "tag": "独立原型 · 尚未并入主站",
        "image": "workspace",
        "voice": "资料画布原型，让灵感、伙伴反馈和资料围绕同一个作品整理。",
        "duration": 15.0,
    },
    {
        "id": "06_share",
        "title": "整理以后，才更容易被看懂",
        "subtitle": "公开的是选中的作品内容，不是整个私人空间",
        "tag": "主站已有功能 + 原型预览",
        "image": "community",
        "voice": "公开只展示选中的内容，让队友和评审更快理解一件作品。",
        "duration": 14.4,
    },
    {
        "id": "07_trust",
        "title": "下一步：让作品经历更容易核对",
        "subtitle": "原文件保留在受保护空间，选定版本可留下核对记录",
        "tag": "未来计划 · 未接入链上",
        "image": None,
        "voice": "下一步做备份、版本核对和主办方确认。链上记录只核对选定版本，仍在开发。",
        "duration": 17.8,
    },
    {
        "id": "08_close",
        "title": "让每一个少年创作者带走自己的成长过程",
        "subtitle": "不只留下一个结果，也留下下一次继续创造的起点",
        "tag": "超级富 AI 少年 · 发现",
        "image": "logo",
        "voice": "让每个少年创作者留下作品，也留下属于自己的成长过程。",
        "duration": 14.0,
    },
]


def fnt(size, bold=False):
    return ImageFont.truetype(BOLD if bold else REGULAR, size)


def run(args):
    return subprocess.run(args, cwd=OUT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")


def contain(path, width, height):
    im = Image.open(path).convert("RGB")
    im.thumbnail((width, height), Image.Resampling.LANCZOS)
    return im


def cover(path, width, height):
    im = Image.open(path).convert("RGB")
    scale = max(width / im.width, height / im.height)
    size = (round(im.width * scale), round(im.height * scale))
    im = im.resize(size, Image.Resampling.LANCZOS)
    left = (im.width - width) // 2
    top = (im.height - height) // 2
    return im.crop((left, top, left + width, top + height))


def draw_text(draw, text, xy, size, fill, bold=False, width=None, leading=1.35):
    font = fnt(size, bold)
    x, y = xy
    chunks, cur = [], ""
    for char in text:
        if char == "\n":
            chunks.append(cur)
            cur = ""
            continue
        if width and draw.textlength(cur + char, font=font) > width and cur:
            chunks.append(cur)
            cur = char
        else:
            cur += char
    if cur:
        chunks.append(cur)
    for line in chunks:
        draw.text((x, y), line, font=font, fill=fill)
        y += round(size * leading)
    return y


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def add_image(base, path, box, dim=False, blur=False):
    x, y, width, height = box
    image = cover(path, width, height)
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(8))
    if dim:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 90))
        image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    base.paste(image, (x, y), rounded_mask((width, height), 24))


def render_scene(scene, index):
    background = Image.new("RGB", (W, H), "#0a0d0b")
    draw = ImageDraw.Draw(background)
    draw.rectangle((0, 0, W, H), fill="#0a0d0b")
    draw.rounded_rectangle((38, 32, W - 38, H - 32), radius=44, fill="#111713")
    draw.rectangle((38, 32, W - 38, 42), fill="#a7ed57")
    draw_text(draw, "发现", (68, 68), 30, "#c8f58f", True)
    draw_text(draw, scene["tag"], (178, 75), 22, "#a8b6aa")
    draw_text(draw, f"{index + 1:02d} / {len(SCENES):02d}", (1084, 75), 22, "#a8b6aa")
    draw_text(draw, scene["title"], (68, 132), 46, "#ffffff", True, width=700, leading=1.14)
    draw_text(draw, scene["subtitle"], (70, 260), 26, "#d4ded5", width=690, leading=1.35)

    if scene["image"] and scene["image"] != "logo":
        add_image(background, ASSETS[scene["image"]], (786, 110, 420, 440), dim=False)
        draw = ImageDraw.Draw(background)
        draw.rounded_rectangle((780, 104, 1212, 562), radius=28, outline="#445148", width=2)
        if scene["id"] == "01_opening":
            add_image(background, ASSETS["logo"], (91, 360, 196, 196), dim=False)
    elif scene["image"] == "logo":
        add_image(background, ASSETS["logo"], (835, 164, 300, 300), dim=False)
        draw = ImageDraw.Draw(background)
    else:
        draw.rounded_rectangle((786, 110, 1206, 550), radius=30, fill="#161e19", outline="#445148", width=2)
        draw_text(draw, "计划中的可信记录", (834, 158), 30, "#c8f58f", True)
        steps = [
            ("原文件", "保留在受保护空间"),
            ("公开版本", "留下可核对的记录"),
            ("赛事经历", "由主办方确认具体事项"),
        ]
        y = 226
        for n, (head, body) in enumerate(steps, 1):
            draw.ellipse((836, y, 878, y + 42), fill="#a7ed57")
            draw_text(draw, str(n), (849, y + 4), 22, "#102018", True)
            draw_text(draw, head, (900, y - 2), 27, "#ffffff", True)
            draw_text(draw, body, (900, y + 38), 21, "#b7c4b9", width=240)
            y += 102

    draw.rounded_rectangle((68, 596, 1212, 662), radius=16, fill="#1b2e25")
    draw_text(draw, scene["voice"], (96, 610), 24, "#ffffff", width=1080, leading=1.16)
    path = OUT / f"{scene['id']}.png"
    background.save(path)
    return path


def ass_time(seconds):
    cs = round(seconds * 100)
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def write_ass(scene, spoken_seconds):
    clauses = [item for item in re.split(r"(?<=[，。！？])", scene["voice"]) if item]
    pieces = []
    for clause in clauses:
        pieces.extend(clause[i:i + 22] for i in range(0, len(clause), 22))
    total = max(sum(len(item) for item in pieces), 1)
    at = 0.40
    lines = []
    for piece in pieces:
        finish = at + spoken_seconds * len(piece) / total
        lines.append(f"Dialogue: 0,{ass_time(at)},{ass_time(finish)},Default,,0,0,0,,{piece}")
        at = finish
    ass = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,28,&H00FFFFFF,&H00FFFFFF,&H00151F19,&H00151F19,0,0,0,0,100,100,0,0,1,2,0,2,45,45,90,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + "\n".join(lines) + "\n"
    (OUT / f"{scene['id']}.ass").write_text(ass, encoding="utf-8-sig")


def build_video():
    (OUT / "scenes.json").write_text(json.dumps(SCENES, ensure_ascii=False, indent=2), encoding="utf-8")
    for index, scene in enumerate(SCENES):
        render_scene(scene, index)
    run([str(POWERSHELL), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(OUT / "synthesize_zh.ps1"), "-DataPath", str(OUT / "scenes.json")])

    timeline, total_duration = [], 0.0
    for scene in SCENES:
        with wave.open(str(OUT / f"{scene['id']}.wav"), "rb") as audio:
            seconds = audio.getnframes() / audio.getframerate()
        duration = max(scene["duration"], seconds + 1.2)
        write_ass(scene, seconds)
        zoom = "min(zoom+0.00006,1.018)"
        vf = f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps={FPS},fade=t=in:st=0:d=0.22,fade=t=out:st={duration - 0.22:.3f}:d=0.22,format=yuv420p"
        target = OUT / f"{scene['id']}.mp4"
        run([
            str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-i", str(OUT / f"{scene['id']}.png"), "-i", str(OUT / f"{scene['id']}.wav"),
            "-vf", vf, "-af", "adelay=400|400,apad", "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "aac", "-b:a", "160k", "-r", str(FPS), str(target),
        ])
        timeline.append({"id": scene["id"], "duration": round(duration, 3), "voice_seconds": round(seconds, 3)})
        total_duration += duration

    if total_duration >= 120:
        raise RuntimeError(f"Pitch exceeds the 2-minute user limit: {total_duration:.2f}s")
    concat = OUT / "concat.txt"
    concat.write_text("".join(f"file '{scene['id']}.mp4'\n" for scene in SCENES), encoding="utf-8")
    final = OUT / "超级富AI少年档案-中文路演视频-两分钟内.mp4"
    run([str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(final)])
    proof = json.loads(run([str(FFPROBE), "-v", "error", "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height", "-of", "json", str(final)]).stdout)
    proof["kind"] = "中文路演视频；真实产品截图、独立原型截图与明确标注的未来计划"
    proof["limits"] = "资料画布未并入主站；备份、链上记录与主办方确认仍在计划中"
    proof["timeline"] = timeline
    proof["total_duration_seconds"] = round(total_duration, 3)
    (OUT / "verification.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8")
    script = "\n\n".join(f"{index + 1}. {scene['title']}\n{scene['voice']}" for index, scene in enumerate(SCENES))
    (OUT / "中文路演文案.txt").write_text(script, encoding="utf-8")
    print(json.dumps(proof, ensure_ascii=False))


if __name__ == "__main__":
    build_video()
