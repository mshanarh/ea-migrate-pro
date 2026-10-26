import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBotVoiceVolume, resetAnnouncedExecutions, speakTradeExecution } from "@/lib/bot-voice";

/**
 * THE SILENT-VOICE BUG, AS A TEST.
 *
 * `botVoiceVolume` is only written when the trader touches the slider, so on a
 * fresh device the key is ABSENT. `Number(localStorage.getItem(key))` turns that
 * absence into 0 — a perfectly finite volume — and every announcement was then
 * spoken at volume 0 while the notifications appeared normally.
 */
type Utterance = { text: string; volume: number; rate: number; pitch: number; lang: string; voice?: unknown };

describe("bot voice", () => {
  let spoken: Utterance[];

  beforeEach(() => {
    window.localStorage.clear();
    resetAnnouncedExecutions();
    spoken = [];
    const synth = {
      cancel: vi.fn(),
      resume: vi.fn(),
      speak: (utterance: Utterance) => spoken.push(utterance),
      getVoices: () => [],
      speaking: false,
      pending: false,
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      volume = 1;
      rate = 1;
      pitch = 1;
      lang = "";
      voice?: unknown;
      constructor(text: string) {
        this.text = text;
      }
    };
  });

  it("treats a missing volume setting as full volume", () => {
    expect(window.localStorage.getItem("botVoiceVolume")).toBeNull();
    expect(getBotVoiceVolume()).toBe(1);
  });

  it("honours a volume the trader actually chose", () => {
    window.localStorage.setItem("botVoiceVolume", "0.4");
    expect(getBotVoiceVolume()).toBe(0.4);
  });

  it("speaks a confirmed execution at full volume, with the bot voice on", () => {
    expect(window.localStorage.getItem("botVoiceEnabled")).toBeNull(); // defaults ON

    speakTradeExecution({
      ok: true,
      status: "executed",
      symbol: "BTCUSDm",
      side: "BUY",
      lotSize: 0.01,
      entry: 65000,
      index: 1,
      total: 1,
      message: "TRADE 1/1 EXECUTED",
    });

    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.volume).toBe(1);
    expect(spoken[0]?.text).toContain("BTCUSDm");
    expect(spoken[0]?.text).toContain("Trade 1 of 1 executed");
  });

  it("never speaks the loop's progress chatter — that is what talked non-stop", () => {
    // These fire on EVERY scalper pass and carry `ok: true` + a symbol, so the
    // normaliser reads them as executions. Toasts still show them; the voice
    // must not say them out loud over and over.
    speakTradeExecution({ ok: true, status: "reanalysed", symbol: "BTCUSDm", side: "BUY", message: "re-analysed: direction now BUY, opening BUY 0.01 × 1" });
    speakTradeExecution({ ok: false, status: "blocked", symbol: "BTCUSDm", message: "NO TRADE (weak setup) — RSI flat" });
    speakTradeExecution({ ok: true, status: "info", message: "Position monitoring restored — the bridge now reports open positions" });
    expect(spoken).toHaveLength(0);
  });

  it("stays silent when the trader turned the voice off — independently of notifications", () => {
    window.localStorage.setItem("botVoiceEnabled", "false");
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "SELL", message: "TRADE 1/1 EXECUTED" });
    expect(spoken).toHaveLength(0);
  });
});
