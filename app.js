import { Room, LocalVideoTrack } from "https://esm.sh/livekit-client@2";

// ════════════════════════════════════════════════════════════════
//  VISION PROVIDER  (mock → live based on stream + target availability)
// ════════════════════════════════════════════════════════════════
const MOVE_MODEL = "Qwen/Qwen3.6-27B-FP8";

let _tick = 0;
function cannedResult() {
  _tick++;
  const t = _tick;
  const landing   = Math.min(0.95, (t / 20) * 0.9 + 0.05 + (Math.random() * 0.06 - 0.03));
  const comp      = 0.55 + Math.sin(t * 0.4) * 0.2 + (Math.random() * 0.08 - 0.04);
  const timing    = 0.6  + Math.cos(t * 0.3) * 0.15 + (Math.random() * 0.06 - 0.03);

  let cue = null;
  if (landing < 0.25)                      cue = "back up more";
  else if (comp < 0.45)                    cue = "adjust framing";
  else if (timing < 0.4)                   cue = "slow down — revealing too early";
  else if (landing > 0.75 && comp < 0.65)  cue = "ease right";
  else if (landing > 0.85)                 cue = "almost there…";

  return {
    landing: clamp(landing, 0, 1),
    composition: clamp(comp, 0, 1),
    timing: clamp(timing, 0, 1),
    cue,
    latency_ms: 60 + Math.floor(Math.random() * 90),
  };
}

function buildMovePrompt(intent) {
  return `Image1=target frame. Image2=live camera. Shot: "${intent || "cinematic"}".
JSON only: {"landing":0-1,"composition":0-1,"timing":0-1,"cue":"phrase"|null}
landing=how close live matches target, 1=match.
cue: speak like a DP coaching live — natural, varied, max 10 words. Acknowledge progress when improving. Vary phrasing each response. null only if landing>=0.85.`;
}

async function queryOvershoot(intent) {
  const targetUrl = `ovs://streams/${targetFrameRef.streamId}?frame_index=${targetFrameRef.frameIndex}`;
  // we are looking at the last 2 seconds of the stream with fps 2, so 4 frames in total
  const liveUrl   = `ovs://streams/${streamId}?start_offset_ms=-2000&max_fps=5`;

  const body = {
    model: MOVE_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: targetUrl } },  // Image 1: target
        { type: "video_url", video_url: { url: liveUrl } },    // Image 2: live window
        { type: "text",      text: buildMovePrompt(intent) },
      ],
    }],
    max_tokens: 120,
    response_format: { type: "json_object" },
  };

  const t0 = performance.now();
  const r  = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency_ms = Math.round(performance.now() - t0);

  if (!r.ok) throw new Error(`Query ${r.status}: ${await r.text()}`);

  const data    = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const clean   = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const parsed  = JSON.parse(clean);

  return {
    landing:     clamp(parsed.landing     ?? 0, 0, 1),
    composition: clamp(parsed.composition ?? 0, 0, 1),
    timing:      clamp(parsed.timing      ?? 0, 0, 1),
    cue:         parsed.cue || null,
    latency_ms,
  };
}

async function getVisionResult(intent) {
  // Use real inference when we have a live stream + a real locked frame index
  if (streamId && targetFrameRef?.frameIndex != null) {
    try {
      return await queryOvershoot(intent);
    } catch (e) {
      console.warn("Inference failed, using mock fallback:", e);
      return cannedResult();  // keep loop alive on transient errors
    }
  }
  // Mock fallback: no stream or no locked frame yet
  await new Promise(r => setTimeout(r, 60 + Math.random() * 120));
  return cannedResult();
}




// ════════════════════════════════════════════════════════════════
//  STATE MACHINE
// ════════════════════════════════════════════════════════════════
let state = "SETUP";
let intent = null;
let discoverIntent = null;
let targetFrameRef = null;
let moveStats = { ticks: 0, startTime: 0, totalLatency: 0 };

function transition(to) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`screen-${to.toLowerCase()}`).classList.add("active");
  state = to.toUpperCase();
  const showReticle = to === "lock" || to === "hint";
  document.getElementById("lock-reticle").style.display = showReticle ? "flex" : "none";
}


