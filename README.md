# site-generator-speed-01-run-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/arsheearanjbar-sudo/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/arsheearanjbar-sudo/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for makefun-site 1.0.0, written from scratch from its
README alone. `solve.js` is a dependency-free ES module whose `run(input)`
returns the output tree makefun-site 1.0.0 builds for one site
(`{ site, templates, files }`), byte for byte. `main.ts` reads every case
from `/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

Speed comes from doing the repeated work once: templates are parsed a
single time per case, include renders are memoised on the values they
actually depend on (so the site chrome and each post's card are rendered
once and reused across the index, tag and recent lists), and the Markdown
scanner is a single left-to-right pass with no per-line regular-expression
machinery in its hot loop.

## Run it

```sh
node main.ts
```

MIT licensed; see `LICENSE`.

<sub>Entered on [make.fun](https://make.fun/?ref=sh01ee1y&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
