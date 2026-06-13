# Wes Anderson DP Coach — real-time cinematography coach (Overshoot AI build)

## Context

24-hour internship hiring project for **Overshoot AI** (YC W26), judged on **creativity** and on
showing off their distinctive edge: sub-200ms vision (speed), server-side temporal stream
indexing, and hosted **VLMs** (semantic/aesthetic judgment a CNN can't do).

This concept was vetted with a deliberate 3-filter test — every *headline* feature should pass:
- **T1 Speed** — is <200ms load-bearing (not just nice)?
- **T2 Temporal** — does the answer need *change across frames* (a verb), not a single still?
- **T3 VLM-irreplaceable** — would a YOLO/optical-flow/pose pipeline *fail*? (needs meaning,
  judgment, world-knowledge, or open vocabulary)

**The build:** a real-time cinematography coach — a **"DP in your ear."** You **type** the style and
shot you want ("Wes Anderson symmetric, slow dolly in"), tap to lock your target frame, then it
guides you live as you move the phone, correcting *mid-move* and confirming when you land the shot.
Director styles (Wes Anderson, Kubrick, Fincher…) are set **by name** — pure VLM world-knowledge.
(Input is **typed text**, not voice — keeps the open-vocab "any director by name" flex without
STT flakiness; voice input is a stretch.)

**Overshoot-fit (honest): T1 speed strong, T3 VLM strong, T2 temporal *medium* — accepted on
purpose.** Aesthetic judgment is the VLM's job (T3 — a CNN can't judge "Wes-Anderson-ness");
correcting *during* a 1–2s move needs <200ms (T1 — load-bearing). Temporal is a *supporting*
actor: the value is **fast aesthetic judgment in a live loop**, plus locking/comparing against an
indexed past frame — not deep motion-reasoning. This ~2.5-of-3 is a deliberate trade: speed is
Overshoot's #1 pillar, and "fast VLM judgment in a real-time loop" is a rare capability most APIs
can't do. (Earlier "sixth sense"/closing-detection was dropped — pure motion is optical-flow turf;
the static "is this frame composed?" coach was dropped — single-frame, not latency-critical. This
concept's headline, the **moving reveal**, fixes both.)

## Scope (locked)

