#!/bin/bash
# Round 10: runs the e2e scripts of the rounds 4-9 (and the testers') on the current build and prints one line per script:
# the last line of its output and its exit status.  bash test/e2e/round10-regress.sh > test-artifacts/round-10/regress.log
cd "$(dirname "$0")/../.." || exit 1
mkdir -p test-artifacts/round-10
node scripts/build.mjs >/dev/null || exit 1
node test/fixtures/make-audio.mjs >/dev/null 2>&1
node test/e2e/round4-tester-make.mjs >/dev/null 2>&1
node test/e2e/round7-tester-make.mjs >/dev/null 2>&1
node test/e2e/round8-tester-assets.mjs >/dev/null 2>&1
node test/e2e/round8-tester-gap-assets.mjs >/dev/null 2>&1
node test/e2e/round9-tester-assets.mjs >/dev/null 2>&1
run() {
  local label="$1"; shift
  local out
  out=$(timeout 1500 "$@" 2>&1); local st=$?
  local pass fail
  pass=$(echo "$out" | grep -c '^PASS\|^ok \|PASS ')
  fail=$(echo "$out" | grep -c '^FAIL\|FAIL ')
  echo "[$label] exit $st, PASS lines $pass, FAIL lines $fail; last: $(echo "$out" | tail -1 | cut -c1-160)"
  echo "$out" > "test-artifacts/round-10/regress-$(echo "$label" | tr ' /' '__').log"
}
run "round4" node test/e2e/round4.cjs
run "round5 all SE" node test/e2e/round5.cjs all SE
run "round6 real" node test/e2e/round6.cjs real
run "round6 audio" node test/e2e/round6.cjs audio
run "round6 height" node test/e2e/round6.cjs height
run "round7-panel" node test/e2e/round7-panel.cjs
for d in 360 SE 13; do run "round7 flow $d" node test/e2e/round7.cjs flow $d; done
run "round7-tester-a" node test/e2e/round7-tester-a.cjs all
run "round7-tester-core" node test/e2e/round7-tester-core.mjs
run "round7-tester-engine" node test/e2e/round7-tester-engine.mjs all
run "round7-tester-robust-app" node test/e2e/round7-tester-robust-app.cjs
run "round7-tester-app cancel" node test/e2e/round7-tester-app.cjs cancel SE
run "round7-tester-app persist" node test/e2e/round7-tester-app.cjs persist SE
run "round7-tester-app synth" node test/e2e/round7-tester-app.cjs synth SE
run "round6-tester-browser" node test/e2e/round6-tester-browser.cjs all
run "round6-tester-fuzz" node test/e2e/round6-tester-fuzz.mjs
run "round5-tester-core" node test/e2e/round5-tester-core.mjs
run "round5-tester-browser" node test/e2e/round5-tester-browser.cjs
run "round5-tester-text" node test/e2e/round5-tester-text.cjs SE
for d in 360 SE 13; do run "round8 all $d" node test/e2e/round8.cjs all $d; done
run "round8-long" node test/e2e/round8-long.mjs
run "round8-tester-a" node test/e2e/round8-tester-a.mjs
run "round8-tester-b2" node test/e2e/round8-tester-b2.mjs
run "round8-tester-c" node test/e2e/round8-tester-c.mjs
run "round8-tester-c-app audio" node test/e2e/round8-tester-c-app.cjs audio SE
run "round8-tester-c-app bpm" node test/e2e/round8-tester-c-app.cjs bpm SE
run "round8-tester-gap-app" node test/e2e/round8-tester-gap-app.cjs SE
run "round8-tester-updated" node test/e2e/round8-tester-updated.mjs
for m in correct disabled panel; do run "round8-tester-app $m" node test/e2e/round8-tester-app.cjs $m SE; done
for d in 320 360; do run "round8-tester-app sync $d" node test/e2e/round8-tester-app.cjs sync $d; done
run "round8-tester-user SE" node test/e2e/round8-tester-user.cjs SE
run "round9-decode-check" node test/e2e/round9-decode-check.cjs
for m in cut gap noise lock texts corr; do run "round9 $m SE" node test/e2e/round9.cjs $m SE; done
run "round9-tester-engine" node test/e2e/round9-tester-engine.mjs all
for m in gap gap2 skip persist sync forced lock variants badfile corr; do run "round9-tester-app $m" node test/e2e/round9-tester-app.cjs $m SE; done
run "round9-tester-decode" node test/e2e/round9-tester-decode.cjs
run "round9-tester-user SE" node test/e2e/round9-tester-user.cjs SE
run "round10 all SE" node test/e2e/round10.cjs all SE
echo done
