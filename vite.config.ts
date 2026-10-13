// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const port = Number(process.env["PORT"] ?? 5173);

export default defineConfig({
  vite: {
    server: {
      host: "0.0.0.0",
      port,
      strictPort: true,
      allowedHosts: true,
    },
    preview: {
      host: "0.0.0.0",
      port,
      strictPort: true,
      allowedHosts: true,
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Static production hosting (Freebuff) runs no Node server, so the SSR
    // build emitted no index.html and every URL 404ed. SPA mode pre-renders
    // a shell at build time; the app then hydrates and routes client-side.
    // Dev/preview SSR is unaffected.
    spa: { enabled: true },
  },
  nitro: {
    // Production deploys run on Vercel (Build Output API): the app is full-stack
    // (TanStack Start server functions for auth sync, MetaApi trading, Brevo
    // emails), so a static-only host cannot serve it. The Lovable wrapper only
    // applies this outside its sandbox — the Freebuff preview keeps its own
    // cloudflare/dev setup and is unaffected.
    preset: "vercel",
  },
});
