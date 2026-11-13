# Où est le Poulet? Balham

Phone web app for Dom's birthday pub crawl: a map of every pub within 1 mile of Balham station, team check-ins,
a challenge every 2nd pub, photo/video evidence, and clues the organisers unlock from Chicken HQ.

- `web/` is the app. It's static files deployed to GitHub Pages, and anyone can open it in a phone browser and add it to their home screen.
- `supabase/schema.sql` sets up the shared database, security rules and evidence storage.
- `src/` is the original claude.ai artifact version, plus the OpenStreetMap extraction scripts.

## One-time setup

1. **Supabase**: create a free project at supabase.com. In **SQL Editor**, paste `supabase/schema.sql` and run it.
   Then un-comment the last line with your and Dom's emails and run that too.
2. **Sign-in links**: in Supabase go to **Authentication → URL Configuration**. Set **Site URL** to the GitHub Pages address
   (e.g. `https://<user>.github.io/poulet-crawl/`) and add it under **Redirect URLs**.
3. **Connect the app**: copy the Project URL and the anon/publishable key into `web/config.js`.
   That key is public by design, because the database rules decide who can change what.
4. **Deploy**: push to `main`. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
   The workflow in `.github/workflows/pages.yml` publishes `web/`.

## Run locally

```bash
python3 -m http.server 8080 --directory web
```

Then open http://localhost:8080. Without Supabase details in `config.js`, the app runs in demo mode
and saves to the browser only, with Chicken HQ open.

## Who can do what

| | Players (anyone with the link) | Organisers (signed in, listed in `admins`) |
|---|---|---|
| See map, rules, teams, unlocked clues | ✓ | ✓ |
| Check in, send evidence | ✓ | ✓ |
| Approve evidence, unlock clues, mark found | | ✓ |
| See hideout and clue list | | ✓ |
| Edit teams, challenges, pub info, settings | | ✓ |

## Data credits

Pub locations, addresses and some opening hours © OpenStreetMap contributors (ODbL). Map tiles © OpenStreetMap contributors, used under the OSM tile usage policy (fine for a small private event).
