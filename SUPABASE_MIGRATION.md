# Supabase Migration Guide

This app can use Supabase for **database**, **authentication**, and **storage**. Below is how to migrate and use each feature.

## 1. Database (Postgres)

- **Migrations use `DATABASE_URL` only** — not `SUPABASE_URL` or `SUPABASE_ANON_KEY`. If migrations fail with "can't connect", set `DATABASE_URL` to the Postgres connection string below (it uses your **database password**, not the anon key).
- In [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Settings** → **Database**, copy the **Connection string** (URI).
- Use the **Connection pooling** string (Transaction or Session mode) for the app. For serverless or high concurrency, prefer **Transaction** mode.
- Set in your environment:
  ```bash
  DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
  ```
- Run migrations against Supabase: `bun run db:migrate` (with `.env` pointing to Supabase). Your existing Drizzle schema and migrations are compatible; no code changes required.
- **Optional:** Enable [Row Level Security (RLS)](https://supabase.com/docs/guides/auth/row-level-security) on tables and use the Supabase client from the frontend for some reads; the backend can keep using Drizzle with the same connection.

**Self-hosted Supabase / `ECONNREFUSED` on port 5432**

- The Supabase **API** URL (e.g. Kong at `supabasekong-….sslip.io`) is **not** the Postgres host. The database runs on a different service.
- In the dashboard go to **Database → Settings** and use the **exact connection string** shown there (host, port, database name). If it shows a host like `supabase-db` or an internal hostname, that is only reachable from inside the same network (e.g. same Kubernetes cluster or VPC).
- If Postgres is only reachable from inside the cluster:
  - Run migrations from inside that network (e.g. a K8s Job, or the app container if it runs in the same cluster and can reach the DB service), or
  - Expose the DB (e.g. secure tunnel, or LB with strict firewall) and use that host in `DATABASE_URL`.
- Ensure the host in `DATABASE_URL` is the **database server**, that port **5432** (or the port shown in the dashboard) is open on that host, and that firewalls/security groups allow your client (or app) to connect.

**Connecting via Supavisor (self-hosted, external clients)**

Self-hosted Supabase uses **Supavisor** as the connection pooler. Connect **through Supavisor** instead of directly to Postgres so you don’t need to expose the database itself.

1. **Expose Supavisor**  
   Supavisor must be reachable from your client (laptop, CI, or app server). In Docker Compose, the Supavisor service usually exposes:
   - **6543** – Transaction mode (pooled; good for app and migrations)
   - **5432** – Session mode (one connection per client)  
   Ensure these ports are mapped on the host and that firewalls allow your IP. On Kubernetes, expose the Supavisor service (e.g. LoadBalancer or Ingress for TCP) and use that host/port.

2. **Connection string format**  
   Supavisor requires the **tenant ID** in the username as `postgres.<tenant_id>`:
   ```text
   postgresql://postgres.[POOLER_TENANT_ID]:[POSTGRES_PASSWORD]@[HOST]:[PORT]/[DATABASE]
   ```
   - **Username:** `postgres.[POOLER_TENANT_ID]` (e.g. `postgres.default` or `postgres.your-tenant-id`). The part after the dot is the tenant ID.
   - **Password:** Your database password (same as `POSTGRES_PASSWORD` in the Supabase self-hosted `.env`).
   - **Host / Port:** The host and port where **Supavisor** is reachable (your server IP or Supavisor ingress host; port **6543** or **5432**).
   - **Database:** Usually `postgres`; use your DB name (e.g. `beewisedb`) if you created one.

3. **Where to get `POOLER_TENANT_ID`**  
   In the Supabase self-hosted repo, check the `.env` used by Docker/K8s for `POOLER_TENANT_ID` (or `TENANT_ID`). Default in the official Docker setup is often `default` or `your-tenant-id`. The dashboard (Database → Settings) may also show a connection string that includes this format.

4. **Example**
   ```bash
   # Transaction mode (port 6543) – recommended for app and migrations
   DATABASE_URL=postgresql://postgres.default:AZuQZxCr0TdKKJCcFkKGhnzuMM6m6RSW@16.16.227.107:6543/postgres

   # Or session mode (port 5432) – if your deployment exposes Supavisor on 5432
   DATABASE_URL=postgresql://postgres.default:AZuQZxCr0TdKKJCcFkKGhnzuMM6m6RSW@16.16.227.107:5432/postgres
   ```
   If your database name is `beewisedb`, use `/beewisedb` at the end. If you use a CA cert for TLS, set `DATABASE_SSL_CA_PATH` as before.

## 2. Authentication (Supabase Auth) – implemented

When **Supabase is configured** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), the backend uses **Supabase Auth** only:

- **Backend:** The auth guard verifies the Bearer token with `supabase.auth.getUser(access_token)` and maps the user to `{ id, email, role }` (role from `app_metadata.role`). Only **GET /api/auth/session** is exposed (returns current user). No JWT plugin or login/register/Better Auth routes.
- **Frontend:** Use the app’s `authClient` from `@common/config/auth-client` (Supabase client when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set). Call `authClient.auth.signInWithPassword()`, `signUp()`, `signOut()`, `getSession()`, then send `session.data.session?.access_token` as **Authorization: Bearer &lt;token&gt;** to the API.
- **Admin:** Set `app_metadata.role` to `'admin'` in Supabase (Dashboard → Authentication → Users → Edit user → Raw User Meta Data: `{ "role": "admin" }`).

When Supabase is **not** configured, legacy auth remains: JWT plugin, **POST /api/auth/login**, **POST /api/auth/register**, and Better Auth routes.

## 3. Storage (Practice Recordings)

- The app uses **Supabase Storage** when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise it uses **AWS S3**.
- **Setup:**
  1. In Supabase Dashboard → **Storage**, create a **private** bucket (e.g. `practice-recordings`).
  2. Set env vars:
     ```bash
     SUPABASE_URL=https://xxxx.supabase.co
     SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
     SUPABASE_STORAGE_BUCKET=practice-recordings   # optional; default is practice-recordings
     ```
- Recordings are stored under the path `practice/{userId}/{sessionId}/{recordingId}.wav`. The same path is stored in `practice_recording.s3_key` (column name kept for compatibility).
- No changes to API contracts: the app still returns an upload URL and a download URL; they point to Supabase signed URLs when Supabase is configured.

## 4. Other Supabase Features (Optional)

- **Realtime:** Use Supabase Realtime for live updates (e.g. chat messages, progress). Subscribe from the frontend; the backend can publish via the Supabase client or by writing to the DB if using postgres changes.
- **Edge Functions:** Offload webhooks or heavy AI to Supabase Edge Functions (Deno). The main API can stay on Elysia and call Edge Functions via HTTP.
- **Auth hooks:** Use Supabase Auth hooks (e.g. on sign-up) to sync user data to your `user` table or set `app_metadata.role`.

## 5. Env Summary (Supabase)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Supabase Postgres connection (pooler) for Drizzle |
| `SUPABASE_URL` | Project URL (Auth, Storage) |
| `SUPABASE_ANON_KEY` | Public key for auth client (sign-in/sign-up in browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side key (verify tokens, Storage) |
| `SUPABASE_JWT_SECRET` | Optional; not used when Supabase Auth is on |
| `SUPABASE_STORAGE_BUCKET` | Bucket name for practice recordings |
| `JWT_SECRET` | Only when Supabase is **not** used (legacy auth) |

When using Supabase for storage, you can leave S3 env vars unset (or remove them) unless you still use AWS for other features (e.g. Bedrock).
