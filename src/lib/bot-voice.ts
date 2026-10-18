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

/** Announce a phrase in the bot's smooth male voice. No-op when disabled. */
export function speakBot(text: string): void {
  if (!isBotVoiceEnabled()) return;
  if (typeof window === "undefined") return;
  // INSIDE THE ANDROID APP the native TextToSpeech owns speech: the WebView's
  // speechSynthesis never speaks there (the "voice works in the browser but
  // not on the phone" bug). Same bridge check the rest of the app uses. An
  // older APK without speak() degrades to silence — never to the web path —
  // and the updated APK carries the method.
  if (hasNativeBridge()) {
    callNative("speak", text);
    return;
  }
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