- **BASE (build first) — the live shot coach:** the **hero is the moving REVEAL** — type the
  style + shot, point & **tap-lock** the target frame, then MOVE (coach the camera move *into* it,
  correcting mid-move) → LAND. Input is **typed text**; director-style by name. **COMPOSE is slimmed
  to a manual "frame + tap-lock" target-capture** — the live warmer/colder composition coaching is
  deferred to stretch (it's single-frame, the part weak on the speed thesis). The **MOVE loop is the
  whole show** and carries the speed thesis.
- **STRETCH (only after base works):** voice input (STT + intent parse); warmer/colder COMPOSE
  coaching; **live SCOUT** (annotate shot opportunities as you sweep the room); IMU smoothness
  fusion; extra director presets.

## The experience

**Hero = the moving reveal.** You don't *describe* the final shot in fine detail (you can't say "4%
more symmetric"). You **demonstrate** the target by framing it by eye and tapping **lock**, then
execute a move into it while the system coaches you. You set *intent* by typing; you set the
*target* by tap-lock. Suggesting *what* to shoot is the separate deferred mode (SCOUT).

- **Input = typed text** (set at setup, hands free) → light parse → configures the loop. Audio
  **output** stays: terse tones for the tight loop + sparse spoken cues.
- **Flow:** TYPE intent → frame & **TAP-LOCK** target → (start hint) **GO** → **MOVE** (live
  coaching) → **LAND**. A **Stop** button can abort anytime. (Full screen-by-screen below.)
- **Director style** (typed by name) feeds both the target's composition meaning and the move
  coaching: "Wes Anderson" = symmetric/centered + precise reveal; "Kubrick" = one-point + slow push.

**What you declare vs. what the system figures out:**

| You declare (typed / tap) | System figures out (during MOVE) |
|---|---|
| Style ("Wes Anderson symmetric") | Holding the style's composition *through* the move |
| Move type ("slow dolly in") | Reveal *timing* and *landing* crispness |
| Target frame (**tap-lock**) | Closeness of the current view to the locked target |

**Walkthrough — moving reveal (the whole product):**
> You type: "Wes Anderson symmetric, slow dolly in." → frame the *end* shot you want to push into,
> by eye → tap **lock** (snapshots the **target frame**) → step back to your start → **MOVE**: walk
> forward; live coaching *"keep level… ease right… you're revealing too early, slow down"* →
> **LAND**: *"almost… landed"* (chime; current frame matches the locked target).

You lock the *destination* first, then move *into* it — how filmmakers pre-visualize a dolly, and
it gives a crisp, verifiable payoff. (Stretch: add warmer/colder coaching to help you *find* the
target frame, and/or voice instead of typing.)

## UX flow (step by step)

What the user actually sees, screen by screen:

1. **Setup.** Live camera **preview** (local, free) + a text box: *"Describe your shot."* Type a move
   ("slow dolly in"), a director ("Wes Anderson"), or both. Director-only → a one-shot LLM call picks
   a fitting move + composition intent (not latency-critical; runs once).
2. **Lock the hero frame.** Prompt: *"Frame your hero shot and tap to lock."* Compose the final
   framing by eye → tap **Lock** → the current frame is captured as the **target**. (Overshoot
   publish begins here so the frame is indexed.)
3. **Start-position hint + Go.** A move-type rule-of-thumb appears (no VLM): dolly → *"back up until
   the subject looks comfortably small"*; pan → *"rotate away until your target leaves the frame"*;
   track → *"step to the side."* Move to your start, tap **Go**.
4. **MOVE — live coaching.** The inference loop runs; audio tones + sparse spoken cues guide the move
   (*"level… ease right… revealing too early, slow down"*). The **ms latency counter** is visible.
5. **LAND.** Current frame ≈ target → chime + *"landed"*; the loop stops. Offer **New shot**.

A **Stop** button is visible throughout steps 3–4: it aborts the shot, stops the loop, and
`DELETE`s the stream.

## Session lifecycle (where credit hygiene lives)

- **Preview is free** (getUserMedia) — runs from the setup screen; nothing bills while you type/compose.
- **Publish to Overshoot starts at Lock** (step 2, so the target frame is indexed); the **inference
  loop starts at Go** (step 4).
- A shot **ends at LAND** (loop stops on its own) or via **Stop** — both `DELETE` the stream so it
  doesn't keep billing the 300s idle window.
- **Multiple shots in a demo:** keep the *stream* alive between shots and renew the lease (~60s), but
  stop the *inference loop* at each LAND. Don't run an endless loop.

## Architecture / data flow

Same backbone as any Overshoot app: **the app never receives video frames.**

```
PHONE (web page) ──getUserMedia(480p)──WebRTC/LiveKit──▶ Overshoot stream ──▶ indexed
  LOCK → capture target frame ref (frame_index at tap; 0–1 cheap call)             │
  MOVE → video_url start_offset_ms=-1000 (+ locked target) ── the live loop ───────┤
          window: motion-aesthetics + closeness-to-target                          │
        ◀── small structured JSON ── → smoothed → spoken cue / tone ◀──────────────┘
```

- The continuous loop runs during **MOVE** (windowed query). **LOCK** is a one-off target-capture
  (store the frame ref at the tap); there's no live composition loop in the base.
- Temporal use: windowed `video_url` queries read the motion; the query also references the
  **locked past frame** to judge landing — temporal addressing of the indexed stream.
- **480p** publish: plenty for composition (layout, not fine detail) and keeps latency low.
- Secret handling: `ovs-` key lives only in a serverless function; the page gets short-lived
  LiveKit `{url, token}` + stream `id`.

## Live data transport

There are **two independent channels** running in parallel — don't conflate them:

```
            ┌──────────── continuous WebRTC (media uplink) ────────────┐
PHONE ──────┤ getUserMedia 480p → livekit-client publishTrack          ├──▶ Overshoot LiveKit SFU
 (browser)  └──────────────────────────────────────────────────────────┘        │ ingest + index
                                                                                  │  (frames live here)
            ┌──────────── HTTPS request/response (per tick poll) ───────┐         │
APP LOOP ───┤ POST /api/query → (Vercel fn, attaches ovs- key) →        ├────────▶┤ resolve ovs://
            │   /v1/chat/completions  { ovs://… reference, no pixels }   │         │  run VLM
            │ ◀── small JSON {composition…} ◀── HTTPS ◀──────────────────┤◀────────┘
            └───────────────────────────────────────────────────────────┘
```

1. **Video uplink — continuous push (WebRTC).** The phone publishes its 480p track once via
   `livekit-client` over WebRTC (SRTP/UDP, ICE/STUN/TURN for NAT traversal) to Overshoot's
   LiveKit SFU. One long-lived connection for the whole session. Overshoot ingests and
   frame-indexes server-side. **Frames are never re-sent per query.**
2. **Query/result — per-tick pull (HTTPS).** The loop sends a stateless `POST /v1/chat/completions`
   carrying only the `ovs://` *reference* (not pixels). Overshoot resolves it against the
   already-indexed buffer, runs the VLM, returns JSON. Sequential **await-then-fire** loop (not
   `setInterval`) so requests self-pace to latency and never overlap.

Notes:
- The two channels are decoupled: video flows up continuously; queries are cheap *reads* of what's
  already there. This is why queries stay tiny regardless of how much history they reference.
- **Proxy hop:** the key must stay server-side, so queries go `page → /api/query (serverless) →
  Overshoot`. That hop adds a little to the *user-perceived* round trip; the **inference TTFT** is
  what goes on the ms counter. Keep the proxy thin / deployed close; for a local demo run it on the
  same machine to shave latency.
- **v1 is REST** for queries (no WebSocket). The deprecated v0.2 SDK used WebSockets — ignore those
  patterns.

## Audio-out architecture

**Two audio channels**, matching the two interaction layers — plus optional haptics:

- **Channel A — Web Audio tones (continuous, the "feel").** Drives the tight COMPOSE/MOVE loop,
  updated every tick, never blocks:
  - `OscillatorNode` frequency ← composition score (pitch rises = "warmer", like a geiger counter)
  - `StereoPannerNode` ← direction to move (pan left = move left)
  - `GainNode` / pulse rate ← how far off (faster pulse = further)
  - distinct chime on **LAND**
- **Channel B — Web Speech TTS (discrete words).** Command responses and coaching phrases
  ("ease right", "revealing too early — slow down", "landed"). A spoken sentence takes ~1–2s, so
  it's **occasional punctuation, never in the tight loop.**
- **Channel C (optional) — haptics** (`navigator.vibrate`) for "locked" / "landed" confirmation.

Rules that keep it from feeling broken:
- The tight loop **never waits on speech** — tones carry the continuous signal; speech is sparse.
- **Debounce/queue speech**: fire only on state changes/events, not every tick (else stutter/backlog).
- **Smoothing + hysteresis** is applied to scores *before* audio (see Risks) so the tone doesn't
  jitter and speech doesn't flip-flop.
- **Mobile gotcha:** `AudioContext` and `SpeechSynthesis` need a user gesture to unlock — the
  **Start button doubles as the audio-unlock gesture.**

Pipeline: `result JSON → smoothing buffer → audio mapper → { A: update tone params each tick;
B: trigger speech on events }`.

## Credit-conserving build strategy

Credits are billed by **stream duration + inference**, so the goal is to spend ~0 until the very
end. The app already supports this because **Overshoot only supplies the judgment JSON** — camera,
UI, voice, and audio are all local (~70% of the app = free to build).

- **Provider switch** — put one function between the app and the API:
  ```js
  async function getVisionResult(frameRef, prompt) {
    if (MODE === "mock")  return cannedResult();        // free — tune the feel
    if (MODE === "still") return queryStillImage(...);  // cheap — validate the prompt
    return queryOvershoot(frameRef, prompt);            // live — integration + demo
  }
  ```
  Build on `mock`, validate on `still`, flip to `live` last.
- **Validate the riskiest assumption on stills, not a live loop.** Test the composition prompt as a
  handful of single-frame (`image_url`) calls on captured photos — pennies — before any streaming.
- **Publish smoke-test cheaply:** `create stream → GET /streams/{id}` (confirm frame count rising)
  `→ DELETE`, ~30s, **no inference**. Or point `livekit-client` at your own free LiveKit Cloud /
  local server for a **zero-Overshoot-cost** publish test, then swap in Overshoot's `url`/`token`.
- **Hygiene:** always `DELETE` streams when idle (don't let the 300s idle window bill); during dev
  prefer a **"fire one query" button** over a running loop; low fps + terse output; test on stills
  not windows; **log every response** to replay into the audio system offline without re-querying.

## Tech stack & repo layout

Single **Vercel** repo (free HTTPS — mandatory for mobile camera — + serverless functions + env
var for the key).

```
/api/stream.js     POST → create Overshoot stream → { id, url, token }
/api/renew.js      POST { id } → renew lease (confirm exact upstream path)
/api/query.js      proxy /chat/completions (keeps key server-side)
index.html         publisher + state machine + query loop + text input + audio engine
```

`livekit-client` via CDN (`https://esm.sh/livekit-client`); Web Speech API for **TTS output only**
(input is a plain text field); Web Audio for tones. No build step.

## Verified Overshoot API details (from docs, June 2026)

**Create stream** — `POST https://api.overshoot.ai/v1/streams`, `Authorization: Bearer ovs-…`,
body `{}`. Returns `{ id, state, publish:{ type:"livekit", url, token }, ttl_seconds:300 }`.

**Chat completions** — `POST /v1/chat/completions` (OpenAI-compatible). Reference stream moments
with the `ovs://streams/{id}?…` URI:
- Single frame → `image_url`, anchor `frame_index=-1` | `timestamp_ms` | `offset_ms` (neg = past).
- Window → `video_url`, `start_offset_ms` (+ optional `end_offset_ms`, `max_fps` default 1.0).
- `response_format` passes through for structured JSON.
- Fast-path models (sub-second TTFT): `Qwen/Qwen3.6-35B-A3B-FP8`, `Qwen/Qwen3.6-27B-FP8`,
  `google/gemma-4-26B-A4B-it`. Use a fast one for the loop.

**Lease** — `ttl_seconds: 300` (idle). Renew ~every 60s. ⚠️ Exact renew path unverified.

## Feasibility & risks (the honest stress-test)

- **Judging "Wes-Anderson-ness" at 480p — feasible IF decomposed.** Do **not** ask for a vague
  "Wes Anderson 0–100." Ask concrete sub-criteria via structured output: *subject horizontally
  centered? square-on/perpendicular? left-right symmetry? verticals level? palette match?* These
  are reliable for a VLM and directly drive coaching ("you're not centered — pan left").
- **Move-quality is the riskier beat — frame it as motion-*aesthetics*, not smoothness.** Fine
  smoothness/jitter is IMU/optical-flow turf, NOT the VLM's. The all-three sweet spot (T1+T2+T3) is
  the **aesthetics of the motion**: reveal *timing* ("revealing the symmetry too early — slow the
  push"), *landing* crispness ("overshot the symmetry — settle back left"), and holding composition
  *through* the move + **closeness to the locked target frame**. Ask the VLM those; don't ask it to
  score jitter. (Optional stretch: fuse phone IMU for the smoothness signal.)
- **Noisy frame-to-frame scores** → smooth over 2–3 ticks + hysteresis so audio is stable.
- **Latency budget** → keep structured output terse (also respects the per-stream token-rate
  limit); sub-200ms TTFT is what makes mid-move correction land in time.
- **Voice latency** lives only in the command/SCOUT layer, not the tight MOVE loop (tones/cues).
- **GO/NO-GO GATE (Phase 1):** before live streaming, fire the composition prompt on a few still
  photos and eyeball whether judgments are sane + stable. If not, fix the prompt before investing.

## Build phases (24h) — free work first, credits last

0. **Local shell (≈4h, free).** Vercel repo; `getUserMedia` 480p preview; **text input** + light
   parse; the TYPE→LOCK→MOVE→LAND state machine; the **audio engine** (Channels A/B) — all driven by
   the **`mock` provider** returning canned JSON. Tune the move-feedback feel + smoothing/hysteresis
   with zero API calls.
1. **Validate the prompt on stills (≈1h, cheap).** A few single-frame `image_url` calls on captured
   photos → confirm the decomposed composition/style judgment is sane + stable. **Go/no-go gate.**
2. **Publish smoke-test (≈1h, ~free).** `create → GET frames rising → DELETE` (or own LiveKit).
   Confirms the WebRTC uplink works without burning inference.
3. **LOCK target-capture (≈1h).** Tap-lock stores the target frame ref (0–1 cheap call). Manual
   framing; no live composition loop in the base.
4. **MOVE live (≈7h) — the hero, where most time goes.** Windowed query for motion-aesthetics
   (reveal timing / landing / holding composition) + closeness-to-target; live mid-move correction;
   LAND payoff; **ms latency counter**. Short throttled sessions, `DELETE` when done.
5. **Polish + demo (≈4h).** The one fast-loop pass; the arc (type → lock → reveal → land); dry runs;
   **record a backup video** (so the demo never depends on live credits/network).
6. **STRETCH.** Voice input; warmer/colder COMPOSE coaching; live SCOUT; IMU smoothness; more presets.

## Demo plan

The demo **is** the moving reveal. Type *"Wes Anderson symmetric, slow dolly in"* → frame & **tap-lock**
the target → step back → execute the dolly while it coaches live (*"level… you're revealing too
early, slow the push… settle left… landed"*). Show the **ms latency counter**. Flex open-vocab by
typing a second director style. **Hero moment = the live reveal** — the timing/landing correction
mid-move (the <200ms showcase).

## Open items to confirm

- Exact **Renew Stream Lease** path/method (only unverified endpoint).
- `response_format: json_schema` honored by the chosen fast model (fallback: strict-JSON prompt +
  `JSON.parse`).
- v1 **token-rate limit** number (bounds loop frequency → keep output terse).
- Confirm fast-path model id strings via `GET /v1/models` at runtime.

## Verification (end-to-end)

1. **Stream up:** `GET /v1/streams/{id}` shows rising frame count / non-zero fps.
2. **LOCK:** tap-lock captures a usable target frame ref; the style prompt was validated on stills
   (Phase 1).
3. **MOVE:** windowed query returns motion-aesthetics (reveal timing / landing / closeness);
   mid-move cue fires correctly.
4. **Latency:** per-tick round-trip measured and surfaced; target ≲200ms inference.
5. **The arc:** type → lock → reveal → land works repeatably on real scenes (≥4/5 attempts feel
   responsive and correct). This is the acceptance bar for the demo.
