// Read a deal JSON on stdin, print engine results JSON. Used by tests/test_parity.py and tests/test_oil_gas.py.
// The deal's module (meta.asset_class, #46) picks the engine; missing = real estate (core.js).
const ENGINES = { real_estate: "../engine/core.js", oil_gas: "../engine/oil_gas.js" };
let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const inp = JSON.parse(buf);
  const ac = (inp.meta && inp.meta.asset_class) || "real_estate";
  const engine = require(ENGINES[ac]);
  // a module with its own quick checks gets its house thresholds (engine/screens_<module>.json)
  const fs = require("fs"), path = require("path"), scr = path.join(__dirname, "..", "engine", `screens_${ac}.json`);
  const house = ac !== "real_estate" && fs.existsSync(scr) ? JSON.parse(fs.readFileSync(scr, "utf8")) : undefined;
  process.stdout.write(JSON.stringify(engine.runAll(inp, house)));
});
