# Signal-inspired Messenger — Scaler SDE Fullstack Assignment


## Live Demo

**Application:** https://signal-inspired-messenger-pi.vercel.app

**GitHub Repository:** https://github.com/Navnidhi-gandhi07/signal-inspired-messenger

**Backend API:** https://signal-inspired-messenger-u8t4.onrender.com

**Backend Health Check:** https://signal-inspired-messenger-u8t4.onrender.com/health

### Deployment

- **Frontend:** Next.js deployed on Vercel
- **Backend:** FastAPI deployed on Render
- **Real-time communication:** WebSockets
- **Database:** SQLAlchemy with SQLite support and PostgreSQL configuration
- **Deployment status:** Frontend and backend deployed; basic application functionality verified

**Note:** The current Render Free deployment does not provide persistent local disk storage. Database records and uploaded files stored on the instance's local filesystem may be lost following redeployment or restart.

A **Signal Desktop-inspired** messaging demo with **light mode by default**, optional dark mode, responsive layout, real-time messaging, and local SQLite persistence (managed PostgreSQL is configured for production). This is an independent educational clone, **not affiliated with Signal**. Encryption is **not implemented**; do not use it for sensitive conversations.

## Project roots and stack
- Repository root: repository directory containing `README.md` and `render.yaml`
- Frontend root: `frontend/` (Next.js 15, TypeScript, React 19, plain modular CSS)
- Backend root: `backend/` (FastAPI, SQLAlchemy, SQLite locally or PostgreSQL in production)
- Real-time: FastAPI WebSockets; the browser derives `ws://` or `wss://` from `NEXT_PUBLIC_API_URL`

## Stack
- Frontend: Next.js 15, TypeScript, React 19, plain modular CSS, lucide-react
- Backend: Python FastAPI, SQLAlchemy, SQLite/PostgreSQL, JWT bearer sessions, PBKDF2 password hashing
- Real-time: FastAPI WebSockets

## Quick start
Requires Python 3.11+ and Node.js 20+. Run each terminal from the repository root.

**Terminal 1**
```powershell
Set-Location .\backend
if (-not (Test-Path .\.env)) { Copy-Item .env.example .env }
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
# Seed demo accounts only for a new database; do not rerun against data you want to keep.
if (-not (Test-Path .\signal.db)) { python -m seed }
uvicorn app.main:app --reload --port 8000 --env-file .env
```

**Terminal 2**
```powershell
Set-Location .\frontend
if (-not (Test-Path .\.env.local)) { Copy-Item .\.env.example .\.env.local }
npm ci
npm run dev
```
Open http://localhost:3000. Sign in with `alexmorgan` / `demo1234`. Other seeded accounts: `priyasharma`, `ankitverma`, `nehakapoor`, `rahulmehta`, `sarakhan` (same password). For real-time testing, open two separate browsers and log in as different users.

## Features
- Registration/login/logout, 12-hour JWT sessions, server-side session revocation and login throttling
- Contact discovery and direct conversations, seeded conversation list and previews
- Group creation, group messages, admin-managed members
- Authenticated WebSocket delivery and typing indicators, read/delivery receipts, unread counts
- Conversation-authorized image/file attachments (10MB), validated file content, emoji reactions, reply-to, expiring messages with periodic cleanup
- Profile photo upload (5MB maximum), with validated image content
- Persistent light/dark appearance settings; responsive desktop/mobile layout
- Shortcuts: Ctrl+K search, Ctrl+N new chat, Escape dismiss
- Signal Desktop-inspired navigation, compact conversation list, welcome screen, chat composer and categorized settings
- Persistent light/dark/system theme selection (light by default), chat accent and zoom preferences
- Profile name/about editing, read-receipt and typing privacy controls, per-conversation and default disappearing-message timers
- Responsive desktop/tablet/mobile layouts and application menus; keyboard shortcuts include Ctrl/⌘+K search, Ctrl/⌘+N new chat and Escape to dismiss
- Calls, stories, Secure Backups, system permissions, and unsupported notification/device controls are clearly presented as placeholders

## Schema
`users` (accounts), `contacts` (owner/contact pair), `conversations` (direct/group), `members` (role, last read), `messages` (body, attachment, reply reference, expiry), `receipts` (per-user delivery/read status), `reactions` (one reaction per user/message), `settings` (per-user preferences), `revoked_tokens` (logged-out sessions), and `uploaded_files` (upload ownership and media type). Unique constraints prevent duplicate contact, membership, receipt, reaction, and upload rows.

