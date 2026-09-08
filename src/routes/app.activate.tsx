import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bot, Lock } from "lucide-react";
import { toast } from "sonner";
import { activateKey, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/activate")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Activate Licence — EA Migrate Pro" },
      { name: "description", content: "Enter your licence key to unlock your trading robot." },
      { property: "og:title", content: "Activate Licence — EA Migrate Pro" },
      { property: "og:description", content: "Enter your licence key to unlock your trading robot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Activate,
});

function Activate() {
  const [key, setKey] = useState("");
  const app = useAppState();
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-6">
      <button
        onClick={() => navigate({ to: "/app" })}
        aria-label="Back"
        className="flex size-11 items-center justify-center rounded-full border border-border/60 bg-card/60"
      >
        <ArrowLeft className="size-5" />
      </button>

      <div className="flex flex-1 flex-col justify-center">
        <div className="flex items-center justify-center gap-3">
          <Bot className="size-8 text-primary" />
          <span className="text-2xl font-bold tracking-[0.18em] uppercase">EA Migrate</span>
        </div>

        {app.email && (
          <div className="mx-auto mt-5 rounded-full border border-primary/40 bg-primary/10 px-5 py-2 text-sm font-semibold text-primary">
            {app.email}
          </div>
        )}

        <form
          className="panel mt-8 p-6 glow-ring"
          onSubmit={(e) => {
            e.preventDefault();
            const res = activateKey(key);
            if (res.error) return toast.error(res.error);
            toast.success(`${res.robot?.name} activated`);
            navigate({ to: "/app/home" });
          }}
        >
          <p className="text-xs font-bold tracking-[0.22em] text-muted-foreground uppercase">
            Activation
          </p>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="enter license key"
            className="mt-4 h-14 w-full rounded-full border border-border/60 bg-background/60 px-5 font-mono text-sm tracking-[0.15em] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="mt-4 h-14 w-full rounded-full bg-primary text-sm font-bold tracking-[0.18em] text-primary-foreground uppercase glow-ring"
          >
            Get access
          </button>
          <p className="mt-4 flex items-center justify-center gap-2 text-xs tracking-[0.18em] text-muted-foreground uppercase">
            <Lock className="size-3" /> Encrypted activation
          </p>
        </form>
      </div>
    </div>
  );
}
