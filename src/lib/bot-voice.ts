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
import { describeClose, describeOpen, ClosedTrade, OpenedTrade } from "./bot-notify";

const KEY = "botVoiceEnabled";
/** The voice level, 0…1 — applied to the browser engine and to native TTS. */
const VOLUME_KEY = "botVoiceVolume";

/** 
 * THE RUN-OVER STOP. 
 *
 * The last line of a run (its summary, or its final fill) schedules a stop 
 * after enough time for that line to finish reading. The stop flushes BOTH 
 * engines — the browser queue and Android's QUEUE_ADD backlog — so the voice 
 * speaks the executions and then goes quiet instead of carrying on talking 
 * after the orders are done. A fresh line cancels the pending stop, so a new 
 * run always has a working voice. 
 */
let pendingStop: ReturnType<typeof setTimeout> | null = null;

function cancelPendingStop(): void {
  if (pendingStop === null) return;
  clearTimeout(pendingStop);
  pendingStop = null;
}

/** Roughly how long a line takes to read: 400ms per word plus breathing room. */
function spokenDurationMs(sentence: string): number {
  const words = sentence.split(/\s+/).filter(Boolean).length;
  return Math.min(20_000, 1_500 + words * 400);
}

function scheduleStopAfter(sentence: string): void {
  cancelPendingStop();
  pendingStop = setTimeout(() => {
    pendingStop = null;
    stopBotVoice();
  }, spokenDurationMs(sentence));
}

/** 
 * Silences the voice — used when the run is over and when the trader presses 
 * STOP. Cancels the browser engine and flushes the native one; on an APK that 
 * predates stopSpeech() the native call is simply absent and nothing breaks. 
 */
export function stopBotVoice(): void {
  if (typeof window === "undefined") return;
  cancelPendingStop();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* engine unavailable — nothing to stop */
  }
  callNative("stopSpeech");
}

/** 
 * REFUSED ORDERS ARE HEARD — BUT NEVER ON A LOOP. 
 *
 * A broker refusal is worth saying out loud. A bridge that is down, or a 
 * scalper pass that keeps finding no trade, must not repeat it every few 
 * seconds: one refusal per this gap, then silence. 
 */
const REFUSAL_GAP_MS = 20_000;
let lastRefusalSpokenAt = 0;

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
  // A fresh line cancels any scheduled run-over stop: the voice is still 
  // needed, so the flush must not fire underneath it.
  cancelPendingStop();
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
    if (synth.speaking || synth.pending) {
      // The engine is already live — the first real line already speaks. We 
      // still warm the voice list so a later announcement is instant rather 
      // than blocked on onvoiceschanged.
      warmBotVoice();
      return;
    }
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

/**
 * THE FIRST TRADE OF A BATCH SPEAKS — THE REST DO NOT.
 *
 * A batch opens several positions in one pass (4 × 0.01 BTCUSDm, 10 × 0.01
 * XAUUSDm), and a full sentence per leg buried the trader in speech. Every leg
 * still reaches the notification list, the popup and the toast, and the run
 * summary still counts them — the VOICE says the first confirmed trade of the
 * batch and stays quiet for the others. The next batch opens with its own
 * trade 1, so that one speaks again.
 *
 * When trade 1 never confirmed (blocked, refused), the first fill that does
 * come through IS the first trade the trader can hear — so the rule keys on
 * "has this batch been announced yet", not on an index of 1 alone.
 */
const batchAnnounced = new Map<string, number>();
const BATCH_MEMORY_MS = 10 * 60 * 1000;

function shouldSpeakFill(symbol: string, index: number | null, total: number | null): boolean {
  const key = `${symbol.trim().toUpperCase()}|${total ?? "?"}`;
  const now = Date.now();
  for (const [oldKey, at] of batchAnnounced) {
    if (now - at > BATCH_MEMORY_MS) batchAnnounced.delete(oldKey);
  }
  if (index !== null && index > 1) {
    if (batchAnnounced.has(key)) return false;
    batchAnnounced.set(key, now);
    return true;
  }
  batchAnnounced.set(key, now);
  return true;
}

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
  batchAnnounced.clear();
}

/** Shape helpers the scalper voice path uses. They live here so the import of
 * bot-notify stays inside the voice module (the loop already imports a separate
 * path).
 */

function normalizeToClosed(p: Record<string, unknown>): ClosedTrade | null {
  const number = (p["number"] as number | null | undefined) ?? null;
  if (number === null || number < 1) return null;
  return {
    number,
    outcome: "broker" as const,
    profit: (p["profit"] as number | null | undefined) ?? null,
  };
}

