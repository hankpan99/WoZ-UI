const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "wizard/intervention.js"), "utf8"));

(async () => {
  const sent = [];
  let complete;
  const controller = window.WizardIntervention.create((action) => {
    sent.push(action);
    return new Promise((resolve) => { complete = resolve; });
  }, () => {});
  controller.select("0:0", "physical");
  assert.equal(controller.mode("0:0"), "physical");
  controller.select("0:0", "physical");
  assert.equal(controller.mode("0:0"), undefined);
  assert.equal(sent.length, 0, "Selecting/cancelling modes must never dispatch a charge");
  assert.equal(await controller.execute("0:0", 2), false);
  for (const mode of ["physical", "voice", "voice_reminder"]) {
    controller.select("0:0", mode);
    assert.equal(await controller.execute("0:0", NaN), false);
    assert.equal(await controller.execute("0:0", -1), false);
    const previousCount = sent.length;
    const execution = controller.execute("0:0", 2);
    assert.equal(controller.busy("0:0"), true);
    assert.deepEqual(sent.at(-1), { type: "repeatHelped", key: "0:0", mode, cost: 2 });
    assert.equal(await controller.execute("0:0", 2), false, "Double click must not send a second execution");
    controller.select("0:0", "physical");
    assert.equal(controller.mode("0:0"), mode, "Mode is frozen while sending");
    complete({ changed: true });
    assert.equal(await execution, true);
    assert.equal(controller.mode("0:0"), undefined);
    assert.equal(controller.busy("0:0"), false);
    assert.equal(await controller.execute("0:0", 2), false, "A new execution requires a new selection");
    assert.equal(sent.length, previousCount + 1);
  }
  controller.select("0:0", "voice");
  const failed = controller.execute("0:0", 1);
  complete(null);
  assert.equal(await failed, false);
  assert.equal(controller.mode("0:0"), "voice", "Keep selection after a failed send");
  assert.match(controller.message("0:0"), /確認紀錄/);
  controller.clear();
  assert.equal(controller.mode("0:0"), undefined);
  console.log("Wizard intervention checks passed: selection, execution, repeated steps, double clicks, and failure");
})().catch((error) => { console.error(error); process.exitCode = 1; });
