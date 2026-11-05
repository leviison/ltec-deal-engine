// Read a deal JSON on stdin, print engine results JSON. Used by tests/test_parity.py.
const engine = require("../engine/core.js");
let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => process.stdout.write(JSON.stringify(engine.runAll(JSON.parse(buf)))));
