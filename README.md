

https://github.com/user-attachments/assets/645af15d-9fa7-4f82-9055-3d707161268d


# Cinematography Coach

Real-time cinematography coaching app built on [Overshoot AI](https://www.overshoot.ai/).
If you've ever wanted to learn how your favorite director/cinematographer films different shots, it's a slow and manual process of looking for an example shot, then figuring out through trial-and-error yourself. Moving your camera around to find a shot that has the vibe, and following tutorials on camera motion and many deleted clips to get what you want. So I built this tool that gives you live-time coaching. Describe what you're looking for: the director as your inspiration, what kind of camera movement, the feeling you want to evoke, anything. Then, using your phone camera, sweep the room to get guidance on spotting a good frame, lock it, then execute the camera movement while it coaches you live.

## How to use it

**Describe → Discover → Lock → Shoot → Land**

1. **Describe the hero shot** you're looking for ("find spots for a Wes Anderson symmetric shot", "find a subject I can do a low-angle shot of to make feel powerful")
2. **Sweep the room** — the VLM scores composition in real time and pulses the lock button when a strong frame is detected
3. **Lock** the hero/target frame based on what you like
4. Describe the **camera movement** ("slow dolly in")
5. Get into **starting position** with live coaching
6. **Execute the camera movement** — coaching cues are displayed and spoken out mid-move until you land the shot

## Features

### Any director, movement, camera technique

Type any director name ("Wes Anderson", "Kubrick", "Fincher", "Wong Kar-Wai"), camera movement, or technique. The app suggests composition and move intent from VLM world-knowledge. No predefined mappings (initially did this thinking it would help manage scope, but realized this was completely unnecessary given VLMs' capabilities).

### Start-position coaching

On the positioning screen before a move, the VLM looks at the live frame and gives scene-specific instructions on where to move to set up for the camera movement you specified (e.g. if you want "pan down", then you will be coached to "point and move camera up higher").

### Live move coaching

After locking your target frame, physically execute the camera move while the app tracks three scores in real time:

- **Landing** — how close the current frame is to your locked target
- **Composition** — whether the style/framing intent is being held through the move
- **Timing** — whether the reveal is paced correctly

Coaching cues are verbalized/displayed while moving ("ease right", "revealing too early — slow down") and the loop auto-stops when you land the shot.

### Audio feedback

Two parallel channels:

- **Tones** — continuous Web Audio oscillator. Pitch tracks composition score; pulse rate tracks distance from target. Immediate, never blocks.
- **Speech** — sparse spoken cues via Web Speech TTS. Debounced so it never stutters or backlogs.

Chime plays on landing.

## Overshoot's Capabilities

When thinking of a project idea, I knew I wanted to build something that would only be possible with Overshoot's capabilities, which I distilled to these 3:

- **Speed (necessary, not just nice).** Mid-movement correction only works if the feedback loop is faster than the move itself. If a dolly-in takes 3 seconds, a latency of >3s means that the cue for adjustment arrives after you're already done. The quick inference is what makes real-time coaching possible.

- **Ease of temporal reference.** Judging timing and pacing requires seeing motion (I address the realities of this in the [Limitations section](#limitations-and-what-i-would-add)), something a single frame can't tell you. By easily referencing the last window of time and a specific frame with Overshoot's API, it makes things much easier as a developer.

- **VLM-irreplaceable (a YOLO/optical-flow/pose pipeline would fail).** Composition quality, director style matching, and aesthetic judgment require world-knowledge and open vocabulary. No predefined model can score "Wes Anderson symmetry" and low-angle shot and whatever you want. Only a VLM with cinematography knowledge can interpret these descriptions and coach against them.

## Design decisions

### Lock the destination, move into it

You frame the _end_ shot first by eye and tap lock. This gives a concrete, verifiable target which you then move into. This mirrors how filmmakers pre-visualize a dolly (the frame either matches or it doesn't).
_Implementation:_ When a frame is chosen in the UI (click on Lock Target Frame button), we save the **frameIndex** of the current frame, which we reference as the hero/target frame using Overshoot's API in every query during the movement process.

### Frame window and FPS

For the movement judging, I settled on a **window of 2 seconds** for the sampling of frames, and **5 FPS**. The rationale is that most movements (dolly, pan, etc) are **not very fast movements**, and 2 seconds is long enough to understand how much has moved (i.e. a pan isn't so slow such that in 2 seconds there has barely been any movement, and also isn't so fast such that the entire movement is complete so live coaching can be provided). As for the decision on FPS, there was a tradeoff between cost & latency with better understanding of motion. Since these movements are also not very fast, we do not require too many frames, but having too little would mean the VLM thinks there is jerky movement when it might have been smooth. 5 FPS means frames are 200ms apart, enough for visible camera movement. The same outcome might have been obtained with a shorter window for sampling frames, but a much shorter window might mean that there is insufficient information on movement (e.g. only 2 units of movement in 500ms window, very minor movement), which is a waste of querying.

No window used for scout and finding starting position, because there is no need for understanding motion (maybe questionable on the finding starting position, say for a pan). I simply use the last seen frame. But to reduce unncessary queries and as a result higher costs, I added a **delay of 500ms for scout** and **1.5s for finding starting position**. 500ms is a good gap for enough things to change in frame as the user sweeps their camera around, and 1.5s is a good gap for physically moving to a new position (this of course doesn't necessarily hold true for all movements, like pans).

The chosen frame windows and FPS are of course tuned to a specific use case, namely no absurdly quick movements. Different frame windows and FPS would definitely need to be used, say if we want to assess and whip pan (a very very fast pan) where we would need much higher FPS, but then again at that point live-time coaching might not be feasible (the camera movement is too quick and too short).

### Sequential (await) not fixed interval (setInterval) querying

The move loop uses `await` on each query rather than `setInterval`. The rationale is that there will not be any **overlapping or out-of-order** responses (in the event a later query resolves more quickly than an earlier one), and we always use the **freshest frames** through _start_offset_ms_ when we make a query from the next available point in time. We could technically have pre-fired if I knew the exact latency (e.g. if latency was 500ms at average, could pre-fire every 400ms to experience lower latency), but this doesn't necessarily work if latency changes (e.g. change in network speed).

## Stack

- **Frontend** — vanilla JS ES modules, no build step
- **Hosting** — Vercel (free HTTPS required for mobile camera access)
- **Streaming** — Overshoot AI + LiveKit (`livekit-client` via CDN)
- **Inference** — Overshoot `/v1/chat/completions` (OpenAI-compatible), model `Qwen/Qwen3.6-27B-FP8`
- **Audio** — Web Audio API (tones) + Web Speech API (TTS)

## Limitations and what I would add

- Vibes-based temporal querying. There isn't really a native temporal dimension which the VLM understands. Rather, what is being reported as speed here is simply a comparison of the previous few frames with the newer frames. For instance, if the frames sent in the query show very little change in how the subject looks (how large the subject is in the frame), the VLM might suggest to speed up based on that lack of difference. If the query was for a "slow dolly" and the frames sent in show very large changes in how the frames look (how large the subject is), then the VLM might suggest to slow down. This is a speculation of what the VLM will return based on the limitations of VLMs I understand, I don't actually know for sure.
- "Getting the shot" is a very simple frame comparison of the selected hero/target frame and the latest frame. To make it provide better feedback, "getting a shot" should probably involve more than just the comparison, but also assessing if the speed was good enough based on what was asked for. Admittedly one surface-level problem is that I'm just passing the entire window of frames along with the hero/target and letting the VLM decide whether the frames in the window (hoping it picks out the last one) matches the hero/target frame. I probably could have just picked the last frame separately (_frame_index=1_) and tell the VLM to explicitly compare those 2, at the cost of a longer query.
- A display of the hero/target frame so that the user has an idea of where the camera movement ends.
- Actual integration into camera recording a video for users who shoot on their phone (i.e. trigger record on the phone's camera based on selections on the website). Not sure how this would actually be done.
