const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "client/client.js"), "utf8");
const start = source.indexOf("function proactiveNotificationKey(state)");
const end = source.indexOf("\n}\n", start) + 2;
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const key = context.proactiveNotificationKey;
const initial = { helpOverlay: null, proactiveOverlay: null, helpModes: {}, ledger: [] };
assert.equal(key(initial), null);
for (const mode of ["voice", "physical"]) {
  assert.equal(key({ ...initial, helpOverlay: "0:0", helpModes: { "0:0": mode } }), null);
}
const reminder = {
  ...initial, helpOverlay: "0:0", helpModes: { "0:0": "voice_reminder" },
  ledger: [{ kind: "help", key: "0:0", id: "first" }],
};
assert.ok(key(reminder));
assert.equal(key({ ...reminder, version: 99, soundEnabled: false }), key(reminder));
assert.notEqual(key({ ...reminder, ledger: [...reminder.ledger, { kind: "help", key: "0:0", id: "second" }] }), key(reminder));
assert.equal(key({ ...reminder, helpOverlay: null }), null);
assert.equal(key({ ...reminder, ledger: [...reminder.ledger, { kind: "manual", id: "adjust" }] }), key(reminder));
assert.notEqual(key({ ...initial, proactiveOverlay: "0:0" }), key(reminder));
console.log("Client notification checks passed: mode 2, repeated execution, modes 3/4, and passive exclusion");
