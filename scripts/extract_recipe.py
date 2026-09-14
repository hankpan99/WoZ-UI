#!/usr/bin/env python3
"""Extract the recipe slide data from the source workbook without dependencies."""

import json
import re
import unicodedata
from collections import OrderedDict
from pathlib import Path
from xml.etree.ElementTree import fromstring, iterparse
from zipfile import ZipFile

try:
    from prettytable import PrettyTable
except ModuleNotFoundError:
    PrettyTable = None


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SOURCE = DATA_DIR / "User Study v3.xlsx"
OUTPUT = DATA_DIR / "recipe-data.js"
SHEET_NAME = "食譜excel v2"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
DOC_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
# 「餐點」「階段」欄裡代表「沒有內容」的寫法（與前端 cleanLabel 一致）。
PLACEHOLDER_LABELS = {"", "-", "—"}
# 標記「這條詳細動作屬於助手主動提議的範圍」的欄位與值。
PROACTIVE_HEADER = "介入"
PROACTIVE_MARK = "O"
PROACTIVE_LEVEL_HEADER = "主動程度"
PROACTIVE_LEVELS = {"3. 詢問後", "4. 直接"}


def worksheet_path(archive):
    workbook = fromstring(archive.read("xl/workbook.xml"))
    relations = fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {relation.get("Id"): relation.get("Target") for relation in relations}

    for sheet in workbook.find(NS + "sheets"):
        if sheet.get("name") != SHEET_NAME:
            continue
        target = targets[sheet.get(DOC_REL_NS + "id")]
        return target.lstrip("/") if target.startswith("/") else f"xl/{target}"

    raise ValueError(f"找不到工作表：{SHEET_NAME}")


def cell_values(archive, sheet_path):
    shared_root = fromstring(archive.read("xl/sharedStrings.xml"))
    shared = [
        "".join(node.text or "" for node in item.iter(NS + "t"))
        for item in shared_root.findall(NS + "si")
    ]

    for _, row in iterparse(archive.open(sheet_path), events=("end",)):
        if row.tag != NS + "row":
            continue

        values = {}
        for cell in row.findall(NS + "c"):
            match = re.match(r"[A-Z]+", cell.get("r", ""))
            if not match:
                continue

            column = match.group(0)
            value_node = cell.find(NS + "v")
            cell_type = cell.get("t")

            if cell_type == "s" and value_node is not None:
                value = shared[int(value_node.text)]
            elif cell_type == "inlineStr":
                value = "".join(
                    node.text or "" for node in cell.iter(NS + "t")
                )
            else:
                value = value_node.text if value_node is not None else ""

            values[column] = value.strip() if isinstance(value, str) else value

        yield values
        row.clear()


def extract():
    slides = []
    current_meal = ""
    current_slide = None
    current_action = None

    with ZipFile(SOURCE) as archive:
        rows = iter(cell_values(archive, worksheet_path(archive)))
        header = next(rows)
        columns = {value: column for column, value in header.items()}
        required = ("餐點", "階段", "花費", "步驟名稱", "步驟內容")
        missing = [name for name in required if name not in columns]
        if missing:
            raise ValueError(f"缺少必要欄位：{', '.join(missing)}")
        # 「介入」欄不是必要欄位：沒有這一欄就當成整份食譜都沒有主動幫助，
        # 舊的 workbook 仍然開得起來。
        proactive_column = columns.get(PROACTIVE_HEADER)
        # 舊版 Excel 沒有「主動程度」時，前端會沿用原本的「3. 詢問後」。
        proactive_level_column = columns.get(PROACTIVE_LEVEL_HEADER)

        for row in rows:
            meal = row.get(columns["餐點"], "")
            stage = row.get(columns["階段"], "")

            if meal:
                current_meal = meal

            # 「餐點」或「階段」任一欄出現值，就開始新的一頁。
            # 同一列兩欄都有值時，仍合併為同一頁。
            if meal or stage:
                current_slide = {
                    "step": str(len(slides) + 1),
                    "meal": current_meal,
                    "stage": stage,
                    "actions": [],
                    "image": "",
                }
                slides.append(current_slide)
                current_action = None

            if current_slide is None:
                continue

            action_name = row.get(columns["步驟名稱"], "")
            if action_name:
                raw_cost = row.get(columns["花費"], "")
                cost_match = re.search(r"\d+(?:\.\d+)?", raw_cost)
                current_action = {
                    "name": action_name.replace("\n", " "),
                    "cost": float(cost_match.group()) if cost_match else 0,
                    "details": [],
                    # 「介入」欄標 O 的那幾條詳細動作的索引，沒有就是空陣列。
                    "proactive": [],
                }
                if current_action["cost"] != 0 and current_action["cost"].is_integer():
                    current_action["cost"] = int(current_action["cost"])
                current_slide["actions"].append(current_action)

            detail = row.get(columns["步驟內容"], "")
            if current_action is not None and detail:
                # 記的是 details 的索引，所以一定要在真的 append 之前算、
                # 而且只在這個 if 裡面做：萬一哪天出現「有 O 但沒有步驟內容」
                # 的列，那一列不會產生 detail，索引也就不會整排位移。
                marked = proactive_column and (
                    (row.get(proactive_column) or "").strip().upper() == PROACTIVE_MARK
                )
                if marked:
                    level = (row.get(proactive_level_column) or "").strip() if proactive_level_column else ""
                    if level:
                        if level not in PROACTIVE_LEVELS:
                            raise ValueError(f"不支援的主動程度：{level!r}（步驟：{current_action['name']}）")
                        previous = current_action.get("proactiveLevel")
                        if previous and previous != level:
                            raise ValueError(f"同一步驟有不同的主動程度：{current_action['name']}")
                        current_action["proactiveLevel"] = level
                    current_action["proactive"].append(len(current_action["details"]))
                current_action["details"].append(
                    " ".join(detail.split())
                )

    return slides


