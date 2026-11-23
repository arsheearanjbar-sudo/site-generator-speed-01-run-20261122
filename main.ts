import { setFlagsFromString } from "node:v8";
setFlagsFromString("--no-incremental-marking");
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// The harness mounts the cases at /input and collects answers from
// /output; the process driver stands those mounts in with the
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR environment variables instead.
const input = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const { run } = await import("./solve.js");

const cases = JSON.parse(readFileSync(join(input, "cases.json"), "utf8"));
const answers = cases.map((c) => run(c.input));
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "answers.json"), JSON.stringify(answers));