## API overview
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET/PATCH /me`, `POST /profile/avatar`
- `GET /avatars/{filename}`, `GET /uploads/{filename}` (profile photos are public; attachments require a valid session and conversation membership)
- `GET /users`, `GET/POST /contacts`
- `GET /conversations`, `POST /conversations/direct`, `POST /conversations/group`
- `GET /conversations/{id}/messages`, `POST /conversations/{id}/messages`, `POST /conversations/{id}/read`
- `GET/POST /conversations/{id}/members`, `DELETE /conversations/{id}/members/{user_id}`
- `PATCH /conversations/{id}/timer`, `POST /messages/{id}/reactions`
- `GET/PATCH /settings`, `POST /upload`, `WS /ws` (authenticate with the first `{"type":"auth","token":"..."}` WebSocket message)
- Interactive API docs: http://localhost:8000/docs

## Architecture / SOLID
Frontend separates UI from `lib/api.ts` transport; backend separates SQLAlchemy models from API contracts and helper functions. The design uses focused handlers and reusable components; production refactoring should introduce service and repository interfaces for full dependency inversion. No claim is made that every SOLID principle is fully realized in this starter.

## Security and limitations
- In production, set a strong random `JWT_SECRET`, `APP_ENV=production`, and `FRONTEND_ORIGINS` to the deployed frontend origin. The app refuses production startup when the secret is missing. The built-in fallback key is for local development only.
- The demo uses a shared public test password; change passwords and remove demo accounts for production.
- Uploads are content-validated and stored locally without encryption. Attachments are served only to conversation members; avatar images are intentionally public. Use encrypted private object storage for production.
- Browser authentication tokens remain in local storage. Protect against same-origin script injection and consider an HttpOnly-cookie/BFF architecture for production.
- Login throttling and WebSocket presence are process-local; horizontally scaled deployments need shared rate limiting and a pub/sub broker.
- Expired messages are excluded from reads and periodically removed from the database; associated files are removed when no unexpired message references them.
- This clone does not create or restore Signal Secure Backups, and its calls, stories, operating-system permissions, and browser push notifications are not implemented.
- WebSocket presence is process-local; multi-instance deployment requires a pub/sub broker.
- This is a functional development starter, not an audited secure messenger or a deployed hosted demo.

## Test / build
```bash
Set-Location .\backend
Set-Location .\backend
.\.venv\Scripts\python.exe -m pytest -q
Set-Location ..\frontend
npm run lint
npx tsc --noEmit
npm run build
```

Backend tests configure a temporary SQLite database and temporary upload directory; they do not use the development database.

## Production deployment (GitHub + Vercel + Render)

No deployment is performed by this repository setup. The application directories are independent hosting roots: deploy `frontend/` to Vercel and `backend/` as the Render web service. The root `render.yaml` defines a Render Blueprint with a PostgreSQL database and a persistent upload disk.

### 1. Put the repository on GitHub

Create a GitHub repository, then use GitHub's web upload or Git from a dedicated copy of this project. This checkout currently sits under `C:\Users\hp\Downloads`, which is the enclosing Git root in this environment; **do not run `git add .` or push from this checkout**, because that could include unrelated Downloads content. Make a clean project-only copy outside that parent repository, excluding local `.env` files, `.venv`, `node_modules`, SQLite databases, and uploaded user data. In the copy, verify that `git rev-parse --show-toplevel` prints the project directory before staging anything.

From that clean project directory, create the GitHub repository and configure its remote. For example:

```powershell
Set-Location C:\path\to\your\clean\signal-clone
git init
git add .
git commit -m "Prepare Signal-inspired messenger for deployment"
git branch -M main
git remote add origin https://github.com/<your-account>/<your-repository>.git
git push -u origin main
```

Do not commit `.env`, `.env.local`, database files, or credentials. `.gitignore` excludes local environment files and SQLite data. Review the staged file list before the first push.

### 2. Deploy the backend on Render

1. In Render, choose **New → Blueprint**, connect the GitHub repository, and use the root `render.yaml`.
2. The Blueprint uses `backend/` as the service root, installs from `requirements.txt`, creates a managed PostgreSQL database, and attaches a 1 GB persistent disk at `/var/data`.
3. When prompted for `FRONTEND_ORIGINS`, enter the exact Vercel production origin, without a trailing slash (for example `https://signal-chat.vercel.app`). Add a custom domain as a comma-separated additional origin if applicable. Do not use `*`.
4. Wait for the `signal-clone-api` service to become healthy. The health check is `GET /health`; the service listens on Render's injected `$PORT`.
5. Copy the service's HTTPS origin, for example `https://signal-clone-api.onrender.com`.

