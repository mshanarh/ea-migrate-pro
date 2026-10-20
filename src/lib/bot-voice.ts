/**
 * Bot Voice — the smooth male voice that welcomes the trader and reads live
 * trade announcements. In a browser it runs on SpeechSynthesis (on-device, no
 * network); inside the Android wrapper it routes to the NATIVE TextToSpeech
 * bridge, because the WebView's speechSynthesis is silent there. The toggle
 * in Settings → Back Animation → Bot Voice persists in localStorage; the app
 * announces through `speakBot` which no-ops when disabled or unsupported.
 */

import { callNative, hasNativeBridge } from "@/lib/native-bridge";

const KEY = "botVoiceEnabled";

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
  if (!isBotVoiceEnabled()) return; // voice off → say nothing
  if (typeof window === "undefined") return;
  // 1. Native Android TTS — AndroidTTS (spec) or the injected EAMigrate bridge.
  const androidTts = (
    window as unknown as { AndroidTTS?: { speak?: (value: string) => void } }
  ).AndroidTTS;
  if (typeof androidTts?.speak === "function") {
    try {
      androidTts.speak(text);
    } catch {
      /* native engine unavailable — stay silent rather than double-speak */
    }
    return;
  }
  if (hasNativeBridge()) {
    callNative("speak", text);
    return;
  }
  // 2. Browser fallback.
  if (!("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = 0.98;
    utterance.pitch = 0.85; // deeper, smooth male tone
    utterance.volume = 1;
    synth.speak(utterance);
  } catch {
    /* unsupported — silent */
  }
}

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