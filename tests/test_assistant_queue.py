"""助手執行佇列：排隊、開始執行、插隊規則、喊停與取消的點數修正。"""

import unittest

from server import state as recipe_state

PROACTIVE_KEY = "0:1"  # 3. 詢問後，6 條全標，原價 6
OTHER_PROACTIVE_KEY = "0:4"  # 3. 詢問後，7 條全標，原價 7


def act(state, **action):
    return recipe_state.apply_action(state, action)


class AssistantQueueTests(unittest.TestCase):
    def test_passive_commands_queue_and_start_when_card_closes(self):
        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:0", mode="physical", cost=6)
        act(state, type="repeatHelped", key="0:2", mode="voice", cost=1)
        self.assertIsNone(state["helpOverlay"])
        self.assertIsNone(state["assistantCurrent"])
        self.assertEqual([item["key"] for item in state["assistantQueue"]], ["0:0", "0:2"])
        self.assertEqual(state["remaining"], state["totalPoints"] - 7)

        second = state["assistantQueue"][1]
        act(state, type="setHelpOverlay", key="0:2", itemId=second["id"])
        self.assertEqual(state["helpOverlayItem"], second["id"])
        act(state, type="setHelpOverlay", key=None)
        self.assertEqual(state["assistantCurrent"]["id"], second["id"])
        self.assertEqual([item["key"] for item in state["assistantQueue"]], ["0:0"])

        # 在忙時關卡：不取代正在執行，移到佇列最前面。
        act(state, type="setHelpOverlay", key="0:0")
        act(state, type="setHelpOverlay", key=None)
        self.assertEqual(state["assistantCurrent"]["id"], second["id"])
        self.assertEqual([item["key"] for item in state["assistantQueue"]], ["0:0"])

        # 勾完成才結束；不會自動接下一項。
        act(state, type="setDone", key="0:2", value=True)
        self.assertIsNone(state["assistantCurrent"])
        self.assertEqual(len(state["assistantQueue"]), 1)

    def test_card_for_queued_item_uses_its_own_snapshot(self):
        state = recipe_state.default_state()
        act(state, type="setHelpDetail", key="0:0", index=None, value=False)
        act(state, type="setHelpDetail", key="0:0", index=1, value=True)
        act(state, type="repeatHelped", key="0:0", mode="voice", cost=1)
        act(state, type="setHelpDetail", key="0:0", index=None, value=True)
        act(state, type="repeatHelped", key="0:0", mode="physical", cost=6)
        act(state, type="setHelpOverlay", key="0:0")
        self.assertEqual(state["actorOverlay"]["details"], [1])
        self.assertEqual(state["actorOverlay"]["mode"], "voice")

    def test_voice_reminder_skips_queue_and_waits_when_busy(self):
        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:0", mode="voice_reminder", cost=2)
        self.assertEqual(state["helpOverlay"], "0:0")
        act(state, type="setHelpOverlay", key=None)
        self.assertEqual(state["assistantCurrent"]["mode"], "voice_reminder")

        act(state, type="repeatHelped", key="0:2", mode="physical", cost=1)
        act(state, type="repeatHelped", key="0:3", mode="voice_reminder", cost=1)
        self.assertEqual([item["key"] for item in state["assistantQueue"]], ["0:3", "0:2"])
        act(state, type="setHelpOverlay", key=None)
        self.assertEqual(state["assistantCurrent"]["key"], "0:0")
        self.assertEqual(state["assistantQueue"][0]["key"], "0:3")

    def test_proactive_accept_starts_or_waits_at_front(self):
        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:0", mode="physical", cost=6)
        act(state, type="setProactiveOverlay", key=PROACTIVE_KEY)
        act(state, type="setProactive", key=PROACTIVE_KEY, status="accepted")
        self.assertEqual(state["assistantCurrent"]["key"], PROACTIVE_KEY)
        self.assertEqual(state["assistantQueue"][0]["key"], "0:0")

        act(state, type="setProactiveOverlay", key=OTHER_PROACTIVE_KEY)
        act(state, type="setProactive", key=OTHER_PROACTIVE_KEY, status="accepted")
        self.assertEqual(state["assistantCurrent"]["key"], PROACTIVE_KEY)
        self.assertEqual([item["key"] for item in state["assistantQueue"]], [OTHER_PROACTIVE_KEY, "0:0"])

        act(state, type="setDone", key=PROACTIVE_KEY, value=True)
        act(state, type="setProactiveOverlay", key=OTHER_PROACTIVE_KEY)
        act(state, type="setProactiveOverlay", key=None)
        self.assertEqual(state["assistantCurrent"]["key"], OTHER_PROACTIVE_KEY)

        act(state, type="setProactive", key=OTHER_PROACTIVE_KEY, status="declined")
        self.assertIsNone(state["assistantCurrent"])

    def test_stop_assist_pool_help_reprices(self):
        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:0", mode="physical", cost=6)
        act(state, type="setHelpOverlay", key="0:0")
        act(state, type="setHelpOverlay", key=None)
        _, changed = act(state, type="stopCurrent", details=[0, 1])
        self.assertTrue(changed)
        self.assertIsNone(state["assistantCurrent"])
        entry = state["ledger"][0]
        self.assertEqual(entry["executionStatus"], "stopped")
        self.assertEqual(entry["originalCost"], 6)
        self.assertEqual(state["remaining"], state["totalPoints"] - 2)

        record = recipe_state.export_payload(state)["records"][0]
        self.assertEqual(record["executionStatus"], "stopped")
        self.assertEqual([item["index"] for item in record["executedActions"]], [1, 2])

        act(state, type="amendExecution", entryId=entry["id"], details=list(range(6)))
        self.assertEqual(state["remaining"], state["totalPoints"] - 6)
        self.assertEqual(entry["executionStatus"], "completed")

    def test_stop_proactive_pool_refunds_to_assist_pool(self):
        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:0", mode="voice_reminder", cost=6)
        act(state, type="setHelpOverlay", key=None)
        act(state, type="stopCurrent", details=[0])
        self.assertEqual(state["proactiveRemaining"], state["proactiveTotal"] - 6)
        self.assertEqual(state["remaining"], state["totalPoints"] + 5)

        act(state, type="setProactive", key=PROACTIVE_KEY, status="accepted")
        ledger_count = len(state["ledger"])
        act(state, type="stopCurrent", details=[0, 1, 2])
        self.assertEqual(state["proactive"][PROACTIVE_KEY]["executionStatus"], "stopped")
        self.assertEqual(len(state["ledger"]), ledger_count + 1)
        self.assertEqual(state["proactiveRemaining"], state["proactiveTotal"] - 12)
        self.assertEqual(state["remaining"], state["totalPoints"] + 5 + 3)
        record = next(r for r in recipe_state.export_payload(state)["records"] if r["modeCode"] == 3)
        self.assertEqual(record["executedCost"], 3)
        self.assertIn({"pool": "assist", "delta": 3}, record["pointChanges"])

        # 再修正回全部做完：退點那筆要拿掉，不能重複記。
        act(state, type="amendExecution", proactiveKey=PROACTIVE_KEY, details=list(range(6)))
        self.assertEqual(len(state["ledger"]), ledger_count)
        self.assertEqual(state["remaining"], state["totalPoints"] + 5)

    def test_cancel_queued_keeps_zero_cost_record(self):
        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:0", mode="physical", cost=6)
        item = state["assistantQueue"][0]
        act(state, type="setHelpOverlay", key="0:0")
        act(state, type="cancelQueued", itemId=item["id"])
        self.assertEqual(state["assistantQueue"], [])
        self.assertIsNone(state["helpOverlay"])
        self.assertEqual(len(state["ledger"]), 1)
        self.assertEqual(state["ledger"][0]["executionStatus"], "cancelled")
        self.assertEqual(state["remaining"], state["totalPoints"])

    def test_finish_current_works_even_if_step_was_already_done(self):
        for source in ("help", "proactive"):
            with self.subTest(source=source):
                state = recipe_state.default_state()
                key = "0:0" if source == "help" else PROACTIVE_KEY
                act(state, type="setDone", key=key, value=True)
                if source == "help":
                    act(state, type="repeatHelped", key=key, mode="physical", cost=6)
                    act(state, type="setHelpOverlay", key=key)
                    act(state, type="setHelpOverlay", key=None)
                else:
                    act(state, type="setProactiveOverlay", key=key)
                    act(state, type="setProactive", key=key, status="accepted")
                self.assertEqual(state["assistantCurrent"]["key"], key)

                # 舊做法：步驟早就完成，setDone 沒有變更，收不掉正在執行。
                _, changed = act(state, type="setDone", key=key, value=True)
                self.assertFalse(changed)
                self.assertIsNotNone(state["assistantCurrent"])

                _, changed = act(state, type="finishCurrent")
                self.assertTrue(changed)
                self.assertIsNone(state["assistantCurrent"])
                self.assertIn(key, state["done"])

        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:2", mode="physical", cost=1)
        act(state, type="setHelpOverlay", key="0:2")
        act(state, type="setHelpOverlay", key=None)
        act(state, type="finishCurrent")
        self.assertIn("0:2", state["done"])
        _, changed = act(state, type="finishCurrent")
        self.assertFalse(changed)

    def test_undo_and_reset_clear_items(self):
        state = recipe_state.default_state()
        act(state, type="repeatHelped", key="0:0", mode="physical", cost=6)
        act(state, type="setProactive", key=PROACTIVE_KEY, status="accepted")
        act(state, type="undoLedger")
        self.assertIsNone(state["assistantCurrent"])
        self.assertEqual(len(state["assistantQueue"]), 1)
        act(state, type="undoLedger")
        self.assertEqual(state["assistantQueue"], [])

        act(state, type="repeatHelped", key="0:0", mode="physical", cost=6)
        state, _ = act(state, type="reset")
        self.assertEqual(state["assistantQueue"], [])
        self.assertIsNone(state["assistantCurrent"])


if __name__ == "__main__":
    unittest.main()
