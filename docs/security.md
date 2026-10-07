# Security review — Phase 7

Reviewed 7 Oct 2026. The review covered:
- a read-only audit of the whole codebase;
- a dependency scan (`pnpm audit`);
- live probes of the production API and web app.

No critical issue was found, and there was no way to reach another person's documents. All SQL is parameterised. Every invariant in `CLAUDE.md` was checked in code; invariant 10 (email) waits for Phase 5.

## Findings and fixes

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High | **Login limit bypass.** Confirmed live: prepending a fake `X-Forwarded-For` gave every attempt a new "IP". | Trust exactly the measured proxy hops (`TRUSTED_PROXY_HOPS`). Add a second limit per email from any IP. | `auth.integration.test.ts`: spoofed XFF, per-email |
| 2 | Medium | **File swap after submit.** The upload URL stays valid for 10 minutes after submit. | The file is copied to `documents/<workflowId>` and checked there; the upload copy is deleted. | `workflows.integration.test.ts`: "locks the verified file" |
| 3 | Medium | **No security headers on the SPA.** No CSP, and the app could be framed. | `dist/_headers` is generated at build: CSP, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy, HSTS. | Browser check of the production build: no CSP violations across login, upload, view and admin |
| 4 | Medium | **No limits** on change-password, presign, submit or decide. | Per-user limits. | change-password limit test |
| 5 | Medium | **Abandoned uploads never cleaned up.** | The cron tick deletes expired, unsubmitted uploads, file first. | `maintenance.integration.test.ts` |
| 6 | Low | **Session gaps.** Login didn't end an existing session, and password changes weren't atomic. | Login revokes the held session. Password set and change each run in one transaction. | "signing in again ends the session" |
| 7 | Low | **Parser text leaked.** 4xx bodies echoed internal parser messages. | Fixed messages. Errors on 500 carry a request id. | `app.test.ts` |
| 8 | Low | **Query strings in logs.** They can hold names and emails. | The request log has method and path only. Each request gets a server-generated id, returned as `x-request-id`. | `app.test.ts` |
| 9 | Low | **Set-password token left in the URL.** | It is removed from the address bar and history after it is read. | Browser check |
| 10 | Low | **Cookie and guards.** The cookie had no `__Host-` prefix, and the workflow read routes relied on an implicit 401. | `__Host-df_session`, plus explicit `requireUser`. | Existing auth tests |
| 11 | Low | **Unsafe file-name characters.** Bidi-override and control characters were allowed. | They are refused. | Presign test |
| 12 | Low | **Supply chain.** Images and actions were pinned by tag; 3 dev-only advisories. | Pinned by digest and SHA. Overrides for sharp and esbuild; braces ignored with its reason. `pnpm audit` runs in CI. | CI |
| 13 | Info | **Housekeeping.** Expired sessions were never purged, and a trailing `/` in `WEB_ORIGIN` broke writes. | The tick purges sessions over 30 days old. `WEB_ORIGIN` is normalised. | `env.test.ts`, maintenance test |

## Known limitations (accepted)
- **Rate-limit counters are in memory:** they reset when the free Render instance sleeps or redeploys. That is fine for one instance. A shared store such as Redis is needed if the API ever scales out.
- **Session cookie is `SameSite=None`:** the API and web app sit on different sites until the real domain exists. Strict privacy modes in Safari and Firefox may block it. Phase 8 moves both onto one site and switches to `Lax` (D11). Until then, CSRF is blocked by the Origin check and the JSON-only rule.
- **CSP allows `'unsafe-inline'` styles:** Radix positions popovers and sonner injects its stylesheet at runtime. Scripts stay `'self'` only.
- **Older documents keep their `uploads/…` file key:** only documents submitted before this change are affected. Their upload URLs expired long ago, so they cannot be overwritten now.

## Endpoint × permission matrix
The matrix is extended to every endpoint in Phase 7 PR B (tests plus the published table).