// ════════════════════════════════════════════════════════════════
//  OVERSHOOT STREAM  (Phase 3)
// ════════════════════════════════════════════════════════════════
let streamId       = null;
let livekitRoom    = null;
let keepaliveTimer = null;

async function setupStream() {
  try {
    const r = await fetch("/api/stream", { method: "POST" });
    const data = await r.json();
    if (data.mock) return; // no API key — stay in local/mock mode

    streamId = data.id;

    livekitRoom = new Room();
    await livekitRoom.connect(data.publish.url, data.publish.token);
    const mediaTrack = cameraStream.getVideoTracks()[0];
    const track = new LocalVideoTrack(mediaTrack);
    await livekitRoom.localParticipant.publishTrack(track);


    // Keepalive every 120s — resets TTL, returns fresh token
    keepaliveTimer = setInterval(async () => {
      if (!streamId) return;
      try {
        const kr = await fetch("/api/renew", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: streamId }),
        });
        if (kr.ok) {
          const kd = await kr.json();
          // Reconnect LiveKit with the fresh token if room dropped
          if (kd.token && livekitRoom?.state === "disconnected") {
            await livekitRoom.connect(data.publish.url, kd.token);
          }
        }
      } catch (e) { console.warn("Keepalive failed:", e); }
    }, 120_000);

  } catch (e) {
    console.warn("Stream setup failed — running in local mode:", e);
  }
}

async function deleteStream() {
  clearInterval(keepaliveTimer);
  keepaliveTimer = null;
  if (livekitRoom) { livekitRoom.disconnect(); livekitRoom = null; }
  if (streamId) {
    await fetch(`/api/stream-status?id=${streamId}`, { method: "DELETE" }).catch(() => {});
    streamId = null;
  }
}


// ════════════════════════════════════════════════════════════════
//  AUDIO ENGINE
// ════════════════════════════════════════════════════════════════
let audioCtx = null;
let osc = null, panner = null, gainNode = null;
let pulseInterval = null;
let speechBusy = false;
let lastSpokenCue = null;
let lastCueTime = 0;
const SPEECH_MIN_INTERVAL_MS = 2000;

function unlockAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();  // iOS often starts AudioContext suspended even inside a gesture handler
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;
  panner = audioCtx.createStereoPanner();
  osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 220;
  osc.connect(panner).connect(gainNode).connect(audioCtx.destination);
  osc.start();

  // Pre-warm SpeechSynthesis — iOS silences the very first utterance unless
  // a speak/cancel cycle happens synchronously inside a user gesture
  if (window.speechSynthesis) {
    const warm = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(warm);
    window.speechSynthesis.cancel();
  }
}

function startTone() {
  if (!audioCtx) return;
  gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
  gainNode.gain.setTargetAtTime(0.08, audioCtx.currentTime, 0.05);
}

function stopTone() {
  if (!audioCtx) return;
  gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
  gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.15);
}

function updateTone(landing, composition, pan = 0) {
  if (!audioCtx || !osc) return;
  osc.frequency.setTargetAtTime(180 + landing * 340, audioCtx.currentTime, 0.08);
  panner.pan.setTargetAtTime(clamp(pan, -1, 1), audioCtx.currentTime, 0.1);

  clearInterval(pulseInterval);
  const distance = 1 - landing;
  if (distance > 0.3) {
    const rate = 200 + (1 - distance) * 600;
    pulseInterval = setInterval(() => {
      if (!gainNode) return;
      gainNode.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.01);
      setTimeout(() => gainNode.gain.setTargetAtTime(0.02, audioCtx.currentTime, 0.04), 40);
    }, rate);
  }
}

function playLandChime() {
  if (!audioCtx) return;
  stopTone();
  clearInterval(pulseInterval);
  [0, 0.15, 0.3, 0.5].forEach((t, i) => {
    const freq = [523, 659, 784, 1047][i];
    const g = audioCtx.createGain();
    const o = audioCtx.createOscillator();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.4);
    o.connect(g).connect(audioCtx.destination);
    o.start(audioCtx.currentTime + t);
    o.stop(audioCtx.currentTime + t + 0.5);
  });
}

