import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const candidates = process.platform === "win32"
  ? [
      [resolve("services/publisher/.venv/Scripts/python.exe"), []],
      ["py", ["-3.10"]],
    ]
  : [
      [resolve("services/publisher/.venv/bin/python"), []],
      ["python3", []],
    ];

const selected = candidates.find(([command]) => command === "py" || command === "python3" || existsSync(command));
if (!selected) throw new Error("Python 3.10-3.12 is required for publisher tests");
const [command, prefix] = selected;
const result = spawnSync(command, [...prefix, "-m", "pytest", "services/publisher/tests"], {
  stdio: "inherit",
  shell: false,
});
process.exit(result.status ?? 1);