Render configuration in `render.yaml`:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check | `/health` |
| Database | Render PostgreSQL, injected as `DATABASE_URL` |
| Persistent attachments | Disk mounted at `/var/data`; `UPLOAD_DIR=/var/data/uploads` |

The Blueprint generates a 256-bit `JWT_SECRET`; the backend refuses production startup if the secret is absent/too short or if production CORS origins are not HTTPS. Keep the generated value private and stable between deploys so active sessions remain valid. Set each Vercel production/custom domain explicitly in `FRONTEND_ORIGINS`; production wildcard/regex origins are rejected.

### 3. Deploy the frontend on Vercel

1. In Vercel, import the same GitHub repository.
2. Set **Root Directory** to `frontend`. Keep the detected Next.js framework and default output directory.
3. Configure:

   | Environment variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | The Render HTTPS origin, e.g. `https://signal-clone-api.onrender.com` |

   Set it for Production and Preview only if each frontend origin is also allowed by the backend CORS configuration. Prefer testing previews against a separate backend rather than broadly permitting all `*.vercel.app` origins.
4. Build and deploy. `frontend/vercel.json` specifies `npm ci` and `npm run build`.
5. Copy the final Vercel production origin back into Render's `FRONTEND_ORIGINS`, save, and redeploy/restart the backend if needed.

Vercel's `NEXT_PUBLIC_API_URL` is embedded at frontend build time. If it changes, update the Vercel environment variable and rebuild/redeploy. API calls use HTTPS, and the client derives the WebSocket endpoint as WSS automatically (`https://…` → `wss://…/ws`); the JWT is sent in the first WebSocket frame, not the URL.

### 4. Deployment environment variables

**Vercel (`frontend/`):**

```dotenv
NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com
```

**Render (`backend/`, configured by `render.yaml`):**

```dotenv
APP_ENV=production
JWT_SECRET=<Render-generated secret of at least 32 characters>
FRONTEND_ORIGINS=https://<your-vercel-production-domain>
DATABASE_URL=<Render-managed PostgreSQL connection string>
UPLOAD_DIR=/var/data/uploads
```

Use `backend/.env.example` and `frontend/.env.example` for local-development templates; they contain no production credentials. The production secret and database URL belong in Render's environment, never in source control.

### Persistence, costs, and limitations

- The configured production database is PostgreSQL, so accounts, conversations, messages, settings, receipts, and revocations survive service redeploys. Uploaded files and avatars are stored on Render's persistent disk and survive service restarts and deploys.
- The Render web service and PostgreSQL plan in the Blueprint are paid plans; the web disk is also persistent paid storage. Check [Render pricing](https://render.com/pricing) before creating the Blueprint because rates and included storage can change. Persistent disks are mounted only at `/var/data`; data written elsewhere remains ephemeral. A disk-backed service is single-instance and cannot be horizontally scaled.
- Vercel currently lists Hobby at $0/month and Pro at $20/month; review the [Vercel pricing page](https://vercel.com/pricing) for limits, usage, and current eligibility. Platform pricing and account requirements can change.
- If you choose SQLite for a one-instance demo instead of the managed PostgreSQL service, set `DATABASE_URL=sqlite:////var/data/signal.db` and keep the Render disk attached at `/var/data`; retain `UPLOAD_DIR=/var/data/uploads`. SQLite and local file storage do not support multi-instance scaling.
- The local `backend/signal.db` and `backend/uploads/` are not copied into the new Render database/disk automatically. They remain untouched in your checkout. If you need existing local conversations or files in production, plan and verify a separate one-time migration/backup before launch.
- Free/ephemeral backend filesystems do not preserve SQLite databases or uploads across redeploys. The supplied Blueprint uses paid persistent resources specifically to avoid that data loss.
- WebSocket presence and login throttling are process-local. Keep one Render instance; multi-instance deployment requires shared presence/pub-sub and rate limiting. Browser tokens remain in local storage, and this clone does not implement end-to-end encryption.

### Deployment verification

Before sharing the URL, verify `/health`, register and log in from the Vercel origin, log out and confirm the prior token is rejected, then open two distinct accounts to test direct/group messages and typing over WSS. Upload/download an attachment as a group member and confirm a non-member is denied; upload an avatar; then restart/redeploy the Render service and verify messages and files remain. Build and unit tests do not substitute for these live-host checks.
