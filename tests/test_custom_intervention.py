"""自訂實體介入：現場打字產生說明卡、確定後扣點排隊，之後與模式 1 完全一樣。"""

import unittest

from server import state as recipe_state


def act(state, **action):
    return recipe_state.apply_action(state, action)


def start(state):
    act(state, type="startCustomIntervention")
    return state["customDraft"]


class CustomInterventionTests(unittest.TestCase):
    def test_draft_shows_on_client_only_and_confirm_charges_and_queues(self):
        state = recipe_state.default_state()
        key = start(state)

        # 打字階段：Client 已經看得到卡片，Actor 還沒有，也還沒扣點。
        self.assertTrue(recipe_state.is_custom_key(key))
        self.assertEqual(state["helpOverlay"], key)
        self.assertIsNone(state["helpOverlayItem"])
        self.assertIsNone(state["actorOverlay"])
        self.assertEqual(state["ledger"], [])
        self.assertEqual(state["remaining"], state["totalPoints"])

        # 每打一個 row 花費就跟著算（自動＝動作行數）。
        for rows, cost in (
            (["拿鍋子"], 1),
            (["拿鍋子", "倒水"], 2),
            (["拿鍋子", "倒水", "開火"], 3),
        ):
            act(state, type="updateCustomIntervention", key=key, rows=rows)
            self.assertEqual(state["customCards"][key]["rows"], rows)
            self.assertEqual(state["customCards"][key]["cost"], cost)
        self.assertEqual(state["assistantQueue"], [])

        # 手動覆寫花費。
        act(state, type="updateCustomIntervention", key=key,
            rows=["拿鍋子", "倒水", "開火"], cost=5)
        self.assertEqual(state["customCards"][key]["cost"], 5)
        self.assertTrue(state["customCards"][key]["manualCost"])

        act(state, type="confirmCustomIntervention", key=key)
        self.assertIsNone(state["customDraft"])
        self.assertEqual(state["customCards"][key]["status"], "confirmed")
        self.assertEqual(state["remaining"], state["totalPoints"] - 5)
        entry = state["ledger"][-1]
        self.assertEqual((entry["kind"], entry["pool"], entry["delta"]), ("help", "assist", -5))
        self.assertEqual(entry["helpMode"], "physical")
        self.assertEqual(entry["selectedDetails"], [0, 1, 2])

        # 確定後 Client 的卡片繼續開著，Actor 這時才跳出來。
        self.assertEqual(state["helpOverlay"], key)
        self.assertEqual(state["actorOverlay"]["key"], key)
        self.assertEqual(state["actorOverlay"]["mode"], "physical")
        self.assertEqual(state["actorOverlay"]["details"], [0, 1, 2])

        item = state["assistantQueue"][0]
        self.assertEqual((item["key"], item["source"], item["mode"]), (key, "help", "physical"))
        self.assertEqual(state["helpOverlayItem"], item["id"])

        # 之後與模式 1 一樣：關卡＝開始執行，完成＝結束。
        act(state, type="setHelpOverlay", key=None)
        self.assertEqual(state["assistantCurrent"]["id"], item["id"])
        self.assertEqual(state["assistantQueue"], [])
        act(state, type="finishCurrent")
        self.assertIsNone(state["assistantCurrent"])
        # 自訂介入不屬於食譜上的任何一步，不能污染 done。
        self.assertEqual(state["done"], [])

    def test_reopening_the_card_after_confirm_works_like_mode_one(self):
        state = recipe_state.default_state()
        key = start(state)
        act(state, type="updateCustomIntervention", key=key, rows=["擦桌子"])
        act(state, type="confirmCustomIntervention", key=key)
        item = state["assistantQueue"][0]

        act(state, type="setHelpOverlay", key=None)
        act(state, type="finishCurrent")
        # 已扣過點的自訂卡片還叫得回來（helped 有紀錄）。
        act(state, type="setHelpOverlay", key=key, itemId=item["id"])
        self.assertEqual(state["helpOverlay"], key)
        self.assertEqual(state["actorOverlay"]["key"], key)

    def test_cancel_and_closing_the_card_discard_the_draft(self):
        for closer in ("cancelCustomIntervention", "setHelpOverlay"):
            with self.subTest(closer=closer):
                state = recipe_state.default_state()
                key = start(state)
                act(state, type="updateCustomIntervention", key=key, rows=["擦桌子"])
                if closer == "cancelCustomIntervention":
                    _, changed = act(state, type="cancelCustomIntervention", key=key)
                else:
                    _, changed = act(state, type="setHelpOverlay", key=None)
                self.assertTrue(changed)
                self.assertIsNone(state["customDraft"])
                self.assertNotIn(key, state["customCards"])
                self.assertIsNone(state["helpOverlay"])
                self.assertEqual(state["ledger"], [])
                self.assertEqual(state["remaining"], state["totalPoints"])

    def test_guards(self):
        state = recipe_state.default_state()
        key = start(state)
        # 同時只能有一張草稿。
        _, changed = act(state, type="startCustomIntervention")
        self.assertFalse(changed)
        # 沒有動作不能確定。
        _, changed = act(state, type="confirmCustomIntervention", key=key)
        self.assertFalse(changed)
        # 負的花費、不是清單的 rows 都要擋掉。
        _, changed = act(state, type="updateCustomIntervention", key=key, rows=["A"], cost=-1)
        self.assertFalse(changed)
        _, changed = act(state, type="updateCustomIntervention", key=key, rows="A")
        self.assertFalse(changed)
        # 空白字串會被過濾掉。
        act(state, type="updateCustomIntervention", key=key, rows=["A", "  ", "", " B "])
        self.assertEqual(state["customCards"][key]["rows"], ["A", "B"])
        # 確定之後內容凍結，不能再改。
        act(state, type="confirmCustomIntervention", key=key)
        _, changed = act(state, type="updateCustomIntervention", key=key, rows=["C"])
        self.assertFalse(changed)

    def test_stop_cancel_and_undo_reprice_correctly(self):
        state = recipe_state.default_state()
        key = start(state)
        act(state, type="updateCustomIntervention", key=key, rows=["A", "B", "C", "D"])
        act(state, type="confirmCustomIntervention", key=key)
        act(state, type="setHelpOverlay", key=None)
        self.assertEqual(state["remaining"], state["totalPoints"] - 4)

        # 喊停：只做了 2 條 → 重算成 2 點（自訂介入的原價＝動作行數）。
        act(state, type="stopCurrent", details=[0, 1])
        self.assertEqual(state["ledger"][-1]["executedCost"], 2)
        self.assertEqual(state["ledger"][-1]["executionStatus"], "stopped")
        self.assertEqual(state["remaining"], state["totalPoints"] - 2)

        # 還在排隊就取消：紀錄保留、0 點。
        second = start(state)
        act(state, type="updateCustomIntervention", key=second, rows=["E", "F"])
        act(state, type="confirmCustomIntervention", key=second)
        act(state, type="cancelQueued", itemId=state["assistantQueue"][0]["id"])
        self.assertEqual(state["ledger"][-1]["executionStatus"], "cancelled")
        self.assertEqual(state["remaining"], state["totalPoints"] - 2)

        # 回溯把整筆拿掉。
        act(state, type="undoLedger")
        act(state, type="undoLedger")
        self.assertEqual(state["ledger"], [])
        self.assertEqual(state["remaining"], state["totalPoints"])

    def test_export_includes_custom_records(self):
        state = recipe_state.default_state()
        key = start(state)
        act(state, type="updateCustomIntervention", key=key, rows=["A", "B"])
        act(state, type="confirmCustomIntervention", key=key)

        records = recipe_state.export_payload(state)["records"]
        record = next(item for item in records if item["key"] == key)
        self.assertEqual(record["action"], "自訂步驟")
        self.assertEqual(record["step"], "自訂")
        self.assertIsNone(record["page"])
        self.assertEqual(record["cost"], 2)
        self.assertEqual([item["text"] for item in record["selectedActions"]], ["A", "B"])
        self.assertEqual(record["executionStatus"], "queued")


if __name__ == "__main__":
    unittest.main()
