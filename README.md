# Cinematography Coach

Real-time cinematography coaching app built on Overshoot AI. If you've ever wanted to learn how your favorite director/cinematographer films different shots, it's a slow and manual process of looking for an example shot, then figuring out yourself through trial-and-error of moving your camera around to see if you got what you wanted. So I built this tool that gives you live-time coaching. Describe what you're looking for, sweep the room until a good frame is spotted, lock it, then execute the camera move while it coaches you live.

## Flow

**Describe → Discover → Lock → Shoot → Land**

1. Describe what you're looking for ("find spots for a Wes Anderson symmetric shot")
2. Sweep the room — the VLM scores composition in real time and pulses the lock button when a strong frame is detected
3. Lock the target frame by eye
4. Describe the camera move ("slow dolly in")
5. Get into starting position with live scene-aware coaching
6. Execute the move — coaching cues fire mid-move until you land the shot

## Features

### Live move coaching

After locking your target frame, physically execute the camera move while the app tracks three scores in real time:

- **Landing** — how close the current frame is to your locked target
- **Composition** — whether the style/framing intent is being held through the move
- **Timing** — whether the reveal is paced correctly

Coaching cues fire mid-move ("ease right", "revealing too early — slow down") and the loop auto-stops when you land the shot.

### Start-position coaching

On the positioning screen before a move, the VLM looks at the live frame and gives scene-specific instructions on where to move to set up the shot — rather than generic rules.

### Director styles by name

Type any director name ("Wes Anderson", "Kubrick", "Fincher", "Wong Kar-Wai") and the app configures composition and move intent from VLM world-knowledge. No predefined mappings needed for new names.

### Audio feedback

Two parallel channels:

- **Tones** — continuous Web Audio oscillator. Pitch tracks composition score; pulse rate tracks distance from target. Immediate, never blocks.
- **Speech** — sparse spoken cues via Web Speech TTS. Debounced so it never stutters or backlogs.

Distinct chime plays on landing.

## Design decisions

### Lock the destination, move into it

You frame the _end_ shot first by eye and tap lock — this gives a concrete, verifiable target. Then you move _into_ it. This mirrors how filmmakers pre-visualize a dolly and gives a crisp payoff (the frame either matches or it doesn't).

### Frames never leave the server

The browser publishes video to Overshoot via WebRTC. Queries reference frames by `ovs://` URI — the VLM resolves them server-side against the indexed stream. No pixel data travels in query requests, which is why the inference loop can stay under 200ms.

### Sequential await-then-fire loop

The move loop uses `await` on each query then a short sleep rather than `setInterval`. Queries self-pace to latency and never overlap or queue up.

### Stream lifecycle discipline

The Overshoot stream is created at Lock (not before), deleted immediately on Stop/Land/Cancel, and kept alive with a keepalive ping every 120s against the 300s idle TTL. This keeps credit usage bounded to actual shooting time.

## Stack

- **Frontend** — vanilla JS ES modules, no build step
- **Hosting** — Vercel (free HTTPS required for mobile camera access)
- **Streaming** — Overshoot AI + LiveKit (`livekit-client` via CDN)
- **Inference** — Overshoot `/v1/chat/completions` (OpenAI-compatible), model `Qwen/Qwen3.6-27B-FP8`
- **Audio** — Web Audio API (tones) + Web Speech API (TTS)

## Limitations

- Did not build in temporal query features. For instance, wanting a whip pan (that is a very quick motion) is not something the tool can guide you with, since the main form of verifying a shot is complete is simply comparing the target frame with the current frame.
