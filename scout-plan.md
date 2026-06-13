# SCOUT Feature — VLM-Assisted Hero Shot Discovery

## Context

The current LOCK screen asks the user to manually frame the hero shot by eye. For the demo this is weak — the VLM doesn't participate until the MOVE loop, so there's no wow moment in the setup. Adding a live SCOUT loop to the LOCK screen makes the VLM actively guide the user to a good shot *before* they lock it. The demo arc becomes: **type intent → sweep room while VLM coaches you toward a great Wes Anderson frame → lock → dolly in**. This makes the T3 flex (director-style world knowledge) visible from the very first second.

## Approach

Add a toggle on the Setup screen so users can opt into SCOUT mode before starting. If enabled, the existing `screen-lock` screen gains a live composition score bar and coaching cue; if disabled it behaves as before (manual frame-by-eye, no VLM on the lock screen). When the score is high enough the Lock button pulses to invite the tap.

## Changes

### 1. `index.html` — Setup screen toggle

Add a toggle row to `screen-setup`, below the textarea card and above the Start button:

```html
<div class="toggle-row" id="scout-toggle-row" style="position:relative;z-index:2;
  display:flex;align-items:center;gap:12px;width:100%;max-width:420px;">
  <label class="toggle-switch">
    <input type="checkbox" id="scout-toggle">
    <span class="toggle-thumb"></span>
  </label>
  <span style="font-size:14px;color:var(--muted)">
    Scout for hero frame <span style="color:var(--accent);font-size:12px">(VLM guides framing)</span>
  </span>
</div>
```

Add CSS for the toggle switch — a standard pill/thumb pattern using `--accent` for the checked state.

### 2. `index.html` — upgrade `screen-lock` (conditional UI)

Add to the lock screen (below the existing intent badge, above the Lock button), hidden by default and only shown when scout mode is active:

```html
<div id="scout-hud" style="display:none; ...">
  <!-- score bar reusing .score-bar / .score-fill classes, id="bar-scout" -->
  <!-- cue text line, id="scout-cue" -->
</div>
```

Add a CSS pulse animation that activates via a `.pulse` class on `btn-lock` when score ≥ 0.75.

Keep the reticle SVG and back button unchanged.

### 3. `app.js` — scout mode flag + SCOUT loop

**New: `let scoutEnabled = false`** — read from the checkbox on btn-start click:
```js
scoutEnabled = document.getElementById("scout-toggle").checked;
```

**New: `buildScoutPrompt(intent)`**
```js
function buildScoutPrompt(intent) {
  const director = intent.director || "cinematic";
  return `${director} style. Score this frame for composition 0-1.
JSON only: {"score":0-1,"cue":"≤6 words"|null}
cue=null only if score>=0.8.`;
}
```

**New: `queryScout()`**
Single-frame call using `frame_index=-1` (latest frame):
```js
async function queryScout() {
  const url = `ovs://streams/${streamId}?frame_index=-1`;
  // POST /api/query with image_url + buildScoutPrompt(intent)
  // returns { score, cue, latency_ms }
}
```
Falls back to a slow-oscillating mock score if no stream.

**New: `runScoutLoop()` / `stopScoutLoop()`**
- Ticks every ~1500ms (user is sweeping slowly, not mid-move)
- Updates `#bar-scout` score bar and `#scout-cue` text on the lock screen
- Adds `.pulse` class to `btn-lock` when smoothed score ≥ 0.75
- Self-pacing await loop (same pattern as `runMoveLoop`)

**Modify: `btn-start` handler**
Read the checkbox into `scoutEnabled`. After `setupStream()`, show/hide `#scout-hud` based on the flag, then call `runScoutLoop()` only if `scoutEnabled` before `transition("lock")`.

**Modify: `btn-lock` handler**
Call `stopScoutLoop()` at the top, then proceed with existing frame-capture logic.

**Modify: `btn-back-to-setup` handler**
Call `stopScoutLoop()` before transition.

**Smoothing:** reuse `smoothPush` with a new `"scout"` key in `smoothBufs`.

### 3. No API changes needed
`/api/query` already proxies any body — scout uses the same endpoint with a simpler prompt and a single `image_url`.

## Key constants
```js
const SCOUT_INTERVAL_MS = 1500;
const SCOUT_LOCK_THRESHOLD = 0.75;  // pulse the Lock button above this
let scoutEnabled = false;           // set from checkbox on btn-start click
```

## Verification
**Scout OFF (default):**
1. Start app → type "Wes Anderson symmetric" → leave toggle off → tap Start
2. Lock screen appears — no score bar, no cue, Lock button does not pulse
3. Frame manually → tap Lock → transitions to HINT as before

**Scout ON:**
1. Start app → type "Wes Anderson symmetric" → enable toggle → tap Start
2. Lock screen appears — score bar and cue visible, updates every ~1.5s
3. Point at a poorly composed scene → low score, cue like "center subject"
4. Point at a symmetric centered scene → score rises, Lock button pulses
5. Tap Lock → scout loop stops, frame index captured, transitions to HINT
6. Complete MOVE → LAND as before
7. Back button from LOCK → scout loop stops cleanly, no dangling interval
