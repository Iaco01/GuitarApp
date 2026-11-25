// Helpers to run the analysis as a generator: the heavy functions are written as `function*` that yield
// now and then, so the same code runs to completion in Node (runSteps) or in slices with an `await`
// between them in the browser (runStepsAsync), with identical results.

export function runSteps(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

export const CANCELLED = 'cancelled';

// Drives `gen`, giving the page back (`yieldFn`, default a macrotask) whenever more than `sliceMs` have
// passed since the last time; `shouldCancel()` is checked at every yield and rejects with Error('cancelled').
export async function runStepsAsync(gen, { sliceMs = 40, shouldCancel = null, now = () => Date.now(), yieldFn = () => new Promise((r) => setTimeout(r, 0)) } = {}) {
  let last = now();
  let r = gen.next();
  while (!r.done) {
    if (shouldCancel && shouldCancel()) throw new Error(CANCELLED);
    if (now() - last >= sliceMs) {
      await yieldFn();
      last = now();
      if (shouldCancel && shouldCancel()) throw new Error(CANCELLED);
    }
    r = gen.next();
  }
  return r.value;
}
