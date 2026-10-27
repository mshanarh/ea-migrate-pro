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

  it("speaks only the FIRST trade of a batch, and stays silent for the other legs", () => {
    // A 4-trade batch, announced with each fill's position in the batch.
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", lotSize: 0.01, entry: 65000, index: 1, total: 4, message: "TRADE 1/4 EXECUTED" });
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", lotSize: 0.01, entry: 65000, index: 2, total: 4, message: "TRADE 2/4 EXECUTED" });
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", lotSize: 0.01, entry: 65000, index: 3, total: 4, message: "TRADE 3/4 EXECUTED" });
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", lotSize: 0.01, entry: 65000, index: 4, total: 4, message: "TRADE 4/4 EXECUTED" });

    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toContain("Trade 1 of 4 executed");
  });

  it("reads the trade's position from the producer's TRADE n/m label too", () => {
    // The auto-trader labels each fill; the loop's own broadcast repeats the
    // same numbering, so a leg is recognised whichever event arrives first.
    speakTradeExecution({ ok: true, status: "executed", symbol: "XAUUSDm", side: "SELL", message: "TRADE 1/10 EXECUTED", index: 1, total: 10 });
    speakTradeExecution({ ok: true, status: "executed", symbol: "XAUUSDm", side: "SELL", event: "TRADE 2/10 EXECUTED" });
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toContain("Trade 1 of 10 executed");
  });

  it("speaks the first trade of the NEXT batch again", () => {
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", index: 1, total: 4 });
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", index: 2, total: 4 });
    // Batch closed, a new one opens: its own trade 1 is heard.
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "SELL", index: 1, total: 4 });
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "SELL", index: 2, total: 4 });
    expect(spoken.map((entry) => entry.text)).toHaveLength(2);
  });

  it("still speaks the first fill that confirms when trade 1 never did", () => {
    // Trade 1 was blocked, trade 2 is the first real fill — the trader hears it.
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", index: 2, total: 4 });
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "BUY", index: 3, total: 4 });
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toContain("Trade 2 of 4 executed");
  });

  it("still speaks closes, and speaks a single-order run", () => {
    speakTradeExecution({ ok: true, status: "closed", symbol: "BTCUSDm", side: "BUY", entry: 65100 });
    speakTradeExecution({ ok: true, status: "executed", symbol: "EURUSDm", side: "SELL", index: 1, total: 1, message: "TRADE 1/1 EXECUTED" });
    expect(spoken.map((entry) => entry.text)).toHaveLength(2);
  });

  it("stays silent when the trader turned the voice off — independently of notifications", () => {
    window.localStorage.setItem("botVoiceEnabled", "false");
    speakTradeExecution({ ok: true, status: "executed", symbol: "BTCUSDm", side: "SELL", message: "TRADE 1/1 EXECUTED" });
    expect(spoken).toHaveLength(0);
  });
});
