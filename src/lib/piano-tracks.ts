/**
 * Built-in relaxation tracks — original, royalty-free music generated live in
 * the browser with the Web Audio API (no audio files to download, works
 * offline, zero licensing issues).
 *
 * Styles: soft piano loops, amapiano-style log-drum grooves and mellow lofi —
 * the kind of calm background music for while the robot trades. Press a track
 * in Settings → Music (page or drawer) and it plays instantly; press again to
 * pause.
 *
 * For real artist songs (Chris Brown etc.), use "Upload music from phone"
 * or paste a Spotify playlist link — those stay fully supported alongside.
 */

export type BuiltinStyle = "piano" | "amapiano" | "lofi";

export type BuiltinTrack = {
  id: string;
  name: string;
  /** Credit line shown under the title, like the artist on a playlist. */
  artist: string;
  /** Track length shown in the playlist, like "2:44". */
  duration?: string;
  /** Shows the explicit "E" badge like streaming apps. */
  explicit?: boolean;
  mood: string;
  style: BuiltinStyle;
  bpm: number;
  /** Chord progression — one chord (midi notes) per bar, loops. */
  chords: number[][];
  /** Bass root per bar (midi). */
  bass: number[];
};

const Cmaj = [48, 52, 55];
const Amin = [45, 48, 52];
const Fmaj = [41, 45, 48];
const Gmaj = [43, 47, 50];
const Dmin = [38, 41, 45];
const Emin = [40, 43, 47];
const Amin7 = [45, 52, 55, 60];
const Fmaj7 = [41, 48, 52, 57];
const Cmaj7 = [48, 55, 59, 64];
const Gmaj7 = [43, 50, 54, 59];
const Dmin7 = [38, 45, 48, 53];
const Gm7 = [43, 46, 50, 53];
const Bbmaj7 = [46, 50, 53, 57];
const Am7 = [45, 48, 52, 55];
const Em7 = [40, 47, 50, 54];
const Gmaj9 = [43, 50, 54, 59];
const Cm7 = [48, 51, 55, 58];
const Fm7 = [41, 48, 51, 55];

