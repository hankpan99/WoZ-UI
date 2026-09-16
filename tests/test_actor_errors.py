import unittest

from server import state as recipe_state


class ActorErrorTests(unittest.TestCase):
    def test_presets_and_custom_message(self):
        state = recipe_state.default_state()
        for message in ("unrecognized", "prerequisite", "stage", "自訂文字\n第二行"):
            _, changed = recipe_state.apply_action(state, {"type": "setActorError", "message": message})
            self.assertTrue(changed)
            self.assertEqual(state["actorError"], message)
        _, changed = recipe_state.apply_action(state, {"type": "setActorError", "message": "  "})
        self.assertFalse(changed)
        self.assertEqual(state["ledger"], [])

    def test_errors_switch_and_close_without_changing_points(self):
        state = recipe_state.default_state()
        remaining = state["remaining"]
        state["helpOverlay"] = "0:0"
        for message in ("無法辨識此指令", "前置步驟尚未完成，無法執行此步驟", "請先完成此階段的所有步驟再往下"):
            _, changed = recipe_state.apply_action(state, {"type": "setActorError", "message": message})
            self.assertTrue(changed)
            self.assertEqual(state["actorError"], message)
            self.assertIsNone(state["helpOverlay"])
            self.assertIsNone(state["proactiveOverlay"])
            self.assertEqual(state["remaining"], remaining)
            self.assertEqual(state["ledger"], [])
        _, changed = recipe_state.apply_action(state, {"type": "setActorError", "message": 123})
        self.assertFalse(changed)
        recipe_state.apply_action(state, {"type": "setActorError", "message": None})
        self.assertIsNone(state["actorError"])

    def test_intervention_replaces_error(self):
        state = recipe_state.default_state()
        recipe_state.apply_action(state, {"type": "setActorError", "message": "無法辨識此指令"})
        recipe_state.apply_action(state, {"type": "repeatHelped", "key": "0:0", "mode": "voice"})
        self.assertIsNone(state["actorError"])
        self.assertEqual(state["helpOverlay"], "0:0")
