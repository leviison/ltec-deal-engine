// Read {inp, house} on stdin, print quickChecks for every case (#37). Used by tests/test_screens.py.
const engine = require("../engine/core.js");
let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const { inp, house } = JSON.parse(buf), res = engine.runAll(inp), out = {};
  Object.keys(res.cases).forEach((k) => { out[k] = engine.quickChecks(res.cases[k], inp, house); });
  process.stdout.write(JSON.stringify(out));
});
