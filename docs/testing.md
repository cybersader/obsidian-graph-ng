---
description: Local Graph NG test commands, content gates, bundle limits and disposable synthetic OpenClast browser checks with screenshots.
---

# How to check a change

Start from the Graph NG checkout root. A passing unit suite says nothing about whether a button is covered by a folded card. A screenshot says nothing about whether the graph counted the right connections. Choose evidence for the claim you want to make.

## Local checks

Use the versions, containment tool and private-terms setup in [Contributing](../CONTRIBUTING.md#setup-and-verification). Keep the private terms out of logs and Git. Run these in order, stopping at a failure:

```sh
node scripts/check-content.mjs secrets
node scripts/check-content.mjs attribution
node scripts/check-content.mjs privacy
./scripts/run.sh install --frozen-lockfile
./scripts/run.sh gates:fast
./scripts/run.sh build
./scripts/run.sh test --timeout 10000
./scripts/run.sh gates
```

- `install` disables lifecycle scripts. The fast gates check secrets, attribution, privacy, dependency pins and frozen lock, then runtime licenses. Attribution includes commit metadata as well as files. For an explicit range, set `GATE_COMMIT_RANGE` to the reviewed `base..tip`.
- `build` typechecks and produces the plugin bundle. `test` runs the named synthetic suites in [`package.json`](../package.json), including the core, worker lifecycle, host adapter, cache, search and renderer. This is not a browser run.
- `gates` repeats the fast checks and measures the existing `main.js`; it does not build or run tests. The [bundle gate](../scripts/bundle-size.mjs) enforces **492,000 raw bytes** and **172,000 gzip bytes**. Brotli is reported, not gated. Rebuild before measuring; see [current headroom](open-decisions.md#bundle-budget).
- On a shared build machine, an outer `heavy-run` resource limit and a separate queue lock can serialize expensive jobs. `run.sh` already takes its own containment lock. Never take that same lock around it.

## Reproduce a browser interaction

Use the OpenClast browser-native harness, **Load and check a plugin** in its `experimental/browser-native/harness/README.md`. Use a prepared local checkout of that project with its browser dependencies and Chromium installed. Set `OPENCLAST_ROOT` to its absolute checkout path. No account, real room, personal vault or copied trust state is needed. The harness enables only the staged plugin for this disposable check.

These commands use the current build and the [checked-in synthetic fixtures](../tests/browser-native/fixtures). Run in Bash from Graph NG after `build`; each invocation gets a fresh output directory. Run one browser at a time.

```sh
check_graph_case() (
  set -eu
  : "${OPENCLAST_ROOT:?Set OPENCLAST_ROOT to the prepared local harness checkout}"
  case "$1" in
    folded-retry)    fixture=folded-retry; settings=settings.json ;;
    arranging-retry) fixture=folded-retry; settings=arranging-settings.json ;;
    jump-list)       fixture=jump-list; settings=settings.json ;;
    *) return 2 ;;
  esac
  inputs="$PWD/tests/browser-native"
  mkdir -p .workspace/browser-checks
  run=$(mktemp -d "$PWD/.workspace/browser-checks/$1.XXXXXX")
  mkdir "$run/plugin"
  cp main.js manifest.json styles.css NOTICE THIRD_PARTY_NOTICES.txt "$run/plugin/"
  cp "$inputs/fixtures/$fixture/$settings" "$run/plugin/data.json"
  printf 'Evidence: %s\n' "$run"
  cd "$OPENCLAST_ROOT"
  node experimental/browser-native/harness/openclast-harness.mjs check \
    --plugin "$run/plugin" --vault "$inputs/fixtures/$fixture/vault" \
    --steps "$inputs/$1.steps.json" --out "$run/check.json"
)
check_graph_case folded-retry
check_graph_case arranging-retry
check_graph_case jump-list
```

| Steps | Question answered |
| --- | --- |
| [Folded retry](../tests/browser-native/folded-retry.steps.json) | Can a person reach Retry beside a narrow folded sheet? Does a successful retry clear the timeout without claiming that a missing row is verified? |
| [Arranging retry](../tests/browser-native/arranging-retry.steps.json) | While Notes is still arranging, does the inspector leave room for **Explore now**, and can the person retry the source load? |
| [Jump list](../tests/browser-native/jump-list.steps.json) | Does typing preserve visible neighbours, distinguish equal names by path and let the person jump or explicitly filter? |

## Read the result

`check` runs the steps in order, takes final light and dark screenshots and tears down. A step such as `{"screenshot":"list-open","selector":".graph-ng-search-slot"}` also captures a named region at that point. Keep the JSON report, both themes and a build identifier together in the ignored output directory. Check step outcomes, plugin load, console/page errors and teardown, not exit status alone.

**Look at the images.** Read the captions and labels, inspect contrast, clipping, tap targets and overlap at the tested width. Inspect visible text and filenames for private content; byte scans cannot do that job. Record the build, fixture, steps, assertions and what actually happened. Keep raw evidence local. A synthetic browser run does not establish signed-in sync, production performance or physical touch behaviour.
