"""所有主步驟都能重複介入，且每次執行保有獨立快照。"""

import unittest

from server import state as recipe_state


class RepeatableHelpTests(unittest.TestCase):
    def select_only(self, state, key, indexes):
        recipe_state.apply_action(state, {
            "type": "setHelpDetail", "key": key, "index": None, "value": False,
        })
        for index in indexes:
            recipe_state.apply_action(state, {
                "type": "setHelpDetail", "key": key, "index": index, "value": True,
            })

    def test_every_step_keeps_each_runs_selection_mode_and_cost(self):
        for key in ("0:0", "19:3"):
            with self.subTest(key=key):
                state = recipe_state.default_state()
                self.select_only(state, key, [0, 1])
                recipe_state.apply_action(state, {
                    "type": "repeatHelped", "key": key, "mode": "physical", "cost": 2,
                })
                self.assertEqual(state["helpOverlay"], key)

                self.select_only(state, key, [2])
                self.assertIsNone(state["helpOverlay"])
                recipe_state.apply_action(state, {
                    "type": "repeatHelped", "key": key, "mode": "voice", "cost": 1,
                })

                self.assertEqual(
                    [entry["selectedDetails"] for entry in state["ledger"]],
                    [[0, 1], [2]],
                )
                self.assertEqual([entry["run"] for entry in state["ledger"]], [1, 2])
                self.assertNotEqual(state["ledger"][0]["id"], state["ledger"][1]["id"])
                self.assertIn("語音介入", state["ledger"][1]["note"])
                self.assertEqual(state["remaining"], state["totalPoints"] - 3)

                records = recipe_state.export_payload(state)["records"]
                self.assertEqual([record["executionNumber"] for record in records], [1, 2])
                self.assertEqual(
                    [[item["index"] for item in record["selectedActions"]] for record in records],
                    [[1, 2], [3]],
                )
                self.assertEqual([record["cost"] for record in records], [2, 1])
                self.assertEqual(
                    [record["entryId"] for record in records],
                    [entry["id"] for entry in state["ledger"]],
                )

    def test_undo_removes_only_the_latest_run(self):
        state = recipe_state.default_state()
        key = "0:0"
        for mode, cost in (("physical", 2), ("voice", 1)):
            recipe_state.apply_action(state, {
                "type": "repeatHelped", "key": key, "mode": mode, "cost": cost,
            })

        recipe_state.apply_action(state, {"type": "undoLedger"})
        self.assertEqual(len(state["ledger"]), 1)
        self.assertEqual(state["helped"][key], 2)
        self.assertEqual(state["helpModes"][key], "physical")
        self.assertEqual(state["remaining"], state["totalPoints"] - 2)
        self.assertIsNone(state["helpOverlay"])

        recipe_state.apply_action(state, {"type": "undoLedger"})
        self.assertNotIn(key, state["helped"])
        self.assertEqual(state["remaining"], state["totalPoints"])

    def test_run_numbers_are_independent_for_each_step(self):
        state = recipe_state.default_state()
        for key in ("0:0", "0:1", "0:0"):
            recipe_state.apply_action(state, {
                "type": "repeatHelped", "key": key, "mode": "physical", "cost": 1,
            })
        self.assertEqual([entry["run"] for entry in state["ledger"]], [1, 1, 2])
        self.assertEqual(state["remaining"], state["totalPoints"] - 3)

    def test_legacy_help_action_adds_a_run_but_cannot_delete_history(self):
        state = recipe_state.default_state()
        key = "0:0"
        for _ in range(2):
            recipe_state.apply_action(state, {
                "type": "setHelped", "key": key, "mode": "physical", "value": True, "cost": 1,
            })
        self.assertEqual(len(state["ledger"]), 2)

        _, changed = recipe_state.apply_action(state, {
            "type": "setHelped", "key": key, "mode": "physical", "value": False,
        })
        self.assertFalse(changed)
        self.assertEqual(len(state["ledger"]), 2)

    def test_invalid_step_cannot_create_a_run(self):
        state = recipe_state.default_state()
        _, changed = recipe_state.apply_action(state, {
            "type": "repeatHelped", "key": "999:0", "mode": "physical", "cost": 1,
        })
        self.assertFalse(changed)
        self.assertEqual(state["ledger"], [])

    def test_voice_reminder_is_a_distinct_repeatable_mode(self):
        state = recipe_state.default_state()
        self.assertIn("voice_reminder", state["supportedHelpModes"])
        key = "0:0"
        self.select_only(state, key, [0, 1])

        state, changed = recipe_state.apply_action(state, {
            "type": "repeatHelped", "key": key, "mode": "voice_reminder", "cost": 2,
        })
        self.assertTrue(changed)
        self.assertEqual(state["helpOverlay"], key)
        self.assertEqual(state["helpModes"][key], "voice_reminder")
        self.assertEqual(state["ledger"][0]["helpMode"], "voice_reminder")
        self.assertIn("語音提醒建議", state["ledger"][0]["note"])
        self.assertEqual(state["ledger"][0]["selectedDetails"], [0, 1])
        self.assertEqual(state["remaining"], state["totalPoints"])
        self.assertEqual(state["proactiveRemaining"], state["proactiveTotal"] - 2)
        self.assertEqual(state["ledger"][0]["pool"], "proactive")
        self.assertIsNone(state["proactiveOverlay"])

        recipe_state.apply_action(state, {
            "type": "repeatHelped", "key": key, "mode": "voice", "cost": 1,
        })
        records = recipe_state.export_payload(state)["records"]
        self.assertEqual([record["modeCode"] for record in records], [1, 2])
        self.assertEqual([record["helpMode"] for record in records], ["voice", "voice_reminder"])
        self.assertEqual([record["executionNumber"] for record in records], [2, 1])
        self.assertEqual([record["interventionType"] for record in records], ["passive", "proactive"])
        self.assertEqual([record["pointChanges"][0]["pool"] for record in records], ["assist", "proactive"])
        recipe_state.apply_action(state, {"type": "undoLedger"})
        self.assertEqual(state["remaining"], state["totalPoints"])
        self.assertEqual(state["proactiveRemaining"], state["proactiveTotal"] - 2)
        recipe_state.apply_action(state, {"type": "undoLedger"})
        self.assertEqual(state["proactiveRemaining"], state["proactiveTotal"])


if __name__ == "__main__":
    unittest.main()