export const BUILTIN_TRACKS: BuiltinTrack[] = [
  {
    id: "piano-sunrise",
    name: "Piano Sunrise",
    artist: "EA Keys",
    mood: "Soft · Uplifting",
    style: "piano",
    bpm: 76,
    chords: [Cmaj, Gmaj, Amin, Fmaj],
    bass: [36, 43, 45, 41],
  },
  {
    id: "amapiano-sunset",
    name: "Amapiano Sunset",
    artist: "Log Drum Collective",
    mood: "Log drum · Groove",
    style: "amapiano",
    bpm: 112,
    chords: [Amin7, Fmaj7, Cmaj7, Gmaj7],
    bass: [33, 29, 36, 31],
  },
  {
    id: "log-drum-nights",
    name: "Log Drum Nights",
    artist: "Amapiano Sessions",
    mood: "Deep · Amapiano",
    style: "amapiano",
    bpm: 114,
    chords: [
      [40, 47, 51, 55],
      [41, 48, 52, 55],
      [43, 50, 53, 57],
      [38, 45, 48, 52],
    ],
    bass: [28, 29, 31, 26],
  },
  {
    id: "rainy-keys",
    name: "Rainy Keys",
    artist: "Soft Piano",
    mood: "Calm · Rainy",
    style: "piano",
    bpm: 68,
    chords: [Amin, Fmaj, Cmaj, Gmaj],
    bass: [33, 29, 36, 31],
  },
  {
    id: "gospel-morning",
    name: "Gospel Morning",
    artist: "Gospel Keys",
    mood: "Warm · Soulful",
    style: "piano",
    bpm: 72,
    chords: [
      [41, 48, 52, 57],
      [45, 52, 57, 60],
      [43, 50, 55, 59],
      [48, 55, 60, 64],
    ],
    bass: [29, 33, 31, 36],
  },
  {
    id: "deep-focus",
    name: "Deep Focus",
    artist: "Lofi Study",
    mood: "Lofi · Mellow",
    style: "lofi",
    bpm: 82,
    chords: [Dmin, Amin, Fmaj, Gmaj],
    bass: [26, 33, 29, 31],
  },
  {
    id: "sunday-chill",
    name: "Sunday Chill",
    artist: "Lofi Sessions",
    mood: "Lofi · Smooth",
    style: "lofi",
    bpm: 86,
    chords: [Fmaj7, Cmaj7, Amin7, Gmaj7],
    bass: [29, 36, 33, 31],
  },
  {
    id: "trade-calm",
    name: "Trade Calm",
    artist: "EA Keys",
    mood: "Ambient · Focus",
    style: "piano",
    bpm: 64,
    chords: [Cmaj7, Amin7, Fmaj7, Gmaj7],
    bass: [36, 33, 29, 31],
  },
  {
    id: "midnight-amapiano",
    name: "Midnight Amapiano",
    artist: "Log Drum Collective",
    mood: "Deep · Night drive",
    style: "amapiano",
    bpm: 110,
    chords: [Dmin7, Gm7, Bbmaj7, Am7],
    bass: [26, 31, 34, 33],
  },
  {
    id: "pretoria-nights",
    name: "Pretoria Nights",
    artist: "Amapiano Nights",
    mood: "Township · Groove",
    style: "amapiano",
    bpm: 116,
    chords: [Em7, Gmaj9, Am7, Fmaj7],
    bass: [28, 31, 33, 29],
  },
  {
    id: "golden-hour-keys",
    name: "Golden Hour Keys",
    artist: "Piano Sessions",
    mood: "Warm · Golden",
    style: "piano",
    bpm: 72,
    chords: [Fmaj7, Gmaj7, Em7, Amin7],
    bass: [29, 31, 28, 33],
  },
  {
    id: "soweto-groove",
    name: "Soweto Groove",
    artist: "Township Sound",
    mood: "Amapiano · Dance",
    style: "amapiano",
    bpm: 118,
    chords: [Cm7, Fm7, Gm7, Bbmaj7],
    bass: [36, 29, 31, 34],
  },
  {
    id: "rain-on-glass",
    name: "Rain on Glass",
    artist: "Lofi Rain",
    mood: "Lofi · Cozy",
    style: "lofi",
    bpm: 78,
    chords: [Dmin, Gmaj9, Cmaj7, Am7],
    bass: [26, 31, 36, 33],
  },
  {
    id: "sunday-worship",
    name: "Sunday Worship",
    artist: "Gospel Organ",
    mood: "Worship · Gentle",
    style: "piano",
    bpm: 66,
    chords: [
      [48, 52, 55, 59],
      [45, 52, 55, 60],
      [41, 48, 52, 57],
      [43, 47, 50, 55],
    ],
    bass: [36, 33, 29, 31],
  },
  {
    id: "deep-house-breeze",
    name: "Deep House Breeze",
    artist: "Deep House",
    mood: "House · Smooth",
    style: "lofi",
    bpm: 92,
    chords: [Am7, Gmaj7, Fmaj7, Em7],
    bass: [33, 31, 29, 28],
  },
  {
    id: "focus-flow",
    name: "Focus Flow",
    artist: "Study Beats",
    mood: "Lofi · Study",
    style: "lofi",
    bpm: 84,
    chords: [Em7, Am7, Gmaj7, Dmin7],
    bass: [28, 33, 31, 26],
  },

  /* ---- Songs playlist (generated renditions of the requested songs) ---- */

  {
    id: "song-3am-in-paris",
    name: "3 AM In Paris",
    artist: "MPM Beats",
    duration: "2:44",
    mood: "Lofi · Late night",
    style: "lofi",
    bpm: 84,
    chords: [Fmaj7, Em7, Dmin7, Gm7],
    bass: [29, 28, 26, 31],
  },
  {
    id: "song-insonamia",
    name: "INSONAMIA - Slowed",
    artist: "Ronald Figo",
    duration: "3:23",
    mood: "Slowed · Sleepy",
    style: "lofi",
    bpm: 70,
    chords: [Am7, Fmaj7, Cmaj7, Em7],
    bass: [33, 29, 36, 28],
  },
  {
    id: "song-marcus",
    name: "Marcus",
    artist: "SEVER",
    duration: "1:38",
    mood: "Dark · Wave",
    style: "lofi",
    bpm: 76,
    chords: [Dmin7, Bbmaj7, Gm7, Am7],
    bass: [26, 34, 31, 33],
  },
  {
    id: "song-snowfall",
    name: "snowfall",
    artist: "Øneheart, reidenshi",
    duration: "2:04",
    mood: "Ambient · Dreamy",
    style: "piano",
    bpm: 60,
    chords: [Cmaj7, Em7, Fmaj7, Am7],
    bass: [36, 28, 29, 33],
  },
  {
    id: "song-champs",
    name: "Champs",
    artist: "Galaxy",
    duration: "3:22",
    mood: "Lofi · Smooth",
    style: "lofi",
    bpm: 80,
    chords: [Em7, Am7, Dmin7, Gmaj7],
    bass: [28, 33, 26, 31],
  },
  {
    id: "song-frank-saint",
    name: "Frank Saint - Slowed",
    artist: "core²",
    duration: "2:06",
    explicit: true,
    mood: "Slowed · Gqom-ish",
    style: "amapiano",
    bpm: 100,
    chords: [Gm7, Cm7, Fm7, Bbmaj7],
    bass: [31, 36, 29, 34],
  },
  {
    id: "song-chances",
    name: "CHANCES",
    artist: "Trabbey",
    duration: "3:06",
    mood: "Amapiano · Groove",
    style: "amapiano",
    bpm: 112,
    chords: [Am7, Fmaj7, Cmaj7, Gmaj7],
    bass: [33, 29, 36, 31],
  },
  {
    id: "song-mystery",
    name: "Mystery",
    artist: "ADTurnUp, neiren!",
    duration: "3:04",
    mood: "Amapiano · Night",
    style: "amapiano",
    bpm: 110,
    chords: [Dmin7, Gm7, Am7, Bbmaj7],
    bass: [26, 31, 33, 34],
  },
  {
    id: "song-missing-pieces",
    name: "Missing Pieces",
    artist: "Flawed Mangoes",
    duration: "3:21",
    mood: "Emotional · Piano",
    style: "piano",
    bpm: 66,
    chords: [Amin, Fmaj, Cmaj, Gmaj],
    bass: [33, 29, 36, 31],
  },
  {
    id: "song-win-again",
    name: "win again (slowed)",
    artist: "trucky",
    duration: "1:19",
    mood: "Slowed · Motivation",
    style: "lofi",
    bpm: 72,
    chords: [Cm7, Fm7, Bbmaj7, Gm7],
    bass: [36, 29, 34, 31],
  },
  {
    id: "song-vengeance",
    name: "Vengeance",
    artist: "iwilldiehere",
    duration: "2:14",
    mood: "Phonk · Dark",
    style: "lofi",
    bpm: 76,
    chords: [Em7, Cmaj7, Am7, Fmaj7],
    bass: [28, 36, 33, 29],
  },
  {
    id: "song-baiana",
    name: "Baianá (Afro Remix)",
    artist: "WISEKIDS",
    duration: "3:01",
    mood: "Afro · Dance",
    style: "amapiano",
    bpm: 118,
    chords: [Cm7, Fm7, Gm7, Bbmaj7],
    bass: [36, 29, 31, 34],
  },
  {
    id: "song-home-super-slowed",
    name: "home (Super Slowed)",
    artist: ".diedlonely, Jay Karin",
    duration: "1:25",
    mood: "Super slowed · Warm",
    style: "piano",
    bpm: 58,
    chords: [Cmaj, Gmaj, Amin, Fmaj],
    bass: [36, 43, 45, 41],
  },
  {
    id: "song-biting-bullets",
    name: "biting bullets",
    artist: "ridgeclub",
    duration: "2:29",
    mood: "Lofi · Brooding",
    style: "lofi",
    bpm: 80,
    chords: [Am7, Dmin7, Gmaj7, Cmaj7],
    bass: [33, 26, 31, 36],
  },
  {
    id: "song-its-you",
    name: "It's You (feat. Miss P)",
    artist: "Black Motion",
    duration: "8:28",
    mood: "Afro house · Soulful",
    style: "amapiano",
    bpm: 122,
    chords: [Fmaj7, Gmaj7, Em7, Am7],
    bass: [29, 31, 28, 33],
  },
  {
    id: "song-do-i-clench",
    name: "do i clench my fists? (slowed + reverb)",
    artist: "ridgeclub",
    duration: "2:52",
    mood: "Slowed · Reverb",
    style: "piano",
    bpm: 64,
    chords: [Amin7, Fmaj7, Cmaj7, Gmaj7],
    bass: [33, 29, 36, 31],
  },
  {
    id: "song-leanin",
    name: "Leanin (Slowed)",
    artist: "CorMill",
    duration: "2:24",
    mood: "Slowed · Drive",
    style: "lofi",
    bpm: 70,
    chords: [Dmin7, Gm7, Cmaj7, Fmaj7],
    bass: [26, 31, 36, 29],
  },
];