function normalizeToOpened(p: Record<string, unknown>): OpenedTrade | null {
  const side = (p["side"] as string | null | undefined) ?? "";
  const symbol = (p["symbol"] as string | null | undefined) ?? "";
  if (!side || !symbol) return null;
  return {
    number: (p["number"] as number | null | undefined) ?? 0,
    side,
    symbol,
    lotSize: (p["lotSize"] as number | string | null | undefined) ?? null,
    price: (p["price"] as number | string | null | undefined) ?? null,
  };
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

  // ── WHAT THE VOICE IS ALLOWED TO SAY ─────────────────────────────────────
  // The bus also carries the bot's PROGRESS chatter — "re-analysed: direction
  // now BUY…", "waiting for the next M15 candle", "Position monitoring
  // restored". Much of it arrives with `ok: true` and a symbol, so the
  // normaliser reads it as an execution, and in scalper mode those lines fire
  // on EVERY pass: the voice talked non-stop, long after the orders had
  // finished. Toasts and popups still render every line; the voice speaks only
  // real outcomes:
  //   • a fill the broker confirmed (executed),
  //   • a close the bot confirmed broker-side (closed),
  //   • the closing summary line of a run,
  //   • a REFUSED order (failed) — at most one per REFUSAL_GAP_MS.
  // FIRST the producer's own label. A producer that says "reanalysed",
  // "waiting", "stopped-out", "scalper-cycle", "info" or any other non-outcome
  // have described its progress, not an outcome — and the inference below would
  // happily promote `ok: true` + a symbol to "executed". The explicit label wins:
  // it is never spoken.
  const rawLabel = (payload as Record<string, unknown>)["status"];
  const label = typeof rawLabel === "string" ? rawLabel.trim().toLowerCase() : "";
  if (label && label !== "executed" && label !== "closed" && label !== "failed" && label !== "scalper-cycle") {
    console.info(`[voice] step 3 skipped — producer labelled the event "${label}", which is progress chatter`);
    return;
  }

  const isOutcome =
    execution.summary ||
    execution.status === "executed" ||
    execution.status === "closed";
  if (!isOutcome) {
    if (execution.status !== "failed") {
      console.info(
        `[voice] step 3 skipped — "${execution.status ?? "unlabelled"}" is not an execution outcome (isOutcome=${isOutcome})`,
      );
      return;
    }
    if (Date.now() - lastRefusalSpokenAt < REFUSAL_GAP_MS) {
      console.info("[voice] step 3 skipped — a refusal was already announced within the last 20s");
      return;
    }
  }

  // ── ONLY THE FIRST TRADE OF A BATCH IS SPOKEN ────────────────────────────
  // (see shouldSpeakFill — the other legs stay silent out loud, still visible
  // in the notifications and counted by the run summary).
  if (execution.status === "executed" && !execution.summary) {
    if (!shouldSpeakFill(execution.symbol, execution.index, execution.total)) {
      console.info(
        `[voice] step 4 skipped — trade ${execution.index ?? "?"} of ${execution.total ?? "?"}: only the first trade of a batch is spoken`,
      );
      return;
    }
  }

  // A confirmed close the scalper loop re-opens immediately is a closethen-open
  // notification, not the end of the run. The voice must keep speaking for every
  // subsequent fill in the same pass; it stops only on the run-over summary or the
  // final numbered trade of a batch (handled below).
  const isScalperCycle = label === "scalper-cycle";

  if (isScalperCycle) {
    // A scalper-cycle event carries BOTH the close and the queued reopen, so the
    // voice speaks ONE combined line and does NOT stop the run. The line is built
    // from the same describe helpers the UI uses, so what the trader hears is what
    // the trader sees. If we only have the close, say that and keep the engine
    // alive for the reopen the loop will announce next.
    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      const close = normalizeToClosed(p);
      if (!close) {
        // Not something we can turn into speech — fall through to the normal
        // outcome path instead of silently dropping it.
      } else if (p["side"] !== undefined && p["symbol"] !== undefined) {
        const reopen = normalizeToOpened(p);
        if (reopen) {
          const sentence = `${describeClose(close)} — then ${describeOpen(reopen)}`;
          if (sentence) speakBot(sentence);
        } else {
          const sentence = describeClose(close);
          if (sentence) speakBot(sentence);
        }
      } else {
        const sentence = describeClose(close);
        if (sentence) speakBot(sentence);
      }
    }
    return;
  }

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
  if (execution.status === "failed") lastRefusalSpokenAt = Date.now();

  // ── STOP ONCE THE RUN IS DONE EXECUTING ──────────────────────────────────
  // The closing summary, or the final trade of the batch, is the last thing
  // the trader needs to hear: schedule the flush so the engines go quiet the
  // moment that line has been read instead of talking on afterwards.
  const lastLineOfRun =
    execution.summary ||
    (execution.status === "executed" &&
      execution.index !== null &&
      execution.total !== null &&
      execution.index >= execution.total);
  if (lastLineOfRun) {
    console.info(`[voice] step 6 run finished executing — stopping the voice in ${spokenDurationMs(sentence)}ms`);
    scheduleStopAfter(sentence);
  }

  // A confirmed close does not stop the rest of the run. If the close happened
  // and no summary / final trade has already scheduled the stop, make sure the
  // engine is left running so the next fill or next cycle is still heard.
  if (
    execution.status === "closed" &&
    !lastLineOfRun &&
    typeof window !== "undefined"
  ) {
    cancelPendingStop();
    try {
      window.speechSynthesis?.resume?.();
    } catch {
      /* engine unavailable — nothing to resume */
    }
    // Best-effort resume for Android wrappers that expose a resume method. Newer
    // wrappers expose speakWithVolume; older ones do not, and the bridge helper
    // handles the missing method as "no native feature" rather than a crash.
    (callNative as any)("resumeSpeech");
  }
}
