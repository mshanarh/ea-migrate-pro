import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BG_EFFECTS } from "@/components/BackgroundEffects";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { CustomizationPanel } from "@/components/app/CustomizationDrawer";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";

export const Route = createFileRoute("/app/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Settings — EA Migrate Pro" },
      { name: "description", content: "Customize colors, interface style and font." },
    ],
  }),
  component: AppSettings,
});

const CYAN = "#00e5ff";

function BackgroundEffectsSection() {
  const [enabled, setEnabled] = useState(true);
  const [selected, setSelected] = useState("dollars");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnabled(localStorage.getItem("bgEffectsEnabled") !== "false");
    setSelected(localStorage.getItem("bgEffectType") || "dollars");
  }, []);

  const persist = (nextEnabled: boolean, nextType: string) => {
    localStorage.setItem("bgEffectsEnabled", nextEnabled ? "true" : "false");
    localStorage.setItem("bgEffectType", nextType);
    window.dispatchEvent(new Event("eamp:bg-effects"));
  };

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    persist(next, selected);
  };

  const pick = (id: string) => {
    setSelected(id);
    persist(true, id);
  };

  return (
    <section>
      {/* Pill header with toggle — matches the drawer's section rows */}
      <div className="flex items-center justify-between rounded-full border border-white/10 bg-[#0f1a1a] px-5 py-3">
        <button
          type="button"
          onClick={toggle}
          className="flex flex-1 items-center gap-3 text-left"
          aria-pressed={enabled}
        >
          <span className="text-xl" aria-hidden>🖼️</span>
          <span className="text-sm font-black tracking-wide text-white">Background Effects</span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle background effects"
          onClick={toggle}
          className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: enabled ? CYAN : "rgba(255,255,255,0.15)" }}
        >
          <span
            className="absolute top-1 size-5 rounded-full bg-white shadow transition-all"
            style={{ left: enabled ? "26px" : "4px" }}
          />
        </button>
      </div>

      {/* 2-column effect cards */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {BG_EFFECTS.map((effect) => {
          const active = enabled && selected === effect.id;
          return (
            <button
              key={effect.id}
              type="button"
              onClick={() => pick(effect.id)}
              aria-pressed={active}
              className="rounded-[16px] border bg-[#1a1a1a] p-3 text-left transition-transform active:scale-[0.97]"
              style={{
                borderColor: active ? CYAN : "#2a2a2a",
                boxShadow: active ? `0 0 18px ${CYAN}33` : "none",
              }}
            >
              <p className="text-sm font-bold" style={{ color: active ? CYAN : "#ffffff" }}>
                {effect.name}
              </p>
              <p className="mt-0.5 text-xs text-white/60">{effect.subtitle}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AppSettings() {
  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 pt-10 pb-40">
        <div className="pb-2">
          <h1 className="text-3xl font-black tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-white/55">
            Colors, interface styles and fonts — changes apply instantly and are saved on this device.
          </p>
        </div>
        <div className="mx-0 w-full max-w-full flex-1 overflow-hidden">
          <BackgroundEffectsSection />
          <div className="mt-8">
            <CustomizationPanel />
          </div>
        </div>
      </main>
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
    </div>
  );
}