function speak(text) {
  if (!window.speechSynthesis) return;
  const now = Date.now();
  if (text === lastSpokenCue) return;
  if (now - lastCueTime < SPEECH_MIN_INTERVAL_MS) return;
  lastSpokenCue = text;
  lastCueTime = now;
  // Resume AudioContext if iOS suspended it mid-session
  if (audioCtx?.state === "suspended") audioCtx.resume();
  window.speechSynthesis.cancel();  // clear any stuck queue before speaking
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.1; utt.pitch = 1.0; utt.volume = 0.85;
  window.speechSynthesis.speak(utt);
}


// ════════════════════════════════════════════════════════════════
//  SMOOTHING BUFFER
// ════════════════════════════════════════════════════════════════
const SMOOTH_N = 3;
const smoothBufs = { landing: [], composition: [], timing: [], scout: [] };

function smoothPush(key, val) {
  smoothBufs[key].push(val);
  if (smoothBufs[key].length > SMOOTH_N) smoothBufs[key].shift();
  return smoothBufs[key].reduce((a, b) => a + b, 0) / smoothBufs[key].length;
}

function resetSmooth() {
  Object.keys(smoothBufs).forEach(k => (smoothBufs[k] = []));
}


// ════════════════════════════════════════════════════════════════
//  UI UPDATES
// ════════════════════════════════════════════════════════════════
function updateBars({ landing, composition, timing }) {
  document.getElementById("bar-landing").style.width     = (landing     * 100) + "%";
  document.getElementById("bar-composition").style.width = (composition * 100) + "%";
  document.getElementById("bar-timing").style.width      = (timing      * 100) + "%";
}

function updateCue(cue) {
  document.getElementById("cue-display").textContent = cue ?? "";
  if (cue) speak(cue);
}

function updateLatency(ms) {
  const el = document.getElementById("latency-badge");
  el.textContent = `${ms} ms`;
  el.style.color = ms < 200 ? "var(--green)" : ms < 350 ? "var(--accent)" : "var(--red)";
}


// ════════════════════════════════════════════════════════════════
//  CAMERA
// ════════════════════════════════════════════════════════════════
let cameraStream = null;

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 854 }, height: { ideal: 480 }, facingMode: { ideal: "environment" } },
      audio: false,
    });
    const v = document.getElementById("video");
    v.srcObject = cameraStream;
    await v.play();
    v.classList.add("live");
  } catch (e) {
    alert("Camera access denied. Please allow camera and reload.");
    throw e;
  }
}


// ════════════════════════════════════════════════════════════════
//  SCOUT LOOP
// ════════════════════════════════════════════════════════════════
const SCOUT_INTERVAL_MS = 500;
const SCOUT_LOCK_THRESHOLD = 0.75;
let scoutRunning = false;

function buildDiscoveryPrompt(intent) {
  return `Scene query: "${intent || "interesting cinematic composition"}". Scan this frame for shot opportunities.
JSON only: {"score":0-1,"cue":"phrase"|null}
score: opportunity richness (0=nothing useful, 1=great setup visible).
cue: speak like a DP spotting shots — point at specific items or angles, natural varied language, max 12 words. null if score>=0.8.`;
}

function buildScoutPrompt(intent) {
  return `Shot intent: "${intent || "cinematic"}". Score this frame 0-1 for how well it sets up this shot.
JSON only: {"score":0-1,"cue":"phrase"|null}
cue: speak like a DP guiding framing — natural, varied, max 10 words. Acknowledge when improving. Vary phrasing each response. null only if score>=0.8.`;
}

function buildPositionPrompt(intent) {
  return `Shot: "${intent || "cinematic"}". I'm getting into starting position before executing this move.
JSON only: {"cue":"phrase"}
cue: one instruction (max 10 words) on where to physically move to set up the start of this shot. Be specific to what you see in the frame.`;
}