/* ------------------------------------------------------------------ */
/* Synth engine                                                        */
/* ------------------------------------------------------------------ */

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let schedulerTimer: number | null = null;
let currentTrack: BuiltinTrack | null = null;
let currentBar = 0;
let nextBarTime = 0;

function ensureContext(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Soft piano-like voice: detuned triangles with a pluck envelope. */
function pluck(time: number, midi: number, duration: number, gain = 0.16) {
  const context = ensureContext();
  if (!master) return;
  const freq = midiToHz(midi);
  const env = context.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2200;
  env.connect(filter).connect(master);
  for (const detune of [-4, 4]) {
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(env);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }
}

/** Warm pad layer under the chords. */
function pad(time: number, chord: number[], duration: number) {
  const context = ensureContext();
  if (!master) return;
  const env = context.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(0.05, time + duration * 0.35);
  env.gain.linearRampToValueAtTime(0.0001, time + duration);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  env.connect(filter).connect(master);
  for (const midi of chord) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiToHz(midi + 12);
    osc.connect(env);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }
}

/** Bass note — pure sine. */
function bassNote(time: number, midi: number, duration: number, gain = 0.22) {
  const context = ensureContext();
  if (!master) return;
  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.value = midiToHz(midi);
  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(env).connect(master);
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

/** Amapiano log drum — pitched-down sine thump, the genre's signature. */
function logDrum(time: number, midi: number) {
  const context = ensureContext();
  if (!master) return;
  const osc = context.createOscillator();
  osc.type = "sine";
  const startHz = midiToHz(midi + 12);
  osc.frequency.setValueAtTime(startHz, time);
  osc.frequency.exponentialRampToValueAtTime(startHz / 3, time + 0.22);
  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(0.5, time + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
  osc.connect(env).connect(master);
  osc.start(time);
  osc.stop(time + 0.35);
}

/** Short filtered-noise hit (shaker / hat). */
function shaker(time: number, gain = 0.06) {
  const context = ensureContext();
  if (!master) return;
  const length = Math.floor(context.sampleRate * 0.06);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1)
    data[index] = (Math.random() * 2 - 1) * (1 - index / length);
  const src = context.createBufferSource();
  src.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 7000;
  const env = context.createGain();
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(master);
  src.start(time);
}

/** Soft kick for lofi. */
function kick(time: number) {
  const context = ensureContext();
  if (!master) return;
  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  const env = context.createGain();
  env.gain.setValueAtTime(0.4, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
  osc.connect(env).connect(master);
  osc.start(time);
  osc.stop(time + 0.3);
}

const BEAT = (bpm: number) => 60 / bpm;

/** Schedules one bar of the current track at `time`. */
function scheduleBar(track: BuiltinTrack, bar: number, time: number) {
  const beat = BEAT(track.bpm);
  const barLength = beat * 4;
  const chord = track.chords[bar % track.chords.length] ?? track.chords[0] ?? Cmaj;
  const root = track.bass[bar % track.bass.length] ?? track.bass[0] ?? 36;

  pad(time, chord, barLength);

  if (track.style === "piano") {
    // Gentle broken-chord arpeggio on 8ths with a passing top note.
    chord.forEach((midi, index) => pluck(time + index * beat, midi + 12, beat * 1.8, 0.15));
    pluck(time + beat * 2.5, (chord.at(-1) ?? 60) + 24, beat * 1.2, 0.1);
    pluck(time + beat * 3, chord[1] ? chord[1] + 12 : 60, beat, 0.09);
    bassNote(time, root, beat * 3.6, 0.16);
  } else if (track.style === "amapiano") {
    // Off-beat chord stabs + signature log-drum pattern + shakers.
    const stab = (offset: number, index: number) =>
      pluck(time + beat * offset, (chord[index] ?? chord[0] ?? 48) + 12, beat * 0.7, 0.13);
    stab(0.5, 0);
    stab(1.5, 1);
    stab(2.5, 2);
    pluck(time + beat * 3.5, (chord[0] ?? 48) + 24, beat * 0.6, 0.1);
    // Log drum syncopation: 0, 1.75, 2.5, 3.25 beats.
    logDrum(time, root);
    logDrum(time + beat * 1.75, root + 3);
    logDrum(time + beat * 2.5, root);
    logDrum(time + beat * 3.25, root - 2);
    shaker(time + beat * 0.5);
    shaker(time + beat * 1.5);
    shaker(time + beat * 2.5);
    shaker(time + beat * 3.5);
    bassNote(time + beat * 2, root - 12, beat * 1.4, 0.18);
  } else {
    // Lofi: soft chord on the 1, lazy kick/hat, sleepy bass.
    chord.forEach((midi) => pluck(time, midi + 12, beat * 3.2, 0.11));
    kick(time);
    kick(time + beat * 2.5);
    shaker(time + beat * 1, 0.045);
    shaker(time + beat * 3, 0.045);
    bassNote(time, root, beat * 3.8, 0.2);
  }
}

function scheduler() {
  const context = ensureContext();
  if (!currentTrack || !ctx) return;
  const beat = BEAT(currentTrack.bpm);
  const barLength = beat * 4;
  // Keep ~0.4s of music scheduled ahead of the playhead.
  while (nextBarTime < context.currentTime + 0.4) {
    scheduleBar(currentTrack, currentBar, Math.max(nextBarTime, context.currentTime + 0.05));
    currentBar = (currentBar + 1) % currentTrack.chords.length;
    nextBarTime += barLength;
  }
}

export function playBuiltinTrack(id: string, volume: number) {
  const track = BUILTIN_TRACKS.find((item) => item.id === id);
  if (!track) return;
  const context = ensureContext();
  stopBuiltinTrack();
  currentTrack = track;
  currentBar = 0;
  nextBarTime = context.currentTime + 0.08;
  setBuiltinVolume(volume);
  scheduler();
  schedulerTimer = window.setInterval(scheduler, 120);
}

export function stopBuiltinTrack() {
  if (schedulerTimer !== null) {
    window.clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  currentTrack = null;
}

export function setBuiltinVolume(volume: number) {
  const context = ensureContext();
  if (!master) {
    // Context may not exist yet when only pre-setting volume — create it.
    ensureContext();
  }
  master?.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), context.currentTime, 0.05);
}

export function isBuiltinPlaying(): boolean {
  return currentTrack !== null;
}

/** Id of the track currently loaded in the synth engine (null when stopped). */
export function currentBuiltinTrackId(): string | null {
  return currentTrack?.id ?? null;
}
