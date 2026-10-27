# Biometric Attendance — dashboard

Next.js dashboard for lecturers and administrators. It talks directly to the FastAPI backend in `../Backend`. Students never log in; their attendance comes from the fingerprint terminal.

## Prerequisites

- Node.js 20 or newer (built and tested on Node 24).
- The backend running on port 8000, with a migrated and seeded database:

  ```powershell
  cd ..\Backend
  ..\.venv\Scripts\Activate.ps1
  python -m alembic upgrade head
  python -m scripts.seed
  fastapi dev app/main.py
  ```

## Setup

```powershell
cd Frontend
npm install
copy .env.example .env.local
npm run dev
```

Open **http://localhost:3000**. The backend's CORS settings allow `localhost:3000` and `127.0.0.1:3000`.

### Environment variables (`.env.local`)

| Key | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8000` | FastAPI base URL |
| `NEXT_PUBLIC_APP_NAME` | `Biometric Attendance` | Product name in the UI |
| `NEXT_PUBLIC_TIMEZONE` | `Africa/Johannesburg` | Every date and time is shown in this zone |

## Logging in

Administrators and lecturers use the same page, **/login**. The role decides where you land. `python -m scripts.seed` creates (and prints) two development accounts:

| Role | Email | Password | Lands on |
|---|---|---|---|
| Administrator | `admin@tut.ac.za` | `ChangeMe123` | **/admin** (Administration) |
| Lecturer | `lecturer@tut.ac.za` | `ChangeMe123` | **/lecturer** (Sessions) |

These are for development only. Never seed them into a real database.

- **Lecturers** open a session, watch the live class list, mark students present manually, revoke or reinstate records, export CSV, and close the session. They only see courses they're assigned to.
- **Admins** manage students and consent, fingerprint enrolment, courses and class lists, terminals and their secrets, staff accounts, and the audit log. Admins can also use every lecturer page (they see all courses).
- A lecturer who opens an `/admin` link is sent to `/lecturer` with "You don't have access to the admin area."
- `?next=` brings you back to the page you were on after signing in. It only accepts paths inside this app that your role may open.

The login token is kept in `sessionStorage`:

- A page refresh keeps you signed in.
- Closing the tab signs you out.
- After 30 minutes you're sent back to the login page with an "expired" message.

## Demo: enrolment without the hardware

`Backend/scripts/fake_terminal.py` signs requests exactly like the ESP32 terminal, so you can run the whole admin flow from a laptop.

1. Sign in as the admin. Go to **Students → Add student** (for example `229999001`), then **Record consent**.
2. Click **Enrol on a terminal**, pick `terminal-01`, and start. The dialog shows **Waiting for terminal** and updates by itself.
3. In a second PowerShell window, act as the terminal (`DEVICE_ID` and `DEVICE_SECRET` come from the seed output):

   ```powershell
   cd ..\Backend
   ..\.venv\Scripts\Activate.ps1
   $env:DEVICE_ID = "1"
   $env:DEVICE_SECRET = "<DEVICE_SECRET from the seed output>"
   python -m scripts.fake_terminal next
   ```

   It prints the `command_id` and slot. The dialog switches to **On terminal**.
4. Report the result:
   - `python -m scripts.fake_terminal result <command_id> ok` shows **Fingerprint enrolled in slot N**.
   - `... result <command_id> fail "Finger not recognised"` shows the failure, with **Try again**.
5. Optional: record a scan. `python -m scripts.fake_terminal session` prints the open session. Then `... mark <session_id> <slot> 90` turns the student **Present** on the lecturer's live page.
6. **Withdraw consent** (type the student number to confirm). This queues a wipe; run `next` and `result <id> ok` again, and the student page shows **Done**.

A new terminal's secret (**Terminals → Add terminal**) is shown once only. If it's lost, use **Rotate secret**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run lint` | ESLint (must pass with zero errors) |
| `npm run build` | Production build (must pass with zero errors) |
| `npm run test:e2e` | Playwright smoke test (see below) |

## Smoke test (Playwright)

The test does the following:

1. Logs in as the seeded lecturer.
2. Opens a session through the UI.
3. Signs a fingerprint scan exactly like `scripts/fake_terminal.py` does.
4. Waits for the student's row to turn **Present** on the live page.
5. Closes the session again.

It needs:

- the backend running;
- student `220000001` enrolled in slot 1 of the terminal (admin → Students → Enrol, then `fake_terminal next` and `fake_terminal result <id> ok`);
- the terminal's credentials, printed by the seed script, set in the environment:

```powershell
$env:DEVICE_ID = "1"
$env:DEVICE_SECRET = "<DEVICE_SECRET from the seed output>"
npm run test:e2e
```

The first run needs the browser: `npx playwright install chromium`.

## How the code is organised

| Path | Contents |
|---|---|
| `src/app/` | Routes. `(app)/` is the logged-in area (guard + shell); `lecturer/` and `admin/` hold the pages. |
| `src/components/` | Shared pieces (badges, dialogs, tables). `ui/` is generated by shadcn; don't hand-edit it. |
| `src/hooks/` | Data hooks: `use-lecturer.ts` and `use-admin.ts` (TanStack Query). |
| `src/lib/` | `api.ts` (the only place that calls `fetch`), `auth.tsx`, `errors.ts` (backend code → friendly message), `format.ts` (SAST dates), `types.ts` (mirrors the backend schemas). |
| `src/app/tokens.css` | The design tokens. Every colour, font and easing lives here (Hallmark "Cobalt" theme). |
| `e2e/` | Playwright smoke test and the HMAC signing helper. |

## Design

The visual system follows the Hallmark skill's **Cobalt** theme:

- **Colour:** a cool near-white page, one cobalt accent, and a dark graphite side rail.
- **Type:** Space Grotesk for headings, IBM Plex Sans for text, and JetBrains Mono for student numbers and times.
- **Status colours:** emerald for present and amber for revoked. Every status also has a text label and an icon, so it never depends on colour alone.

Light and dark mode both pass WCAG contrast, checked token by token. The live session page uses larger numbers so it stays readable on a projector.

## Troubleshooting

- **"Can't reach the server"** means the backend isn't running on port 8000, or `NEXT_PUBLIC_API_URL` is wrong.
- **Edits don't show up while `npm run dev` is running.** Inside OneDrive the file watcher sometimes misses changes. Stop the dev server and start it again.
