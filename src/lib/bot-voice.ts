/**
 * Bot Voice — the smooth male voice that welcomes the trader and reads live
 * trade announcements. In a browser it runs on SpeechSynthesis (on-device, no
 * network); inside the Android wrapper it routes to the NATIVE TextToSpeech
 * bridge, because the WebView's speechSynthesis is silent there. The toggle
 * in Settings → Back Animation → Bot Voice persists in localStorage; the app
 * announces through `speakBot` which no-ops when disabled or unsupported.
 */

import { callNative, hasNativeBridge, queryNative } from "@/lib/native-bridge";
import {
  EXECUTION_REPEAT_WINDOW_MS,
  executionSignature,
  formatLot,
  formatPrice,
  normalizeExecution,
  type NormalizedExecution,
} from "@/lib/execution-events";

const KEY = "botVoiceEnabled";
/** The voice level, 0…1 — applied to the browser engine and to native TTS. */
const VOLUME_KEY = "botVoiceVolume";

export function isBotVoiceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) !== "false"; // default ON
  } catch {
    return true;
  }
}

export function setBotVoiceEnabled(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/**
 * The voice level the trader picked, 0…1.
 *
 * On Android the native engine plays through the device's media stream, so
 * the phone's own volume keys remain the master control; this value is the
 * app-level trim on top of it. The browser engine has no such control, so
 * there it IS the level.
 */
export function getBotVoiceVolume(): number {
  if (typeof window === "undefined") return 1;
  try {
    const stored = window.localStorage.getItem(VOLUME_KEY);
    /**
     * NOT-SET IS FULL VOLUME.
     *
     * `Number(null)` is 0, and 0 is finite — so this used to return 0 for every
     * trader who had never touched the volume slider. speechSynthesis (and the
     * Android TTS bridge) then spoke every announcement at volume 0: the trade
     * notifications appeared, the voice stayed completely silent, and nothing
     * anywhere reported an error. An absent key means "the default", and the
     * default is 1.
     */
    if (stored === null || stored.trim() === "") return 1;
    const raw = Number(stored);
    if (!Number.isFinite(raw)) return 1;
    return Math.min(1, Math.max(0, raw));
  } catch {
    return 1;
  }
}

export function setBotVoiceVolume(value: number): void {
  if (typeof window === "undefined") return;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
  try {
    window.localStorage.setItem(VOLUME_KEY, String(clamped));
  } catch {
    /* ignore */
  }
}

let cachedMaleVoice: SpeechSynthesisVoice | null | undefined;

/** Prefers a male English voice; falls back to any English voice. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (cachedMaleVoice !== undefined) return cachedMaleVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // list not loaded yet — retry next call
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const maleHints = ["male", "daniel", "alex", "fred", "david", "google uk english male", "google us english"];
  cachedMaleVoice =
    english.find((voice) => maleHints.some((hint) => voice.name.toLowerCase().includes(hint))) ??
    english[0] ??
    voices[0] ??
    null;
  return cachedMaleVoice;
}

/**
 * Announce a phrase in the bot's smooth male voice — THE single speak
 * helper every announcement routes through (welcome, execution start, each
 * executed trade):
 *
 *   1. NATIVE ANDROID TTS FIRST: window.AndroidTTS when the wrapper injects
 *      it, otherwise the window.EAMigrate bridge the app actually ships.
 *      When either is present it owns speech completely — return without
 *      touching speechSynthesis, so nothing is ever spoken twice (the
 *      WebView's own speechSynthesis is silent on Android anyway). An older
 *      APK without speak() degrades to silence — never to the web path —
 *      and the updated APK carries the method.
 *   2. Otherwise: browser speechSynthesis (on-device, no network).
 *
 * No-op when the Bot Voice setting is off. No delays: the line is spoken at
 * the same moment the caller renders it.
 */
export function speakBot(text: string): void {
  if (typeof window === "undefined") return;
  if (!diagnosticsLogged) {
    diagnosticsLogged = true;
    console.info("[voice] path", voiceDiagnostics());
  }
  if (!isBotVoiceEnabled()) {
    // STEP 4 of the chain, logged: the setting itself is off. (Independent of
    // notifications — they keep working either way.)
    console.info("[voice] step 4 speakBot: skipped — botVoiceEnabled is false");
    return; // voice off → say nothing
  }
  const phrase = text.trim();
  if (!phrase) return;
  const volume = getBotVoiceVolume();
  console.info(`[voice] step 5 speakBot: speaking at volume ${volume} → "${phrase}"`);
  // 1. Native Android TTS — AndroidTTS (spec) or the injected EAMigrate bridge.
  const androidTts = (
    window as unknown as { AndroidTTS?: { speak?: (value: string) => void } }
  ).AndroidTTS;
  if (typeof androidTts?.speak === "function") {
    try {
      androidTts.speak(phrase);
    } catch {
      /* native engine unavailable — stay silent rather than double-speak */
    }
    return;
  }
  if (hasNativeBridge()) {
    // The level-aware method exists on the current wrapper; an older APK
    // falls back to plain speak() and the device's own media volume applies.
    if (!callNative("speakWithVolume", phrase, volume)) {
      callNative("speak", phrase);
    }
    return;
  }
  // 2. Browser fallback.
  if (!("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(phrase);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = 0.98;
    utterance.pitch = 0.85; // deeper, smooth male tone
    utterance.volume = volume;
    synth.speak(utterance);
  } catch {
    /* unsupported — silent */
  }
}

/**
 * ARM THE VOICE FROM A REAL USER TAP.
 *
 * A browser silently drops speechSynthesis before the page has had a gesture,
 * and the first announcement of a run (the welcome, the first fill) is exactly
 * the one that used to be swallowed. Inside the Android wrapper the native
 * engine is warmed instead — no gesture rule applies there, but priming makes
 * the first line immediate.
 *
 * Safe to call on every tap: it is idempotent and never speaks a word the
 * trader can hear.
 */
export function unlockBotVoice(): void {
  if (typeof window === "undefined") return;
  if (hasNativeBridge()) {
    callNative("primeVoice");
    return;
  }
  if (!("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.resume?.();
    if (synth.speaking || synth.pending) return;
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    synth.speak(primer);
    warmBotVoice();
  } catch {
    /* engine unavailable — the next real utterance still tries */
  }
}

/**
 * WHAT THE VOICE PATH ACTUALLY LOOKS LIKE RIGHT NOW — the answer to "why is it
 * silent?". Logged once on the first announcement and available to Settings.
 */
export type VoiceDiagnostics = {
  enabled: boolean;
  volume: number;
  nativeBridge: boolean;
  nativeEngineReady: boolean | null;
  speechSynthesis: boolean;
};

export function voiceDiagnostics(): VoiceDiagnostics {
  return {
    enabled: isBotVoiceEnabled(),
    volume: getBotVoiceVolume(),
    nativeBridge: hasNativeBridge(),
    nativeEngineReady: hasNativeBridge() ? Boolean(queryNative("isVoiceReady")) : null,
    speechSynthesis: typeof window !== "undefined" && "speechSynthesis" in window,
  };
}

let diagnosticsLogged = false;

/** Warm the voice list so the first announcement is instant. */
export function warmBotVoice(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        cachedMaleVoice = undefined;
        pickVoice();
      };
    }
  } catch {
    /* ignore */
  }
}

