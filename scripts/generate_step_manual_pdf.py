#!/usr/bin/env python3
"""Render the recipe (data/recipe-data.js + images/steps) as a printable step manual PDF.

One page per action ("步驟"): stage header, action name, its reference photo,
and its numbered detail list. Pure data/image composition, no browser involved
-- see server/state.py for how the same recipe data drives the live client.

Run with the interpreter that has Pillow available, e.g.:
    python3.10 scripts/generate_step_manual_pdf.py
"""

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "step-manual.pdf"
STEP_DIR = ROOT / "images" / "steps"
ICON_DIR = ROOT / "images" / "icon"
IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"]
STEP_NAME = re.compile(r"^(\d+)(?:[-_](\d+))?$")

sys.path.insert(0, str(ROOT / "server"))
import state as woz_state  # noqa: E402

# 150 DPI A4 portrait.
DPI = 150
PAGE_W, PAGE_H = int(8.27 * DPI), int(11.69 * DPI)
MARGIN = int(0.45 * DPI)
CONTENT_W = PAGE_W - 2 * MARGIN

WHITE = (255, 255, 255)
INK = (30, 30, 30)
MUTED = (120, 120, 120)
RULE = (215, 215, 215)

FONT_CANDIDATES = [
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 3,
     "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 3),
    ("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf", 0,
     "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf", 0),
]


def load_fonts():
    for regular_path, regular_idx, bold_path, bold_idx in FONT_CANDIDATES:
        if Path(regular_path).is_file() and Path(bold_path).is_file():
            def make(size, path=regular_path, idx=regular_idx):
                return ImageFont.truetype(path, size, index=idx)

            def make_bold(size, path=bold_path, idx=bold_idx):
                return ImageFont.truetype(path, size, index=idx)

            return make, make_bold
    raise SystemExit("找不到中文字型（試過 Noto Sans CJK / Droid Sans Fallback），無法產生 PDF。")


REGULAR, BOLD = load_fonts()


