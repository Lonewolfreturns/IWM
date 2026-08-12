# WasteWise — Product Requirements Document

_Last updated: 2026-02-28_

## 1. Vision
A frontend-only, production-grade Food Wastage Analytics Platform targeting
Canadian restaurants, cafeterias and food businesses. World-class dark
analytics UI that impresses enterprise clients and government sustainability
officers.

## 2. Tech stack (frozen)
- React 18 + Vite 8 (migrated from CRA per user request)
- Tailwind CSS v3
- React Router v6
- Recharts for all charts
- Axios for API calls (mock data only)
- shadcn/ui primitives + custom components
- Framer Motion for page/element animation
- Lucide React for icons
- TanStack Query (React Query) for data fetching
- Sora (display) + DM Sans (body) from Google Fonts

## 3. User personas
- **Client (restaurant manager)**: tracks daily waste, reviews trends,
  generates reports, configures alerts.
- **Admin (WasteWise ops)**: manages the fleet of scales across Canada,
  assigns clients, oversees data integrity.

## 4. Core requirements (static)
- Dark navy theme (#0F172A bg, #1E293B cards, #38BDF8 accent, #22C55E success,
  #F59E0B warning, #EF4444 danger).
- Glassmorphism cards with backdrop-blur and border opacity.
- Subtle gradient mesh + noise on main layout.
- Smooth Framer Motion page transitions (fade + slide-up).
- Recharts with custom dark theme + dark tooltips.
- Micro-animations on stat cards (count-up).
- Sidebar with active item glow, collapsible at md/sm.
- Canadian 🍁 motifs near "Canada" labels and inside the logo.
- Fully responsive: mobile (320–767), tablet (768–1023), desktop (1024+).
- Min 44px tap targets, WCAG-AA contrast, keyboard navigation, focus rings.
- Lazy-loaded routes, reduced-motion respected.

## 5. What's implemented (2026-02-28)
- Vite migration (`yarn start` now runs Vite on :3000 for supervisor).
- Google Fonts (Sora + DM Sans) loaded via `index.html`.
- `src/data/mockData.js` — 12 users (ALL_USERS), 12 scales, 8 alerts, 25 system
  logs, 12 months of trend, 10 reports, 5 research reports, 4 datasets, pie/
  bar/heatmap/radar data.
- `src/services/{api,auth,scales,analytics}.js` — full mock service layer with
  realistic latency.
- Login page (`/login`) with role pills, demo shortcut buttons, floating food
  icon animation, glassmorphism card.
- Protected routing + admin guard for `/scales`, `/users`, `/data-config`,
  `/system-logs`, `/research`.
- `MainLayout` with fixed sidebar (240px desktop / 80px tablet / drawer mobile)
  and fixed 64px navbar (search + notifications + user dropdown).
- Dashboard: 4 stat cards (count-up + sparkline), Daily Waste Trend line,
  Category donut, Peak Hours bar, Recent Alerts table, Quick Scale Status.
- Analytics: date range, location/scale/category filters, monthly comparison
  bar, 12-month reduction line w/ goal threshold, custom CSS heatmap,
  scale-performance radar.
- Reports: weekly/monthly/custom tabs, downloadable cards w/ toasts, custom
  report builder (date + metrics + format + generate).
- Scale Management (admin): stats row, sortable searchable paginated DataTable,
  add/edit modal, delete-confirm modal.
- **User Management (admin):** stats row, search + role/status filters,
  paginated DataTable (12 users), Add/Edit modal with auto-generated
  password + invite toggle, toggle status, delete confirmation.
- **Data Configuration (admin):** 4 sections — Waste Thresholds (6 categories
  with daily/weekly + alert toggle), Data Collection (frequency, retention,
  auto-export, export time), Alert Configuration (email/SMS/Slack + severity),
  Organization (name/industry/Canada🍁/timezone/CAD).
- **System Logs (admin):** 4-stat row, search + level + date filters, 25-entry
  table with colored level badges, Details modal with syntax-highlighted JSON
  + Copy + Close, 20/page pagination, Export Logs toast.
- **Research Tools (admin):** Dataset Explorer (4 datasets, preview table,
  org pills, CSV/JSON export), Comparative Analytics (up to 3 orgs with bar +
  12-month line chart), Research Reports (5 cards × PDF/CSV), Raw API Access
  (endpoints, masked key + copy/regen w/ confirm modal, syntax-highlighted
  code snippet w/ copy).
- Settings: Profile (avatar upload), Notifications (5 toggles), API Config
  (masked key + copy + regenerate), Organization (Canada 🍁 pre-selected).

## 6. Backlog
- **P1**: Wire dashboard to live backend; persist user preferences server-side.
- **P1**: Real authentication (JWT or Google OAuth).
- **P1**: User Management screen + RBAC editing (currently routes show toast).
- **P2**: Data Configuration / System Logs / Research Tools pages.
- **P2**: Real CSV/PDF generation for the Reports builder.
- **P2**: i18n (English / French Canadian).
- **P3**: Drill-down from heatmap cells into hourly detail page.
- **P3**: Realtime WebSocket scale telemetry.

## 7. Next tasks
1. Validate the build with the testing agent (P0).
2. Wire a real backend (FastAPI + Mongo) when the user decides.
3. Add User Management page (admin) — currently stubbed with toast.
