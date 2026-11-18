# Partner sign-in and onboarding

## Becoming a partner

1. A signed-in user fills in **Complete Your Partner Profile** on `/partner/dashboard` (`POST /api/partner/profile`). The shop is created with `isActive: false`, and admins get an email.
2. An admin reviews it in the admin dashboard's Partners view and clicks **Approve** (`PATCH /api/admin/partners/<id>` `{ isActive: true }`), optionally setting the Razorpay Route linked account.
3. Only approved shops appear on the order page, receive orders and can sign in to the Partner apps.

**Deactivate** (same route, `isActive: false`) takes the shop offline and signs out all its devices immediately.

## App sign-in (code + PKCE)

The apps never receive a token in a URL.

```
app                         browser (signed in)                  web API
 │ code_verifier (random)
 │ open /partner/desktop-auth?callback=…&state=…&code_challenge=S256(verifier)
 │──────────────────────────►│ POST /api/partner/device-auth/code
 │                           │◄── one-time code (60 s)
 │◄── callback?code=…&state=…│
 │ POST /api/partner/device-auth/token
 │   { grant_type: authorization_code, code, code_verifier, device_name, platform }
 │◄── { access_token (15 min), refresh_token (30 days), device_id, partner_id }
```

- **Callbacks** allowed: `http://localhost:4321/callback` / `http://127.0.0.1:4321/callback` (desktop), `funprintingpartner://…` (mobile), `exp://` in development only.
- **Access token:** HS256 JWT signed with `PARTNER_JWT_SECRET`: `{ sub, partnerId, did, role, typ: 'partner_access' }`, 15 minutes. Send it as `Authorization: Bearer`; on the socket as `auth.token`.
- **Refresh:** `POST /api/partner/device-auth/token` `{ grant_type: 'refresh_token', refresh_token }`. The refresh token **changes every time**; keep only the newest. Using an old one again signs the device out (it was probably copied), except within 60 seconds of the rotation: that is treated as a retry and answered `409 refresh_in_progress` (keep using the newest token).
- **Apps should** refresh shortly before `expires_in`, and on a 401 refresh once and retry. When the socket closes at token expiry or receives `signed_out`, reconnect after refreshing, or show the sign-in screen.

## Devices

Each sign-in creates a `PartnerDevice` (collection `partner_devices`). Partners see and sign out their apps on the dashboard (**Signed-in apps**; `GET/DELETE /api/partner/devices`). A signed-out device:
- is refused on its next API call (each call checks the device);
- has its socket closed right away (`/api/disconnect-device` on the WSS server), and any socket closes when its 15-minute token expires;
- can't refresh.

The device id in the token is also the device used for print job claims, so `x-device-id` is no longer needed with these tokens.

## Installed apps (legacy tokens)

Apps installed before this change open the sign-in page without `code_challenge` and receive the old 30-day token in the redirect. Those tokens (signed with `NEXTAUTH_SECRET`) keep working on the API and the socket so nobody is locked out. They can't be signed out individually; deactivating the shop still blocks them on the API. Phases 5 and 6 move the apps to the new sign-in, after which the legacy path can be removed.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `PARTNER_JWT_SECRET` | web and WSS (same value) | Signs and verifies app access tokens; at least 32 characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `NEXTAUTH_SECRET` | web and WSS | Still verifies legacy app tokens |
