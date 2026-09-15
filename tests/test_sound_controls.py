"""Wizard 的主動提示音設定只影響 Client 音效，不改動點數帳本。"""

import unittest

from server import state as recipe_state


class SoundControlTests(unittest.TestCase):
    def test_toggle_preset_and_preview_are_synced_without_ledger_entries(self):
        state = recipe_state.default_state()
        self.assertTrue(state["soundEnabled"])
        self.assertEqual(state["soundPreset"], "chime")

        state, changed = recipe_state.apply_action(state, {
            "type": "setSoundEnabled", "enabled": False,
        })
        self.assertTrue(changed)
        self.assertFalse(state["soundEnabled"])

        state, changed = recipe_state.apply_action(state, {
            "type": "setSoundPreset", "preset": "ding",
        })
        self.assertTrue(changed)
        self.assertEqual(state["soundPreset"], "ding")

        state, changed = recipe_state.apply_action(state, {
            "type": "previewSound", "preset": "beep",
        })
        self.assertTrue(changed)
        self.assertEqual(state["soundPreviewNonce"], 1)
        self.assertEqual(state["soundPreset"], "beep")
        self.assertEqual(state["ledger"], [])

    def test_invalid_preset_is_rejected(self):
        state = recipe_state.default_state()
        _, changed = recipe_state.apply_action(state, {
            "type": "setSoundPreset", "preset": "unknown",
        })
        self.assertFalse(changed)
        self.assertEqual(state["soundPreset"], "chime")


if __name__ == "__main__":
    unittest.main()
