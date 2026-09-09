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

# 參與者的總預算（原本 app.js 的 STARTING_POINTS）。
# 兩個池加起來就是這個數字：主動幫助池的總額由 Excel 的「介入」欄決定，
# 剩下的才是可指揮助手池（見下面的 TOTAL_POINTS）。
TOTAL_BUDGET = 278
# 讀不到 data/recipe-data.js 時的頁數 fallback。
FALLBACK_SLIDE_COUNT = 20

# 兩個各自獨立的點數池。帳本每一筆都標明自己算在哪一池。
# assist    ＝參與者主動要求的幫助，總額 TOTAL_POINTS。
# proactive ＝助手主動提議的幫助，總額由 Excel「介入」欄的 O 算出來。
ASSIST_POOL = "assist"
PROACTIVE_POOL = "proactive"


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


def action_proactive(key):
    """助手主動提議時要代勞的詳細步驟索引（Excel「介入」欄標 O 的那幾條）。

    這個範圍由 Excel 決定、實驗中不可調整，所以與 helpDetails 無關。
    """
    action = _action_at(key)
    if not action:
        return []
    total = len(action.get("details") or [])
    picked = action.get("proactive") or []
    return sorted(
        index for index in picked if isinstance(index, int) and 0 <= index < total
    )


def proactive_cost(key):
    """主動提議要扣的主動幫助點數。規則與 help_cost() 相同。

    整個步驟都標 O ＝ Excel 原價；只標幾條 ＝ 標到的條數
    （min() 同樣是防呆，避免少標反而變貴）。
    """
    marks = len(action_proactive(key))
    if marks == 0:
        return 0
    total = len(action_details(key))
    price = action_cost(key)
    if total and marks == total:
        return _to_number(price)
    return _to_number(min(marks, price))


def proactive_total():
    """全部主動提議的花費加總＝「剩餘主動幫助點數」的起始值。"""
    if not SLIDES:
        return 0
    return sum(
        proactive_cost(f"{slide_index}:{action_index}")
        for slide_index, slide in enumerate(SLIDES)
        for action_index in range(len(slide.get("actions") or []))
    )


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
        # 助手主動提議的結果。key -> {"status": "accepted"|"declined", "cost": n}
        "proactive": {},
        # client 上正在顯示的主動提議卡，或 None。與 helpOverlay 互斥（同時只有一張卡）。
        "proactiveOverlay": None,
        "ledger": [],  # 兩個點數池的唯一來源，每筆用 pool 分辨是哪一池
        "totalBudget": TOTAL_BUDGET,
        "totalPoints": TOTAL_POINTS,
        "remaining": TOTAL_POINTS,
        "proactiveTotal": PROACTIVE_TOTAL,
        "proactiveRemaining": PROACTIVE_TOTAL,
        "slideCount": SLIDE_COUNT,
        # wizard 按「預覽全部步驟」時 +1；client 以目前頁面開始一輪本機預覽。
        # nonce 讓連續按同一個指令也能被辨識，不把暫時的預覽狀態寫進實驗資料。
        "previewNonce": 0,
        "previewActive": False,
        # wizard 指定 client 暫時查看的步驟；None 代表跟隨最小的未完成步驟。
        "clientViewKey": None,
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


def _step_label(key):
    """帳本用的「第N頁 · 步驟NN」，取不到回 None。"""
    if not SLIDES:
        return None
    try:
        slide_index, action_index = (int(part) for part in key.split(":"))
        step = SLIDES[slide_index]["step"]
    except (ValueError, IndexError, KeyError, TypeError):
        return None
    return f"第{step}頁 · 步驟{action_index + 1:02d}"


def proactive_note(key, status):
    """主動提議的帳本文字。只代勞被標記的那幾條時帶上比例。"""
    label = _step_label(key)
    if label is None:
        return None
    answer = "接受" if status == "accepted" else "不接受"
    note = f"{label} 主動提議：{answer}"
    total = len(action_details(key))
    marks = len(action_proactive(key))
    return note if marks == total else f"{note}（{marks}/{total} 動作）"


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


# 主動幫助點數的總額由 Excel 的「介入」欄決定，不是常數。
# 放在 _to_number 之後才算，proactive_cost() 會用到它。
PROACTIVE_TOTAL = proactive_total()
# 可指揮助手池＝總預算扣掉主動幫助池。兩池相加永遠等於 TOTAL_BUDGET，
# 所以改 Excel 的「介入」欄時，這個數字會自己跟著調整。
TOTAL_POINTS = _to_number(TOTAL_BUDGET - PROACTIVE_TOTAL)


