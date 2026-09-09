"""WoZ 實驗狀態：預設值與 reducer。

所有規則只在這裡實作一次，client 與 wizard 都只送 action、不自己算狀態。
"""

import json
import re
import time
import uuid
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RECIPE_DATA = PROJECT_ROOT / "data" / "recipe-data.js"

# 參與者的總點數（原本 app.js 的 STARTING_POINTS）。
TOTAL_POINTS = 200
# 讀不到 data/recipe-data.js 時的頁數 fallback。
FALLBACK_SLIDE_COUNT = 20


def load_slides():
    """從 data/recipe-data.js 取出 window.RECIPE_SLIDES 的內容。

    該檔由 scripts/extract_recipe.py 產生，`=` 之後就是合法 JSON。
    """
    try:
        text = RECIPE_DATA.read_text(encoding="utf-8")
        payload = re.sub(r"^.*?window\.RECIPE_SLIDES\s*=\s*", "", text, count=1, flags=re.S)
        payload = payload.strip().rstrip(";")
        slides = json.loads(payload)
        if not isinstance(slides, list) or not slides:
            raise ValueError("RECIPE_SLIDES 不是非空陣列")
        return slides
    except Exception as error:  # noqa: BLE001 - 任何解析失敗都要能繼續啟動
        print(f"[warn] 無法解析 {RECIPE_DATA}：{error}")
        print(f"[warn] 改用 fallback：{FALLBACK_SLIDE_COUNT} 頁，步驟原價未知。")
        return None


SLIDES = load_slides()
SLIDE_COUNT = len(SLIDES) if SLIDES else FALLBACK_SLIDE_COUNT


def _action_at(key):
    """由 "slideIdx:actionIdx" 取得該步驟的資料，取不到回 None。"""
    if not SLIDES:
        return None
    try:
        slide_index, action_index = (int(part) for part in key.split(":"))
        return SLIDES[slide_index]["actions"][action_index]
    except (ValueError, IndexError, KeyError, TypeError):
        return None


def action_cost(key):
    """由 "slideIdx:actionIdx" 取得該步驟在 Excel 上的原價，取不到回 0。"""
    action = _action_at(key)
    return action.get("cost", 0) if action else 0


def action_details(key):
    """該步驟的詳細步驟清單（＝參與者說明卡上會逐條列出的內容），取不到回 []。"""
    action = _action_at(key)
    return list(action.get("details") or []) if action else []


def default_state():
    return {
        "version": 0,
        "currentIndex": 0,
        "done": [],  # ["slideIdx:actionIdx"]，→ client 灰階；不影響點數
        "helped": {},  # key -> 該次接受幫助的花費
        # key -> 這次要代勞的詳細步驟索引。沒有紀錄＝全部勾選（見 selected_details）。
        "helpDetails": {},
        # client 上正在顯示的整頁說明卡，或 None。
        "helpOverlay": None,
        "ledger": [],  # 點數的唯一來源
        "totalPoints": TOTAL_POINTS,
        "remaining": TOTAL_POINTS,
        "slideCount": SLIDE_COUNT,
        # wizard 按「捲回目前步驟」時 +1；client 看到號碼變了就重新對齊列表。
        "scrollNonce": 0,
    }


def selected_details(state, key):
    """目前勾選的詳細步驟索引。helpDetails 沒有紀錄過就是「全部勾選」。"""
    total = len(action_details(key))
    picked = state["helpDetails"].get(key)
    if picked is None:
        return list(range(total))
    return sorted(index for index in picked if isinstance(index, int) and 0 <= index < total)


def help_cost(state, key):
    """接受幫助要扣的點數。

    全部勾選＝Excel 原價；少勾幾個＝剩下勾選的個數。
    目前資料裡每個步驟的原價都剛好等於詳細步驟的個數，所以兩條規則是同一條；
    min() 是防呆，萬一 Excel 出現「原價比詳細步驟數少」的步驟，
    少勾也不該讓它反而變貴。
    """
    total = len(action_details(key))
    price = action_cost(key)
    picked = len(selected_details(state, key))
    if total == 0 or picked == total:
        return _to_number(price)
    return _to_number(min(picked, price))


def help_note(state, key):
    """帳本文字。打折過（沒有全勾）時帶上比例，看紀錄時一眼就知道原因。"""
    if not SLIDES:
        return None
    try:
        slide_index, action_index = (int(part) for part in key.split(":"))
        step = SLIDES[slide_index]["step"]
    except (ValueError, IndexError, KeyError, TypeError):
        return None
    note = f"第{step}頁 · 步驟{action_index + 1:02d} 接受幫助"
    total = len(action_details(key))
    picked = len(selected_details(state, key))
    return note if picked == total else f"{note}（{picked}/{total} 動作）"


def _clamp_index(index):
    try:
        index = int(index)
    except (TypeError, ValueError):
        return 0
    return max(0, min(SLIDE_COUNT - 1, index))


