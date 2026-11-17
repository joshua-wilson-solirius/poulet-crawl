# Où est le Poulet? Balham

Phone web app for Dom's birthday pub crawl: a map of every pub within 1 mile of Balham station, team check-ins,
a challenge every 2nd pub, photo/video evidence, and clues the organisers unlock from Chicken HQ.

- `web/` is the app. It's static files deployed to GitHub Pages, and anyone can open it in a phone browser and add it to their home screen.
- `supabase/schema.sql` sets up the shared database, security rules and evidence storage.
- `src/` is the original claude.ai artifact version, plus the OpenStreetMap extraction scripts.

## One-time setup

1. **Create the Supabase project**: make a free project at supabase.com.
2. **Allow team logins**: go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. Players join by team number, so they never need an account.
3. **Database**: in **SQL Editor**, paste `supabase/schema.sql` and run it. Then run `supabase/tests/access_test.sql`. It should end with `ALL ACCESS TESTS PASSED`, and it leaves no data behind.
4. **Organiser login**: go to **Authentication → Users → Add user → Create new user**, enter the organiser email and password (at least 6 characters), and tick **Auto Confirm User**.
   Then, in the SQL Editor, run `insert into public.admins (email) values ('<that email>');`.
5. **Connect the app**: copy the Project URL and the anon/publishable key into `web/config.js`.
   That key is public by design, because the database rules decide who can see and change what.
6. **Deploy**: merge to `main`. GitHub Actions publishes `web/` to GitHub Pages.

## Run locally

```bash
python3 -m http.server 8080 --directory web
```

Then open http://localhost:8080. Without Supabase details in `config.js`, the app runs in demo mode
and saves to the browser only, with Chicken HQ open.

## Who can do what

Players join on their phone by typing their team number (1, 2, 3 …). Organisers sign in with email and password.

| | Visitor | Player (own team) | Player (other teams) | Organiser |
|---|---|---|---|---|
| Rules, pubs, team names | ✓ | ✓ | ✓ | ✓ + edit |
| Check-ins, evidence, unlocked clues | | ✓ | ✗ | ✓ |
| A pub's challenge | | once at that challenge pub | ✗ | ✓ + edit |
| Hideout and clue list | | ✗ | ✗ | ✓ |
| Approve evidence, unlock clues, mark found | | ✗ | ✗ | ✓ |
| Team selfies (one per pub) | | ✓ add, retake | after the game, in the Gallery | ✓ |
| Where other teams are (map, last check-in) | | ✗ | ✗ | ✓ + live alerts |
| Leaderboard | | organiser's switch | organiser's switch | ✓ |
| Move or remove players, edit teams, rules, settings, game state | | ✗ | ✗ | ✓ |

All of this is enforced by row-level security in the database (`supabase/schema.sql`), not just hidden in the app.
Evidence and selfies live in private storage buckets with one folder per team, and are shown through links that expire after an hour.
Selfies open to every player who joined a team once an organiser sets the game to **Finished**.

Organisers get a pop-up on their phone whenever a team checks in or adds a selfie, while the app is open. Chicken HQ → **Activity** lists every check-in
and shows when each team last checked in. A team turns amber after 45 minutes without a check-in.

## Data credits

Pub locations, addresses and some opening hours © OpenStreetMap contributors (ODbL). Map tiles © OpenStreetMap contributors, used under the OSM tile usage policy (fine for a small private event).