async function queryScout() {
  if (!streamId) {
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 400));
    const t = Date.now() / 4000;
    const score = clamp(0.45 + Math.sin(t) * 0.3, 0, 1);
    return { score, cue: score < 0.6 ? "center the subject" : score < 0.75 ? "level the frame" : null };
  }

  const url = `ovs://streams/${streamId}?frame_index=-1`;
  const body = {
    model: MOVE_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url } },
        { type: "text", text: discoverIntent ? buildDiscoveryPrompt(discoverIntent) : buildScoutPrompt(intent) },
      ],
    }],
    max_tokens: 40,
    response_format: { type: "json_object" },
  };

  const r = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Scout query ${r.status}: ${await r.text()}`);

  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const clean = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(clean);
  return {
    score: clamp(parsed.score ?? 0, 0, 1),
    cue: parsed.cue || null,
  };
}

async function runScoutLoop() {
  scoutRunning = true;
  while (scoutRunning) {
    try {
      const raw = await queryScout();
      if (!scoutRunning) break;
      const score = smoothPush("scout", raw.score);
      document.getElementById("bar-scout").style.width = (score * 100) + "%";
      document.getElementById("scout-cue").textContent = raw.cue ?? "";
      if (raw.cue) speak(raw.cue);
      document.getElementById("btn-lock").classList.toggle("pulse", score >= SCOUT_LOCK_THRESHOLD);
    } catch (e) {
      console.warn("Scout query failed:", e);
    }
    await new Promise(r => setTimeout(r, SCOUT_INTERVAL_MS));
  }
}

function stopScoutLoop() {
  scoutRunning = false;
  window.speechSynthesis?.cancel();
  lastSpokenCue = null;
  document.getElementById("btn-lock").classList.remove("pulse");
  document.getElementById("scout-cue").textContent = "";
  document.getElementById("bar-scout").style.width = "0%";
}


// ════════════════════════════════════════════════════════════════
//  POSITION LOOP  (hint screen — live start-position coaching)
// ════════════════════════════════════════════════════════════════
let positionRunning = false;

async function runPositionLoop() {
  positionRunning = true;
  while (positionRunning) {
    try {
      const url = `ovs://streams/${streamId}?frame_index=-1`;
      const body = {
        model: MOVE_MODEL,
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url } },
          { type: "text", text: buildPositionPrompt(intent) },
        ]}],
        max_tokens: 40,
        response_format: { type: "json_object" },
      };
      const r = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Position query ${r.status}: ${await r.text()}`);
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      const clean = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (!positionRunning) break;
      if (parsed.cue) {
        document.getElementById("hint-text").textContent = parsed.cue;
        speak(parsed.cue);
      }
    } catch (e) {
      console.warn("Position query failed:", e);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

function stopPositionLoop() {
  positionRunning = false;
}

function enterHint() {
  document.getElementById("hint-text").textContent = "Get into your starting position.";
  transition("hint");
  if (streamId) runPositionLoop();
}


// ════════════════════════════════════════════════════════════════
//  MOVE LOOP
// ════════════════════════════════════════════════════════════════
const LAND_THRESHOLD = 0.88;
let loopRunning = false;

async function runMoveLoop() {
  loopRunning = true;
  _tick = 0;
  resetSmooth();
  moveStats = { ticks: 0, startTime: Date.now(), totalLatency: 0 };

  while (loopRunning) {
    const t0 = performance.now();
    const raw = await getVisionResult(intent);
    if (!loopRunning) break;

    const displayLatency = raw.latency_ms ?? Math.round(performance.now() - t0);
    updateLatency(displayLatency);
    moveStats.ticks++;
    moveStats.totalLatency += displayLatency;

    const smoothed = {
      landing:     smoothPush("landing",     raw.landing),
      composition: smoothPush("composition", raw.composition),
      timing:      smoothPush("timing",      raw.timing),
    };

    updateBars(smoothed);
    updateCue(raw.cue);
    updateTone(smoothed.landing, smoothed.composition, (raw.composition - 0.5) * -1.4);

    if (smoothed.landing >= LAND_THRESHOLD) {
      loopRunning = false;
      onLand(smoothed);
      return;
    }

  }
}

function stopMoveLoop() {
  loopRunning = false;
  stopTone();
  clearInterval(pulseInterval);
  window.speechSynthesis?.cancel();
  lastSpokenCue = null;
}

function onLand(smoothed) {
  stopTone();
  clearInterval(pulseInterval);
  playLandChime();
  speak("Landed.");

  const flash = document.getElementById("land-flash");
  flash.style.opacity = "1";
  setTimeout(() => (flash.style.opacity = "0"), 600);

  const elapsed = ((Date.now() - moveStats.startTime) / 1000).toFixed(1);
  const avgLat  = Math.round(moveStats.totalLatency / moveStats.ticks);
  document.getElementById("land-details").innerHTML =
    `Duration: <strong>${elapsed}s</strong><br>
     Ticks: <strong>${moveStats.ticks}</strong><br>
     Avg latency: <strong>${avgLat} ms</strong><br>
     Shot: <strong>${intent || "custom"}</strong>`;

  transition("land");
}


// ════════════════════════════════════════════════════════════════
//  EVENT WIRING
// ════════════════════════════════════════════════════════════════
const shotInput = document.getElementById("shot-input");

shotInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("btn-start").click(); }
});

// SETUP → LOCK
document.getElementById("btn-start").addEventListener("click", async () => {
  unlockAudio();
  discoverIntent = shotInput.value.trim() || "interesting cinematic shots";
  intent = discoverIntent;
  await startCamera();
  await setupStream();
  document.getElementById("scout-hud").style.display = "flex";
  runScoutLoop();
  transition("lock");
});

// LOCK → HINT  (captures real frame index if stream is live)
document.getElementById("btn-lock").addEventListener("click", async () => {
  stopScoutLoop();
  if (streamId) {
    try {
      const r = await fetch(`/api/stream-status?id=${streamId}`);
      const data = await r.json();
      targetFrameRef = {
        streamId,
        frameIndex: data.last_frame_index,
        lockedAt: Date.now(),
      };
    } catch (e) {
      console.warn("Frame capture failed, using timestamp fallback:", e);
      targetFrameRef = { streamId, frameIndex: null, lockedAt: Date.now() };
    }
  } else {
    targetFrameRef = { lockedAt: Date.now(), note: "mock_ref" };
  }

  document.getElementById("shot-move-input").value = "";
  transition("shot");
});

document.getElementById("btn-back-to-setup").addEventListener("click", () => {
  stopScoutLoop();
  transition("setup");
});

// SHOT QUERY (discover mode) → HINT
const shotMoveInput = document.getElementById("shot-move-input");
shotMoveInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("btn-confirm-shot").click(); }
});
document.getElementById("btn-confirm-shot").addEventListener("click", () => {
  const shotText = shotMoveInput.value.trim();
  intent = shotText || "slow dolly in";
  enterHint();
});
document.getElementById("btn-cancel-shot").addEventListener("click", async () => {
  stopMoveLoop();
  await deleteStream();
  discoverIntent = null;
  transition("setup");
});

// HINT → MOVE
document.getElementById("btn-go").addEventListener("click", () => {
  stopPositionLoop();
  transition("move");
  startTone();
  speak("Moving.");
  runMoveLoop();
});

// HINT cancel — abort + delete stream
document.getElementById("btn-cancel-hint").addEventListener("click", async () => {
  stopPositionLoop();
  await deleteStream();
  transition("setup");
});

// MOVE stop — abort + delete stream
document.getElementById("btn-stop").addEventListener("click", async () => {
  stopMoveLoop();
  await deleteStream();
  transition("setup");
  updateCue(null);
  updateBars({ landing: 0, composition: 0, timing: 0 });
});

// LAND → new shot
document.getElementById("btn-new-shot").addEventListener("click", () => {
  _tick = 0;
  discoverIntent = null;
  shotInput.value = "";
  updateBars({ landing: 0, composition: 0, timing: 0 });
  transition("setup");
});


// ════════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════════
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
