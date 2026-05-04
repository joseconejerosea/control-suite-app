# M5 Frontend — Drop-in Files for Control Suite

## How to install

1. Extract this zip
2. Copy ALL folders/files into your `frontend/` directory, **replacing** existing files
3. Run: `npm install` (no new dependencies needed — uses what's already installed)
4. Run: `npm run dev`

## What's included (all new or updated)

### New: lib/
- `lib/api.ts` — fetch-based API client, handles JWT + cookies for middleware

### Updated: components/layout/
- `sidebar.tsx` — full M5 navigation with role-based filtering
- `topbar.tsx` — dynamic page titles + sign out
- `app-shell.tsx` — updated wrapper

### New: components/
- `CrudTable.tsx` — reusable CRUD table with search, modals, badges
- `DashboardShared.tsx` — KPI cards + bar charts (no extra deps)

### Updated: app/
- `globals.css` — dark brand theme (red #C8202C / green #2a9d5c / navy #12131a)
- `(auth)/login/page.tsx` — professional split-panel login
- `admin/dashboard/page.tsx` — KPI dashboard
- `admin/onboarding/page.tsx` —  NEW: 5-step F0 onboarding flow

### New: app/client/
- `dashboard/page.tsx` — client dashboard
- `projects/page.tsx` — Projects CRUD
- `locations/page.tsx` — Locations CRUD
- `promoters/page.tsx` — Promoters CRUD
- `campaigns/page.tsx` — Campaigns CRUD
- `documents/page.tsx` — AI document ingestion (upload → parse → preview → populate)
- `collaborators/page.tsx` — Collaborators CRUD

### Updated:
- `middleware.ts` — handles super_admin → /admin, admin_cliente/user → /client

## Routes

| Path                  | Role           | Description           |
|-----------------------|----------------|-----------------------|
| `/login`              | Public         | Login screen          |
| `/admin/dashboard`    | super_admin    | Admin KPI dashboard   |
| `/admin/onboarding`   | super_admin    | F0 client setup       |
| `/client/dashboard`   | client roles   | Client KPI dashboard  |
| `/client/projects`    | all            | Projects CRUD         |
| `/client/campaigns`   | all            | Campaigns CRUD        |
| `/client/locations`   | all            | Locations CRUD        |
| `/client/promoters`   | all            | Promoters CRUD        |
| `/client/documents`   | all            | AI document ingestion |
| `/client/collaborators` | admin_cliente | Collaborators CRUD   |

## API
All calls go to `http://localhost:3000/api/*` (NestJS backend must be running on port 3000).

## Video demo order
1. `npm run start:dev` (NestJS) + `npm run dev` (frontend) — show both terminals
2. Login as super_admin → /admin/dashboard
3. Go to /admin/onboarding → complete all 5 steps
4. Logout → login as the new admin_cliente
5. Show /client/dashboard KPIs
6. Create: 1 project, 2 locations, 2 promoters, 1 campaign
7. Go to /client/documents → upload CSV → parse → preview → populate
8. Back to dashboard → show KPIs updated
9. Logout → login as `user` role → show limited nav (demo of role-based access)
