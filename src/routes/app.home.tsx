import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftRight, Pause, Play, Plus, Trash2 } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import robot from "@/assets/app-robot.jpg.asset.json";
import { removeRobot, toggleRobot, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Robots — EA Migrate Pro" },
      { name: "description", content: "Run and manage your activated trading robots." },
      { property: "og:title", content: "My Robots — EA Migrate Pro" },
      { property: "og:description", content: "Run and manage your activated trading robots." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppHome,
});

function AppHome() {
  const app = useAppState();
  const active = app.robots[0];

  return (
    <AppFrame>
      {active ? (
        <>
          <div className="flex flex-col items-center text-center">
            <img
              src={robot.url}
              alt={active.name}
              className="size-56 rounded-full border-4 border-primary object-cover"
              style={{ boxShadow: "0 0 60px rgba(37,99,235,0.6)" }}
            />
            <h1 className="mt-6 text-3xl font-bold uppercase">{active.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Fully automated</p>
            <div className="mt-4 rounded-full border border-border/60 bg-card/70 px-5 py-2 text-sm font-semibold">
              Powered By <span className="text-primary">EA Migrate</span>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <Link
              to="/app/metatrader"
              className="panel flex h-14 items-center gap-4 rounded-full px-6 text-base font-semibold"
            >
              <ArrowLeftRight className="size-5 text-primary" /> Pairs
            </Link>
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggleRobot(active.id)}
                className="panel flex h-14 flex-1 items-center gap-4 rounded-full px-6 text-base font-semibold"
              >
                {active.running ? (
                  <>
                    <Pause className="size-5 text-primary" /> Stop
                  </>
                ) : (
                  <>
                    <Play className="size-5 text-primary" /> Start
                  </>
                )}
              </button>
              <button
                onClick={() => removeRobot(active.id)}
                aria-label="Remove robot"
                className="panel flex size-14 items-center justify-center rounded-full text-primary"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
          </div>

          <p className="mt-8 text-sm text-muted-foreground">Robots List:</p>
          <ul className="mt-3 space-y-3">
            {app.robots.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-4 rounded-full border border-primary/50 bg-primary/5 p-3 pr-6"
              >
                <img src={robot.url} alt="" className="size-12 rounded-full object-cover" />
                <span className="font-semibold text-primary">{r.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="panel mt-16 p-10 text-center">
          <p className="font-semibold">No robot yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Add a licence key to unlock your first trading robot.
          </p>
        </div>
      )}

      <Link
        to="/app/activate"
        className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-full border border-dashed border-primary/50 text-sm font-semibold text-primary"
      >
        <Plus className="size-4" /> Add Another License
      </Link>
    </AppFrame>
  );
}