def is_placeholder(value):
    return (value or "").strip() in PLACEHOLDER_LABELS


def drop_unlabelled(slides):
    """「餐點」與「階段」都沒有內容的頁面不進食譜，頁碼重新排成連號。

    回傳 (留下來的頁面, 被拿掉的頁面)。
    """
    kept, dropped = [], []
    for slide in slides:
        target = dropped if is_placeholder(slide["meal"]) and is_placeholder(slide["stage"]) else kept
        target.append(slide)

    for index, slide in enumerate(kept):
        slide["step"] = str(index + 1)
    return kept, dropped


def format_cost(value):
    return f"${value:g}"


def display_width(value):
    return sum(
        2 if unicodedata.east_asian_width(character) in ("W", "F", "A") else 1
        for character in str(value)
    )


def fallback_pretty_table(headers, rows):
    """Render an aligned ASCII table when prettytable is not installed."""
    widths = [
        max(display_width(header), *(display_width(row[index]) for row in rows))
        for index, header in enumerate(headers)
    ]

    def border():
        return "+" + "+".join("-" * (width + 2) for width in widths) + "+"

    def table_row(values):
        cells = []
        for value, width in zip(values, widths):
            text = str(value)
            cells.append(f" {text}{' ' * (width - display_width(text))} ")
        return "|" + "|".join(cells) + "|"

    lines = [border(), table_row(headers), border()]
    lines.extend(table_row(row) for row in rows)
    lines.append(border())
    return "\n".join(lines)


def print_cost_summary(slides):
    totals = OrderedDict()
    for slide in slides:
        category = f"{slide['meal']} - {slide['stage']}"
        totals[category] = totals.get(category, 0) + sum(
            action["cost"] for action in slide["actions"]
        )

    rows = [[category, format_cost(cost)] for category, cost in totals.items()]
    headers = ["類別", "總花費"]

    print(f"\n{SHEET_NAME}：各類別總花費")
    if PrettyTable is not None:
        table = PrettyTable()
        table.field_names = headers
        table.align["類別"] = "l"
        table.align["總花費"] = "r"
        table.add_rows(rows)
        print(table)
    else:
        print(fallback_pretty_table(headers, rows))


def print_proactive_summary(slides):
    """主動幫助的總額。這個數字就是 client 上「剩餘主動幫助點數」的起始值。

    計價規則與 server/state.py 的 proactive_cost() 一致：
    整個步驟都標 O ＝ 原價，只標幾條 ＝ 標到的條數。
    """
    rows = []
    total = 0
    for slide in slides:
        for index, action in enumerate(slide["actions"]):
            marks = len(action["proactive"])
            if not marks:
                continue
            details = len(action["details"])
            cost = action["cost"] if details and marks == details else min(marks, action["cost"])
            total += cost
            rows.append([
                f"第{slide['step']}頁 · 步驟{index + 1:02d}",
                f"{marks}/{details}",
                format_cost(cost),
                action["name"],
            ])

    print(f"\n{SHEET_NAME}：主動幫助（「{PROACTIVE_HEADER}」欄標 {PROACTIVE_MARK}）")
    if not rows:
        print("（沒有任何標記）")
        return

    headers = ["步驟", "標記/全部", "花費", "步驟名稱"]
    if PrettyTable is not None:
        table = PrettyTable()
        table.field_names = headers
        table.align = "l"
        table.align["花費"] = "r"
        table.add_rows(rows)
        print(table)
    else:
        print(fallback_pretty_table(headers, rows))
    print(f"合計：{len(rows)} 個步驟 / {format_cost(total)}")


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    slides, dropped = drop_unlabelled(extract())
    for slide in dropped:
        names = "、".join(action["name"] for action in slide["actions"]) or "（沒有步驟）"
        print(f"略過原第 {slide['step']} 頁：餐點與階段都是「-」—— {names}")
    data = json.dumps(slides, ensure_ascii=False, indent=2)
    OUTPUT.write_text(
        f"// Generated from User Study v3.xlsx ({SHEET_NAME}). Run scripts/extract_recipe.py to refresh.\n"
        f"window.RECIPE_SLIDES = {data};\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT.name}")
    print_cost_summary(slides)
    print_proactive_summary(slides)
