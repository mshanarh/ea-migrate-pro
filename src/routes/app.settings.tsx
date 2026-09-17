import { createFileRoute } from "@tanstack/react-router";
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
          <CustomizationPanel />
        </div>
      </main>
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
    </div>
  );
}