def image_manifest():
    manifest = {}
    if not STEP_DIR.is_dir():
        return manifest
    for path in sorted(STEP_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        match = STEP_NAME.match(path.stem)
        if not match:
            continue
        page, step = match.groups()
        key = str(int(page)) if step is None else f"{int(page)}-{int(step)}"
        manifest[key] = path
    return manifest


def icon_for(meal, stage):
    if not ICON_DIR.is_dir():
        return None
    meal = (meal or "").strip()
    stage = (stage or "").strip()
    candidates = [f"{meal}-{stage}", stage]
    if stage == "拿用具、食材":
        candidates.append(f"{meal}-拿食材")
    for name in candidates:
        for ext in IMAGE_EXTENSIONS:
            path = ICON_DIR / f"{name}{ext}"
            if path.is_file():
                return path
    return None


TOKEN = re.compile(r"[A-Za-z0-9_.,%＄$]+|\S")


def wrap_text(draw, text, font, max_width):
    tokens = TOKEN.findall(text)
    lines, current = [], ""
    for token in tokens:
        candidate = current + token
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = token
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def fit_image(path, max_w, max_h):
    img = Image.open(path).convert("RGB")
    scale = min(max_w / img.width, max_h / img.height, 1.0)
    if scale < 1.0:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    return img


def draw_lines(draw, lines, font, x, y, line_height, fill):
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


ICON_SIZE = 200
MAX_DETAIL_COLUMNS = 3
COLUMN_GAP = 36
FOOTER_RESERVE = 60
DETAIL_FONT_SIZES = [30, 27, 24, 21, 18]
ROW_GAP = 14


def split_columns(items, columns):
    size = -(-len(items) // columns)  # ceil
    return [items[i:i + size] for i in range(0, len(items), size)] or [[]]


def _column_height(draw, chunk, font, col_w, line_h):
    return (
        sum(len(wrap_text(draw, item, font, col_w)) for item in chunk) * line_h
        + max(0, len(chunk) - 1) * ROW_GAP
    )


def fit_detail_layout(draw, numbered, available_height):
    """挑一組「字級 + 欄數」讓整份細節清單塞得進剩餘高度，最多 3 欄；
    3 欄仍塞不下就縮小字級（比照 client.js 的 fitColumns，但這裡沒有捲動可退，只能加開一欄或縮字）。
    全部都塞不下就回傳 None，交給呼叫端把清單分頁。
    """
    for size in DETAIL_FONT_SIZES:
        font = REGULAR(size)
        line_h = int(size * 1.45)
        for columns in range(1, MAX_DETAIL_COLUMNS + 1):
            col_w = (CONTENT_W - COLUMN_GAP * (columns - 1)) // columns
            chunks = split_columns(numbered, columns)
            tallest = max(_column_height(draw, chunk, font, col_w, line_h) for chunk in chunks)
            if tallest <= available_height:
                return {"font": font, "line_h": line_h, "col_w": col_w, "columns": chunks}
    return None


def paginate_details(draw, numbered, available_height):
    """把細節清單切成一頁份一頁份：先試著整份塞進一頁；塞不下就用最小字級、
    最多欄數，二分搜尋這一頁最多塞得下幾條，剩下的留給下一頁（繼續同樣流程）。
    """
    pages = []
    remaining = numbered
    font = REGULAR(DETAIL_FONT_SIZES[-1])
    line_h = int(DETAIL_FONT_SIZES[-1] * 1.45)
    columns = MAX_DETAIL_COLUMNS
    col_w = (CONTENT_W - COLUMN_GAP * (columns - 1)) // columns

    while remaining:
        layout = fit_detail_layout(draw, remaining, available_height)
        if layout is not None:
            pages.append(layout)
            remaining = []
            break

        lo, hi, best = 1, len(remaining), 1
        while lo <= hi:
            mid = (lo + hi) // 2
            chunks = split_columns(remaining[:mid], columns)
            tallest = max(_column_height(draw, chunk, font, col_w, line_h) for chunk in chunks)
            if tallest <= available_height:
                best = mid
                lo = mid + 1
            else:
                hi = mid - 1
        pages.append({"font": font, "line_h": line_h, "col_w": col_w, "columns": split_columns(remaining[:best], columns)})
        remaining = remaining[best:]

    return pages


def draw_header(draw, page, slide, action, action_index, meal, stage, icon_path, continuation):
    y = MARGIN
    f_small = REGULAR(20)
    f_title = BOLD(38)

    icon_h = 0
    if icon_path:
        icon = fit_image(icon_path, ICON_SIZE, ICON_SIZE)
        icon_h = icon.height
        page.paste(icon, (PAGE_W - MARGIN - icon.width, MARGIN))

    # 左側文字堆兩行，跟右側圖示各管各的寬度，兩者互不相讓；
    # 標題一律等這個「頁首區塊」（文字兩行 vs. 圖示，取較高者）結束後才開始畫，
    # 這樣標題不管換幾行都不會鑽進圖示底下。
    stage_label = f"第 {slide['step']} 階段 · {meal} - {stage}" if meal != "-" else f"第 {slide['step']} 階段 · {stage}"
    action_count = len(slide["actions"])
    counter = f"動作 {action_index + 1}/{action_count}"
    draw.text((MARGIN, y), stage_label, font=f_small, fill=MUTED)
    draw.text((MARGIN, y + 26), counter, font=f_small, fill=MUTED)
    text_h = 26 + 24

    y += max(icon_h, text_h) + 20

    title = action["name"] + ("（續）" if continuation else "")
    title_lines = wrap_text(draw, title, f_title, CONTENT_W)
    y = draw_lines(draw, title_lines, f_title, MARGIN, y, 50, INK)
    y += 12

    draw.line([(MARGIN, y), (PAGE_W - MARGIN, y)], fill=RULE, width=2)
    y += 24
    return y


def render_action(slide, action, action_index, meal, stage, image_path, icon_path):
    """通常回傳一頁；細節條數多到連最小字級、3 欄都塞不下時（極端案例）才會分成好幾頁，
    續頁不重複放圖，把整頁空間留給清單，確保內容不會被裁掉。
    """
    f_small = REGULAR(20)
    f_label = BOLD(24)

    details = action.get("details") or []
    numbered = [f"{i + 1:02d}. {text}" for i, text in enumerate(details)]

    pages = []
    remaining = numbered
    continuation = False

    while True:
        page = Image.new("RGB", (PAGE_W, PAGE_H), WHITE)
        draw = ImageDraw.Draw(page)
        y = draw_header(draw, page, slide, action, action_index, meal, stage, icon_path, continuation)

        if not continuation:
            if image_path:
                img = fit_image(image_path, int(CONTENT_W * 0.75), int(PAGE_H * 0.32))
                page.paste(img, (MARGIN + (CONTENT_W - img.width) // 2, y))
                y += img.height + 28
            else:
                draw.text((MARGIN, y), "（此步驟沒有示意圖）", font=f_small, fill=MUTED)
                y += 40

        draw.text((MARGIN, y), "詳細動作" + ("（續）" if continuation else ""), font=f_label, fill=INK)
        y += 38

        if not details:
            draw.text((MARGIN, y), "（無更細的動作）", font=f_small, fill=MUTED)
            pages.append(page)
            break

        available_height = PAGE_H - MARGIN - FOOTER_RESERVE - y
        layout_pages = paginate_details(draw, remaining, available_height)
        layout = layout_pages[0]
        used = sum(len(chunk) for chunk in layout["columns"])
        line_h = layout["line_h"]
        for col_index, items in enumerate(layout["columns"]):
            col_x = MARGIN + col_index * (layout["col_w"] + COLUMN_GAP)
            col_y = y
            for item in items:
                lines = wrap_text(draw, item, layout["font"], layout["col_w"])
                col_y = draw_lines(draw, lines, layout["font"], col_x, col_y, line_h, INK)
                col_y += ROW_GAP

        pages.append(page)
        remaining = remaining[used:]
        if not remaining:
            break
        continuation = True

    return pages


def main():
    slides = woz_state.SLIDES
    if not slides:
        raise SystemExit("讀不到 data/recipe-data.js，無法產生手冊。")

    step_images = image_manifest()
    pages = []
    total_actions = sum(len(slide["actions"]) for slide in slides)
    rendered = 0

    for slide in slides:
        meal = (slide.get("meal") or "").strip()
        stage = (slide.get("stage") or "").strip()
        icon_path = icon_for(meal, stage)
        step_number = int(slide["step"])
        for action_index, action in enumerate(slide["actions"]):
            key = f"{step_number}-{action_index + 1}"
            image_path = step_images.get(key)
            pages.extend(render_action(slide, action, action_index, meal, stage, image_path, icon_path))
            rendered += 1
            print(f"[{rendered}/{total_actions}] 第{slide['step']}階段 動作{action_index + 1}: {action['name']}")

    total_pages = len(pages)
    for index, page in enumerate(pages):
        draw = ImageDraw.Draw(page)
        footer = f"第 {index + 1} / {total_pages} 頁"
        w = draw.textlength(footer, font=REGULAR(16))
        draw.text(((PAGE_W - w) / 2, PAGE_H - MARGIN + 12), footer, font=REGULAR(16), fill=MUTED)

    pages[0].save(OUTPUT, save_all=True, append_images=pages[1:], quality=85, resolution=DPI)
    print(f"Created {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.1f} MiB, {total_pages} 頁)")


if __name__ == "__main__":
    main()
