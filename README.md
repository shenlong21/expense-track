# Expense tracker (phone-only PWA)

A tiny installable web app. **All data stays on your phone** (in the browser's IndexedDB). There is no
server, no account and no login. GitHub Pages only serves the app's files.

## Put it online (free, GitHub Pages)
1. Make this `web` folder the root of a new **public** GitHub repository (the app's code is public; your
   expenses never leave your phone).
2. `git init -b main && git add . && git commit -m "Expense tracker" && git remote add origin <repo url> && git push -u origin main`
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The *Deploy to GitHub Pages* action runs on every push. When it finishes your app is at
   `https://<your-username>.github.io/<repo-name>/`.

## Install on your phone
- **Android (Chrome):** open the link, then ⋮ → **Install app** (or "Add to Home screen").
- **iPhone (Safari):** open the link, then Share → **Add to Home Screen**. **Install first, then enter data**:
  on iPhone the home-screen app keeps its data separately from Safari.

## Your data
- Stored only on that phone, in that browser or installed app. It is not shared between devices.
- Clearing the site data, uninstalling the app, or losing the phone loses the data.
  **Menu → Back up (CSV)** saves a file; **Restore from CSV** loads it again (entries already on the phone
  are skipped, so restoring twice does not duplicate anything). Back up now and then.
- Anyone who unlocks your phone and opens the app can see the expenses, so rely on your phone's lock.

## Two views
Menu → **Notebook view / List view** switches the home screen. Both edit the same data.
Type `chai 25` (or `25 chai`, `auto rs 1,250.50`) to add an expense; in the notebook, write a date such as
`28 Oct` on a blank line to turn to that day.

## Updating
Push a change to `main`; the action redeploys. The app picks the new version up the next time it opens online.
