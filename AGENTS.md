<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Phoenix and Sniper must derive robot names, imagery, running state, and accent color from live app state so user customization remains authoritative.
- Robot background video is controlled only by a double press on the HOME navigation button; static robot imagery remains visible until then.

- Mentor registrations, approval state, payment flag and licence limits live in the Vercel KV/Upstash store behind /api/register, /api/admin-users and /api/admin-approve (api/_registry.ts); the admin console reads/writes only through these. Why: registrations must not depend on external database tables.