def _to_number(value, fallback=0):
    """數字欄位一律經過這裡：整數就保持整數，避免顯示成 3.0。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return int(number) if number.is_integer() else round(number, 2)


def _entry(kind, delta, note, key=None):
    entry = {
        "id": uuid.uuid4().hex,
        "ts": int(time.time() * 1000),
        "kind": kind,
        "delta": delta,
        "note": note,
    }
    if key is not None:
        entry["key"] = key
    return entry


def _resync_help(state, key):
    """詳細步驟改動後，把已經記在帳上的那一筆就地改掉。

    沿用「帳本是目前生效的帳目清單」的原則：不新增反向帳、也不換位置，
    所以剩餘點數與畫面上的勾選永遠一致，回溯的結果也一樣可預期。
    """
    if key not in state["helped"]:
        return
    cost = help_cost(state, key)
    note = help_note(state, key)
    state["helped"][key] = cost
    for item in state["ledger"]:
        if item["kind"] == "help" and item.get("key") == key:
            item["delta"] = -cost
            if note:
                item["note"] = note


def _close_overlay_for(state, keys):
    """這些步驟裡只要有一個是正在顯示的說明卡，就把它收掉。"""
    if state["helpOverlay"] in keys:
        state["helpOverlay"] = None


def recalculate(state):
    """remaining 永遠等於 totalPoints + Σ ledger.delta，不存在第二個點數來源。"""
    total = state["totalPoints"] + sum(item["delta"] for item in state["ledger"])
    state["remaining"] = _to_number(total)
    return state


def apply_action(state, action):
    """套用一個 action。回傳 (新狀態, 是否有變更)。state 會被就地修改。"""
    kind = action.get("type")

    if kind == "setPage":
        index = _clamp_index(action.get("index"))
        if index == state["currentIndex"]:
            return state, False
        state["currentIndex"] = index

    elif kind == "setDone":
        key = action.get("key")
        if not isinstance(key, str):
            return state, False
        done = set(state["done"])
        if action.get("value"):
            if key in done:
                return state, False
            done.add(key)
        else:
            if key not in done:
                return state, False
            done.discard(key)
        state["done"] = sorted(done, key=_key_order)
        # 做完了就不用再看說明卡。
        if action.get("value"):
            _close_overlay_for(state, {key})

    elif kind == "setDoneBulk":
        keys = [key for key in action.get("keys") or [] if isinstance(key, str)]
        if not keys:
            return state, False
        done = set(state["done"])
        updated = done | set(keys) if action.get("value") else done - set(keys)
        if updated == done:
            return state, False
        state["done"] = sorted(updated, key=_key_order)
        if action.get("value"):
            _close_overlay_for(state, set(keys))

    elif kind == "setHelped":
        key = action.get("key")
        if not isinstance(key, str):
            return state, False
        if action.get("value"):
            # 預設花費由勾選中的詳細步驟算出；wizard 手動打過的數字仍然優先。
            cost = _to_number(action.get("cost"), help_cost(state, key))
            if key in state["helped"]:
                return state, False
            state["helped"][key] = cost
            note = help_note(state, key) or action.get("note") or f"步驟 {key} 接受幫助"
            state["ledger"].append(_entry("help", -cost, note, key))
            # 勾起來的當下就把說明卡推到參與者畫面上。
            state["helpOverlay"] = key
        else:
            if key not in state["helped"]:
                return state, False
            del state["helped"][key]
            # 取消勾選＝直接把那筆帳目拿掉，不記反向帳，
            # 這樣帳本與勾選狀態永遠一致、回溯也永遠可預期。
            state["ledger"] = [
                item for item in state["ledger"]
                if not (item["kind"] == "help" and item.get("key") == key)
            ]
            _close_overlay_for(state, {key})

    elif kind == "setHelpDetail":
        # 這次要代勞哪些詳細步驟。index 為 None＝整個步驟全選 / 全不選。
        key = action.get("key")
        if not isinstance(key, str):
            return state, False
        total = len(action_details(key))
        if total == 0:
            return state, False

        picked = set(selected_details(state, key))
        index = action.get("index")
        if index is None:
            updated = set(range(total)) if action.get("value") else set()
        else:
            try:
                index = int(index)
            except (TypeError, ValueError):
                return state, False
            if not 0 <= index < total:
                return state, False
            updated = picked | {index} if action.get("value") else picked - {index}

        if updated == picked:
            return state, False
        state["helpDetails"][key] = sorted(updated)
        # 已經扣過點的話，那筆帳目跟著改，不會多記一筆。
        _resync_help(state, key)

    elif kind == "setHelpOverlay":
        # 只有已經扣過點的步驟才叫得出說明卡；None＝關掉。
        key = action.get("key")
        key = key if isinstance(key, str) and key in state["helped"] else None
        if key == state["helpOverlay"]:
            return state, False
        state["helpOverlay"] = key

    elif kind == "adjustPoints":
        delta = _to_number(action.get("delta"))
        if delta == 0:
            return state, False
        note = action.get("note") or ("手動加點" if delta > 0 else "手動扣點")
        state["ledger"].append(_entry("manual", delta, note))

    elif kind == "undoLedger":
        if not state["ledger"]:
            return state, False
        removed = state["ledger"].pop()
        if removed["kind"] == "help":
            state["helped"].pop(removed.get("key"), None)
            _close_overlay_for(state, {removed.get("key")})

    elif kind == "recenter":
        # 純顯示指令：不改任何實驗資料，只請 client 把步驟列表捲回定位。
        state["scrollNonce"] += 1

    elif kind == "reset":
        previous_version = state["version"]
        state = default_state()
        # version 保持單調遞增，重置後仍能看出是「比較新的」狀態。
        state["version"] = previous_version

    else:
        # 最常見的原因是改完 state.py 沒重啟 server（Python 不會自動重載）。
        print(f"[warn] 未知的 action：{kind!r} —— 若這是新加的功能，請重啟 server。")
        return state, False

    recalculate(state)
    state["version"] += 1
    return state, True


def _key_order(key):
    """讓 done 依 (頁, 步驟) 排序，除錯與紀錄檔比較好讀。"""
    try:
        slide_index, action_index = (int(part) for part in key.split(":"))
        return (slide_index, action_index)
    except ValueError:
        return (10**6, 0)
