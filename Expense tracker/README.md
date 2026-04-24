# ExpenseAI (Shareable Starter)

A browser-based personal finance dashboard.

This repo is sanitized for sharing:
- No real transaction history is bundled.
- No real account/policy details are bundled.
- No API keys are stored in source code.

## Run locally

Because this app is static HTML/CSS/JS, you can run it directly.

Option 1 (quick):
- Open `index.html` in Chrome.

Option 2 (recommended):
- Run a local server in this folder:

```bash
python3 -m http.server 8080
```

- Open `http://localhost:8080`.

## First-time setup for users

1. Open the app.
2. Go to Import tab.
3. Upload CSV or paste transaction text.
4. (Optional) Add API key in FinAI tab.
5. (Optional) Use Backup to export data.

## Data and privacy

- User data is saved in browser localStorage.
- The app can optionally write `data/app-data.js` when auto-save is enabled.
- Do not commit personal `data/app-data.js` after using the app with real data.

## Share with a friend (simple)

1. Zip the project folder.
2. Send it to your friend.
3. They open `index.html` (preferably in Chrome) and import their own data.

## Share as a public URL (GitHub Pages)

1. Create a GitHub repo and push this project.
2. In GitHub: Settings -> Pages.
3. Source: Deploy from branch.
4. Branch: `main` and folder `/ (root)`.
5. Save and wait for deployment.
6. Share the generated Pages URL.

## Notes

- Auto-save to disk uses File System Access API, best supported in Chrome/Edge.
- If something looks wrong, clear browser data in Import tab and re-import.