def _entry(kind, delta, note, key=None, pool=ASSIST_POOL):
    entry = {
        "id": uuid.uuid4().hex,
        "ts": int(time.time() * 1000),
        "kind": kind,
        # 這筆算在哪一個點數池：可指揮助手（assist）或主動幫助（proactive）。
        "pool": pool,
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
    """這些步驟裡只要有一個是正在顯示的卡片，就把它收掉（兩種卡都算）。"""
    if state["helpOverlay"] in keys:
        state["helpOverlay"] = None
    if state["proactiveOverlay"] in keys:
        state["proactiveOverlay"] = None


def _drop_proactive_entries(state, key):
    """把某個步驟的主動提議帳目全部拿掉（「接受」1 筆、「不接受」2 筆）。"""
    state["ledger"] = [
        item for item in state["ledger"]
        if not (item["kind"] == "proactive" and item.get("key") == key)
    ]


def _pool_of(item):
    """舊資料沒有 pool 欄位時一律算成可指揮池，維持原本的行為。"""
    return item.get("pool", ASSIST_POOL)


def recalculate(state):
    """兩個池各自等於 總額 + Σ 自己那一池的 ledger.delta，不存在第二個點數來源。"""
    assist = state["totalPoints"] + sum(
        item["delta"] for item in state["ledger"] if _pool_of(item) == ASSIST_POOL
    )
    proactive = state["proactiveTotal"] + sum(
        item["delta"] for item in state["ledger"] if _pool_of(item) == PROACTIVE_POOL
    )
    state["remaining"] = _to_number(assist)
    state["proactiveRemaining"] = _to_number(proactive)
    return state


def apply_action(state, action):
    """套用一個 action。回傳 (新狀態, 是否有變更)。state 會被就地修改。"""
    kind = action.get("type")

    if kind == "setPage":
        index = _clamp_index(action.get("index"))
        if index == state["currentIndex"]:
            return state, False
        state["currentIndex"] = index
        state["clientViewKey"] = None
        # 切頁即中止舊頁的預覽，避免 client 繼續播放另一頁的 DOM。
        if state.get("previewActive"):
            state["previewActive"] = False
            state["previewNonce"] = state.get("previewNonce", 0) + 1

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
            # 勾起來的當下就把說明卡推到參與者畫面上；
            # 畫面上只放得下一張卡，所以主動提議卡要讓位。
            state["helpOverlay"] = key
            state["proactiveOverlay"] = None
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
        # 兩張卡互斥：叫出說明卡就把主動提議卡收掉。
        if key:
            state["proactiveOverlay"] = None

    elif kind == "setProactiveOverlay":
        # 只有 Excel 標過「介入」的步驟才有提議卡可以叫；None＝關掉。
        key = action.get("key")
        key = key if isinstance(key, str) and action_proactive(key) else None
        if key == state["proactiveOverlay"]:
            return state, False
        state["proactiveOverlay"] = key
        if key:
            state["helpOverlay"] = None

    elif kind == "setProactive":
        # 參與者對主動提議的回應。status：accepted / declined / None（取消）。
        key = action.get("key")
        if not isinstance(key, str) or not action_proactive(key):
            return state, False
        status = action.get("status")
        if status not in ("accepted", "declined", None):
            return state, False

        current = state["proactive"].get(key)
        if (current or {}).get("status") == status:
            # 已回答後若重新打開提議卡，再按相同答案仍要把卡片關掉。
            if status is not None and state.get("proactiveOverlay") == key:
                _close_overlay_for(state, {key})
                recalculate(state)
                state["version"] += 1
                return state, True
            return state, False

        # 沿用 setHelped 的原則：帳本＝目前生效的帳目清單，不記反向帳。
        # 改判與取消都是先把舊的那幾筆拿掉，再記新的，結果永遠可預期。
        _drop_proactive_entries(state, key)

        if status is None:
            state["proactive"].pop(key, None)
            _close_overlay_for(state, {key})
        else:
            cost = _to_number(action.get("cost"), proactive_cost(key))
            state["proactive"][key] = {"status": status, "cost": cost}
            note = proactive_note(key, status) or f"步驟 {key} 主動提議：{status}"
            # 接受＝主動池付掉這筆。
            state["ledger"].append(_entry("proactive", -cost, note, key, PROACTIVE_POOL))
            if status == "declined":
                # 不接受＝主動池一樣付掉，但等額退進可指揮池，
                # 讓參與者把這筆額度轉成自己能支配的資源。
                state["ledger"].append(
                    _entry("proactive", cost, f"{note} → 退回可指揮點數", key, ASSIST_POOL)
                )
            # 不論接受或不接受，答案送出後都立即收起 Client 的提議卡。
            _close_overlay_for(state, {key})

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
        elif removed["kind"] == "proactive":
            # 「不接受」記了兩筆（主動池扣、可指揮池退），
            # 只回溯一筆會讓兩個池對不起來，所以整組一起拿掉。
            key = removed.get("key")
            _drop_proactive_entries(state, key)
            state["proactive"].pop(key, None)
            _close_overlay_for(state, {key})

    elif kind == "setClientView":
        # wizard 可指定 client 顯示某一步；None 等同回到正式的目前步驟。
        key = action.get("key")
        if key is not None and (not isinstance(key, str) or _action_at(key) is None):
            return state, False
        if key == state.get("clientViewKey") and not state.get("previewActive", False):
            return state, False
        state["clientViewKey"] = key
        # 指定查看優先於自動預覽；若正在播放就同步停止。
        if state.get("previewActive", False):
            state["previewActive"] = False
            state["previewNonce"] = state.get("previewNonce", 0) + 1

    elif kind == "previewAll":
        # 同一顆按鈕切換開始／停止；實際播放在 client 執行，不污染完成紀錄。
        state["previewActive"] = not state.get("previewActive", False)
        state["previewNonce"] = state.get("previewNonce", 0) + 1
        if state["previewActive"]:
            state["clientViewKey"] = None
            # 預覽不能被既有的說明卡遮住。
            state["helpOverlay"] = None
            state["proactiveOverlay"] = None

    elif kind == "finishPreview":
        # client 自然播完時收掉模式。nonce 防止舊計時器關掉較新的預覽。
        if (
            not state.get("previewActive", False)
            or action.get("nonce") != state.get("previewNonce", 0)
        ):
            return state, False
        state["previewActive"] = False
        state["previewNonce"] = state.get("previewNonce", 0) + 1

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


def _export_step_label(index):
    """匯出檔使用與 UI 相同的 A, B, ... Z, AA ... 步驟編號。"""
    value = index + 1
    label = ""
    while value > 0:
        value -= 1
        label = chr(65 + value % 26) + label
        value //= 26
    return label


def _export_location(key):
    try:
        slide_index, action_index = (int(part) for part in key.split(":"))
        slide = SLIDES[slide_index]
        action = slide["actions"][action_index]
    except (AttributeError, ValueError, IndexError, KeyError, TypeError):
        return None
    return {
        "key": key,
        "pageIndex": slide_index,
        "page": slide.get("step", slide_index + 1),
        "stepIndex": action_index,
        "step": _export_step_label(action_index),
        "action": action.get("name", ""),
    }


def _export_selection(key, picked):
    details = action_details(key)
    selected = set(picked)
    items = [
        {"index": index + 1, "text": text}
        for index, text in enumerate(details)
    ]
    return {
        "partial": bool(details) and len(selected) < len(details),
        "selectedActions": [item for item in items if item["index"] - 1 in selected],
        "unselectedActions": [item for item in items if item["index"] - 1 not in selected],
    }


def export_payload(state):
    """建立最後下載與 session JSONL 共用的完整、可直接分析資料。"""
    ledger = state.get("ledger") or []

    def timestamp(kind, key):
        item = next(
            (entry for entry in ledger if entry.get("kind") == kind and entry.get("key") == key),
            None,
        )
        return item.get("ts") if item else None

    records = []
    for key, cost in (state.get("helped") or {}).items():
        location = _export_location(key)
        if not location:
            continue
        records.append({
            **location,
            "mode": "1. 被動",
            "modeCode": 1,
            "status": "accepted",
            "cost": cost,
            "timestamp": timestamp("help", key),
            "pointChanges": [{"pool": "assist", "delta": -cost}],
            **_export_selection(key, selected_details(state, key)),
        })

    for key, result in (state.get("proactive") or {}).items():
        location = _export_location(key)
        if not location:
            continue
        cost = result.get("cost", 0)
        changes = [{"pool": "proactive", "delta": -cost}]
        if result.get("status") == "declined":
            changes.append({"pool": "assist", "delta": cost})
        records.append({
            **location,
            "mode": "3. 主動",
            "modeCode": 3,
            "status": result.get("status"),
            "cost": cost,
            "timestamp": timestamp("proactive", key),
            "pointChanges": changes,
            **_export_selection(key, action_proactive(key)),
        })

    for entry in ledger:
        if entry.get("kind") != "manual":
            continue
        records.append({
            "key": None,
            "pageIndex": None,
            "page": None,
            "stepIndex": None,
            "step": None,
            "action": entry.get("note", "手動調整"),
            "mode": "手動",
            "modeCode": None,
            "status": None,
            "cost": abs(entry.get("delta", 0)),
            "timestamp": entry.get("ts"),
            "pointChanges": [{
                "pool": entry.get("pool", ASSIST_POOL),
                "delta": entry.get("delta", 0),
            }],
            "partial": False,
            "selectedActions": [],
            "unselectedActions": [],
        })

    records.sort(key=lambda record: (
        record["pageIndex"] if record["pageIndex"] is not None else 10**6,
        record["stepIndex"] if record["stepIndex"] is not None else 10**6,
        record["modeCode"] if record["modeCode"] is not None else 10**6,
        record["timestamp"] or 0,
    ))

    return {
        "schemaVersion": 1,
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "totals": {
            "totalBudget": state.get(
                "totalBudget",
                state.get("totalPoints", 0) + state.get("proactiveTotal", 0),
            ),
            "assistTotal": state.get("totalPoints", 0),
            "assistRemaining": state.get("remaining", 0),
            "proactiveTotal": state.get("proactiveTotal", 0),
            "proactiveRemaining": state.get("proactiveRemaining", 0),
        },
        "records": records,
        # 原始狀態也保留，方便需要時重建完整實驗狀態；ledger 裡的 timestamp 不會遺失。
        "state": state,
    }