/**
 * The fingerprints of the executions that were already announced.
 *
 * The bus reaches more than one listener (the voice, the analysis popup, the
 * top toast, the floating bot popup) and a producer can also dispatch the
 * same fill twice. Without this the trader would hear the same trade spoken
 * two or three times. The entry expires, so the SAME trade in a LATER run
 * is announced again.
 */
const announced = new Map<string, number>();

function alreadyAnnounced(signature: string): boolean {
  const now = Date.now();
  for (const [key, at] of announced) {
    if (now - at > EXECUTION_REPEAT_WINDOW_MS) announced.delete(key);
  }
  const seen = announced.get(signature);
  if (seen !== undefined && now - seen <= EXECUTION_REPEAT_WINDOW_MS) return true;
  announced.set(signature, now);
  return false;
}

/** Test seam — forget everything that was announced. */
export function resetAnnouncedExecutions(): void {
  announced.clear();
}

/**
 * Build the spoken sentence for one execution — from the values the event
 * really carried.
 *
 * A level that is not there is simply not said. Nothing is defaulted, no
 * example price is substituted and no missing field is announced as zero.
 */
export function buildTradeAnnouncement(execution: NormalizedExecution): string {
  const parts: string[] = [];
  if (execution.robotName) parts.push(`${execution.robotName}.`);
  if (execution.symbol) parts.push(`${execution.symbol}.`);

  // The closing line of a run is a SUMMARY, not another trade — it is read
  // as a short count so the trader is not told about the same fill twice.
  if (execution.summary) {
    if (execution.filled !== null && execution.total !== null && execution.total > 0) {
      parts.push(`${execution.filled} of ${execution.total} trades opened.`);
    } else if (execution.message) {
      parts.push(execution.message);
    } else {
      parts.push("Trades opened.");
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  if (execution.status === "executed") {
    if (execution.side) parts.push(`${execution.side === "SELL" ? "Sell" : "Buy"}.`);
    const lot = formatLot(execution.lotSize);
    if (lot) parts.push(`${lot} lot.`);
    const entry = formatPrice(execution.entry, execution.digits);
    if (entry) parts.push(`Entry ${entry}.`);
    const stop = formatPrice(execution.stopLoss, execution.digits);
    if (stop) parts.push(`Stop loss ${stop}.`);
    const target = formatPrice(execution.takeProfit, execution.digits);
    if (target) parts.push(`Take profit ${target}.`);
    if (execution.index !== null && execution.total !== null && execution.total > 0) {
      parts.push(`Trade ${execution.index} of ${execution.total} executed.`);
    } else {
      parts.push("Trade executed.");
    }
  } else if (execution.status === "closed") {
    if (execution.side) parts.push(`${execution.side === "SELL" ? "Sell" : "Buy"}.`);
    const entry = formatPrice(execution.entry, execution.digits);
    if (entry) parts.push(`Closed at ${entry}.`);
    else parts.push("Position closed.");
  } else {
    // A refused / blocked order is announced AS A FAILURE — never as a
    // successful trade.
    parts.push("Trade not opened.");
    if (execution.message) parts.push(execution.message);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Speak a DYNAMIC trade announcement for a confirmed execution.
 *
 * Rules baked in here:
 *  • Only a CONFIRMED execution is announced. A signal, a request, a
 *    progress line ("connecting to broker…") or a plan is never spoken —
 *    the trader would hear a trade that never happened.
 *  • The sentence is built from the event's own values. A missing level is
 *    skipped, never invented.
 *  • The same execution is announced ONCE, even when the bus delivers it to
 *    several listeners or the producer dispatches it twice.
 *  • A refused order is announced as a failure, never as a success.
 */
export function speakTradeExecution(payload: unknown): void {
  // EVERY STEP OF THE CHAIN IS LOGGED, so "the voice never speaks" can be
  // traced from the event to the engine instead of guessed at:
  //   step 1 — the event arrived
  //   step 2 — the setting is on
  //   step 3 — the payload is a confirmed execution (symbol + status)
  //   step 4 — it is not a repeat
  //   step 5 — speakBot chose an engine and spoke (see speakBot above)
  console.info("[voice] step 1 execution-result received");
  if (!isBotVoiceEnabled()) {
    console.info("[voice] step 2 skipped — botVoiceEnabled is false");
    return; // voice off → say nothing
  }
  if (typeof window === "undefined") return;
  const execution = normalizeExecution(payload);
  if (!execution) {
    console.info("[voice] step 3 skipped — payload is not an execution object");
    return;
  }
  // A plan without a symbol is not a trade yet — nothing to announce.
  if (!execution.symbol) {
    console.info("[voice] step 3 skipped — no symbol on the payload");
    return;
  }
  // Progress chatter carries no outcome — it is not an execution.
  if (execution.status === null) {
    console.info("[voice] step 3 skipped — no outcome status on the payload");
    return;
  }
  console.info(
    `[voice] step 3 execution: ${execution.status} ${execution.symbol}${execution.side ? ` ${execution.side}` : ""}`,
  );

  const signature = executionSignature(execution);
  if (alreadyAnnounced(signature)) {
    console.info("[voice] step 4 skipped — already announced within the repeat window");
    return;
  }

  const sentence = buildTradeAnnouncement(execution);
  if (!sentence) {
    console.info("[voice] step 4 skipped — nothing to say for this execution");
    return;
  }
  speakBot(sentence);
}
