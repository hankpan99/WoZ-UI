const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
global.window = {};
for (const file of ["shared/format.js", "actor/speech.js", "actor/model.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
}
const slides = [{ step: "1", meal: "蛋糕", stage: "製作", actions: [
  { name: "攪拌", details: ["拿碗", "攪拌均勻"], proactive: [1] },
  { name: "烘烤", details: ["放入烤箱"], proactive: [0], proactiveLevel: "4. 直接" },
] }];
const initial = { currentIndex: 0, helpOverlay: null, proactiveOverlay: null, helpModes: {}, helpDetails: {}, proactive: {} };
const view = (state, data = slides) => window.ActorModel.view(state, data, window.ACTOR_SPEECH);
assert.equal(view(initial), null);
assert.equal(view({ ...initial, actorOverlay: null, helpOverlay: "0:0" }), null);
assert.equal(view({ ...initial, actorOverlay: { key: "0:0", proactive: false, mode: "voice_reminder", details: [1] } }).kind, "voice_reminder");
for (const code of ["unrecognized", "prerequisite", "stage"]) {
  assert.equal(view({ ...initial, actorError: code }).message, window.ACTOR_SPEECH.explanation[code]);
}
assert.equal(view({ ...initial, actorError: "自訂文字\n第二行" }).message, "自訂文字\n第二行");
for (const message of ["無法辨識此指令", "前置步驟尚未完成，無法執行此步驟", "請先完成此階段的所有步驟再往下"]) {
  const error = view({ ...initial, actorError: message, helpOverlay: "0:0" });
  assert.equal(error.kind, "error");
  assert.equal(error.title, "向參與者說明");
  assert.equal(error.message, message);
  assert.deepEqual(error.details, []);
}
assert.equal(view({ ...initial, helpOverlay: "99:0" }), null);
const voiceState = { ...initial, helpOverlay: "0:0", helpModes: { "0:0": "voice" }, helpDetails: { "0:0": [1] } };
const before = JSON.stringify(voiceState);
const voice = view(voiceState);
assert.deepEqual(voice.lines.map(line => [line.label, line.text]), [["動作 02", "：攪拌均勻"]]);
assert.deepEqual(view({ ...voiceState, helpDetails: { "0:0": [] } }).lines, []);
assert.equal(view({ ...voiceState, helpDetails: {} }).lines.length, 2);
assert.deepEqual(voice.details.map(x => x.selected), [false, true]);
assert.equal(JSON.stringify(voiceState), before, "Actor must not mutate server state");
assert.equal(view({ ...voiceState, helpModes: { "0:0": "voice_reminder" } }).level, "2");
assert.equal(view({ ...voiceState, helpModes: { "0:0": "voice_reminder" } }).category, "proactive");
assert.equal(voice.category, "passive");
const reminderState = { ...voiceState, helpModes: { "0:0": "voice_reminder" } };
const reminder = view(reminderState);
assert.equal(reminder.kind, "voice_reminder");
assert.deepEqual(reminder.lines.map(line => [line.label, line.text]), [["動作 02", "：攪拌均勻"]]);
assert.deepEqual(reminder.details.map(detail => detail.selected), [false, true]);
const toggled = view({ ...reminderState, helpDetails: { "0:0": [0] } });
assert.deepEqual(toggled.lines.map(line => [line.label, line.text]), [["動作 01", "：拿碗"]]);
assert.deepEqual(toggled.details.map(detail => detail.selected), [true, false]);
assert.deepEqual(view({ ...reminderState, helpDetails: { "0:0": [] } }).lines, []);
assert.equal(view({ ...reminderState, helpDetails: {} }).lines.length, 2);
assert.equal(view({ ...initial, helpOverlay: "0:0" }).lines[0].text, window.ACTOR_SPEECH.physical[0].text.replace("{step}", "A"));
const inquiry = { ...initial, proactiveOverlay: "0:0", helpDetails: { "0:0": [0] } };
assert.deepEqual(view(inquiry).lines.map(x => x.active), [true, false, false, false]);
assert.deepEqual(view(inquiry).details.map(x => x.selected), [false, true], "Proactive scope comes from Excel");
assert.deepEqual(view({ ...inquiry, proactive: { "0:0": { status: "accepted" } } }).lines.map(x => x.active), [false, true, true, false]);
assert.deepEqual(view({ ...inquiry, proactive: { "0:0": { status: "declined" } } }).lines.map(x => x.active), [false, false, false, true]);
const direct = view({ ...initial, proactiveOverlay: "0:1" });
assert.equal(direct.kind, "direct");
assert.equal(direct.step, "階段 1 - 步驟 B");
assert.equal(direct.page, "1");
assert.equal(direct.actionNumber, 2);
assert.equal(direct.costLabel, "接受將花費");
const executed = view({ ...initial, helpOverlay: "0:0", helped: { "0:0": 2 } });
assert.equal(executed.cost, 2);
assert.equal(executed.costLabel, "本次花費");
assert.equal(direct.answer, null, "Direct intervention does not wait for permission");
assert.equal(direct.lines[0].text, window.ACTOR_SPEECH.direct[0].text.replace("{step}", "B"));
assert.deepEqual(view({ ...initial, proactiveOverlay: "0:1", proactive: { "0:1": { status: "declined" } } }).lines.map(x => x.active), [false, false, true]);
assert.equal(view({ ...voiceState, currentIndex: 99 }).name, "攪拌", "Read the overlay's page, not the browsed page");
console.log("Actor model checks passed: voice, physical, inquiry, direct, selections, waiting, and no state mutation");
