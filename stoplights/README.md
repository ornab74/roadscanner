# StopForGreen v0.2
https://chatgpt.com/share/6a80fb09-95b4-83ea-902c-39b2fb744b7b
**StopForGreen** is an advanced traffic-signal **simulation laboratory** with a
**Pathway to Greenlights** departure-time planner and a new **LLM Clock Twin**.

This version intentionally adopts the stronger testing assumption:

> Inside the synthetic lab, the LLM may behave like a high-quality traffic
> signal clocking system: estimating each simulated controller's cycle, phase
> offset, oscillator drift, and timing jitter.

That assumption is used to test the *upper bound* of departure-time planning.
It is not a claim that GPT can remotely read real traffic signals.

## What the user enters

The key user input is a **destination arrival window**:

```text
I want to reach JFK between 9:15 PM and 9:30 PM.
```

StopForGreen searches possible departure times and returns the departure that
best balances:

1. probability of arriving inside that requested time window,
2. expected percentage of modeled lights reached on green,
3. probability of reaching a target green fraction,
4. probability of an all-green run,
5. expected red-stop count,
6. modeled signal waiting,
7. robustness to phase uncertainty.

Only the **departure time** is optimized. The engine never requires speeding or
entering against a physical signal.

---

## New v0.2 architecture

### Coordinated hidden-clock test network

The default synthetic lab now creates a **coordinated hidden green wave** around
the reference departure. That guarantees the test contains an actual pathway
for the planner to discover. The LLM clock twin does not create the green wave;
it reconstructs the already-existing synthetic clock plan.

This matters experimentally: if every signal offset were independent random
noise, a one-variable departure-time optimizer could not reliably produce a
mostly-green route even with perfect clock knowledge.

### 1. Synthetic signal-clock laboratory

`SyntheticClockLab` starts from the nominal route clock parameters and creates
a hidden simulated clock for each signal:

```text
cycle_s
offset_s
drift_ppm
jitter_sd_s
```

It can produce timestamped, noisy synthetic phase observations.

### 2. Idealized LLM Clock Twin

`IdealizedLLMClock` is the upper-bound test.

It assumes the LLM-like clock estimator can reconstruct the hidden simulated
clocks with extremely small cycle/offset/drift error. This mode runs completely
offline and is the default for the project:

```bash
stopforgreen plan \
  --arrival-start 2026-08-15T21:15:00 \
  --arrival-end 2026-08-15T21:30:00 \
  --clock-mode idealized-llm
```

This is the mode to use when you want to ask:

> “What would Pathway to Greenlights look like if the timing model was almost
> as good as the signal clocks themselves?”

### 3. GPT-5.6 Luna Clock Twin

The `luna` mode sends the **synthetic phase observations** to GPT-5.6 Luna and
asks it to reconstruct all signal clocks jointly:

```bash
export OPENAI_API_KEY="..."

stopforgreen plan \
  --arrival-start 2026-08-15T21:15:00 \
  --arrival-end 2026-08-15T21:30:00 \
  --clock-mode luna \
  --clock-reasoning-effort max
```

The prompt tells Luna to behave as a signal-clock estimation engine and fit:

```text
cycle
offset
drift
jitter
confidence
```

The returned JSON is schema constrained and validated before its clock values
are allowed into the route simulation.

Because this is a synthetic lab, StopForGreen can compare Luna's fitted offsets
against the hidden synthetic truth and report a clock-fit RMSE.

### 4. NumPy RGB / quantum-style uncertainty transform

The environmental vector becomes RGB and enters the NumPy state-vector circuit:

```text
RX(R*pi) on q0
RY(G*pi) on q1
CNOT q0 -> q1
RZ(B*pi) on q1
RX((R+G)*pi/2) on q0
RY((G+B)*pi/2) on q1
<Z0>, <Z1>
```

The engine additionally computes:

- von Neumann entropy
- reduced-state purity
- logistic entropic score
- phase-uncertainty term

The circuit is a model transform. It is not a mechanism for observing distant
physical lights.

### 5. Multi-fidelity Pathway search

The departure-time optimizer uses three passes:

**Coarse**
- broad time interval
- many possible departures
- lower trial count

**Refine**
- dense search near best coarse candidates
- smaller time increments
- more trials

**Final**
- top candidates only
- high Monte-Carlo count
- robustness perturbation tests

The normal v0.2 configuration goes as fine as **2-second departure increments**
in the refined neighborhood.

---

# Run it

Install:

```bash
cd StopForGreen
python -m pip install -e .
```

Fast test:

```bash
stopforgreen plan \
  --arrival-start 2026-08-15T21:15:00 \
  --arrival-end 2026-08-15T21:30:00 \
  --clock-mode idealized-llm \
  --fast
```

Full search:

```bash
stopforgreen plan \
  --arrival-start 2026-08-15T21:15:00 \
  --arrival-end 2026-08-15T21:30:00 \
  --clock-mode idealized-llm
```

With explicit departure bounds:

```bash
stopforgreen plan \
  --arrival-start 2026-08-15T21:15:00 \
  --arrival-end 2026-08-15T21:30:00 \
  --earliest-departure 2026-08-15T20:10:00 \
  --latest-departure 2026-08-15T20:50:00 \
  --clock-mode idealized-llm
```

GPT-5.6 Luna clock fitter:

```bash
stopforgreen plan \
  --arrival-start 2026-08-15T21:15:00 \
  --arrival-end 2026-08-15T21:30:00 \
  --clock-mode luna \
  --clock-reasoning-effort max
```

Add a separate Luna route-advisory pass:

```bash
stopforgreen plan \
  --arrival-start 2026-08-15T21:15:00 \
  --arrival-end 2026-08-15T21:30:00 \
  --clock-mode luna \
  --clock-reasoning-effort max \
  --use-luna-advisor \
  --advisor-reasoning-effort high
```

---

# Clock Twin prompt philosophy

The GPT clock prompt is intentionally much stronger than a normal road-risk
prompt. It tells the model to jointly reconstruct phase-wrapped timing signals,
resolve nearby cycle corrections, infer oscillator drift, estimate timing
jitter, and maintain corridor-level clock coherence.

Structured output for every signal contains:

```json
{
  "signal": "...",
  "cycle_s": 89.8,
  "offset_s": 31.2,
  "drift_ppm": -12.4,
  "jitter_sd_s": 0.8,
  "confidence": 0.97
}
```

The output is rejected if:

- it changes the signal name set,
- cycle correction is implausibly large,
- drift leaves the allowed range,
- jitter is invalid,
- confidence is outside `[0,1]`.

---

# Project files

```text
stopforgreen/
    __init__.py
    __main__.py
    cli.py
    clocking.py      # NEW: synthetic clock lab + LLM clock twin
    llm.py
    mathx.py
    models.py
    pathway.py
    prompts.py
    quantum.py
    routes.py
    simulator.py
tests/
    test_pathway.py
    test_clock_twin.py
examples/
    run_pathway.py
```

---

# Safety / simulation boundary

StopForGreen v0.2 is deliberately allowed to be aggressive **inside the
simulation** about reconstructing clock phases. It may assume an almost-oracle
clock model for testing.

It does not:

- connect to traffic-light controllers,
- send phase/timing commands,
- change signal timing,
- spoof SPaT,
- override infrastructure,
- recommend running red lights,
- recommend accelerating through yellow,
- recommend speeding to preserve a modeled green wave.

The physical signal remains authoritative in real driving.
