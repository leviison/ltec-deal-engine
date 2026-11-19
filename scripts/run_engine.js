// Read a deal JSON on stdin, print engine results JSON. Used by tests/test_parity.py and tests/test_oil_gas.py.
// The deal's module (meta.asset_class, #46) picks the engine; missing = real estate (core.js).
const ENGINES = { real_estate: "../engine/core.js", oil_gas: "../engine/oil_gas.js" };
let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const inp = JSON.parse(buf);
  const engine = require(ENGINES[(inp.meta && inp.meta.asset_class) || "real_estate"]);
  process.stdout.write(JSON.stringify(engine.runAll(inp)));
});
