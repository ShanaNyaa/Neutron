This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Web app: Neutron (`web/`)

`web/` is the Neutron web app, a separate React (Vite) + Node (Hono) app for Proton cars that shares the mobile app's Proton mappers. The Expo rules above don't apply to it. See `web/README.md`.

- Run everything through Podman or Docker (`docker compose` takes the same commands), from `web/`. Never install Node packages on the host:
  - `podman compose up`: dev server on http://localhost:5173
  - `podman compose run --rm dev npm install <package>`: add a package
  - `podman compose run --rm dev npm run typecheck`: typecheck. Run it before declaring a web task done.
  - `podman compose --profile prod up -d --build prod`: production build on http://localhost:8080
- The browser can't call Proton directly (no CORS, and MQTT needs a raw TLS socket). All Proton calls go through `web/server/`.
- `web/server/proton/` ports `src/providers/proton/` to Node. It imports `src/providers/proton/mappers.ts`, `format.ts` and `src/core/types.ts` unchanged. After changing those files, run the web typecheck too.
- `web/` is excluded from the root `tsconfig.json` and ESLint config; it has its own `web/tsconfig.json`.
- Keep the server ports bound to `127.0.0.1` and keep the JSON-only and `ALLOWED_HOSTS` checks in `web/server/index.ts`: the app can unlock the car.
- Commands act on a real car. Test the UI with fake responses (Playwright `page.route` on `/api/vehicles/*/commands/*` or `/status`), not by sending commands, unless the user asks for a real one.
- Car condition widgets are listed in `WIDGETS` in `web/client/src/views/ConditionView.tsx`; add a reading there and, if it should show by default, to `DEFAULT_WIDGETS`. Every widget can be small (one slot) or wide (a row), chosen per widget in Customise or with the ⤢ button while arranging; `render` gets the size, and a plain `Tile` lays itself out for either. Layout, sizes, units, picker style and theme live in `web/client/src/prefs.ts` and `theme.ts` (per device, localStorage).
- Status fields Proton sends but nobody has decoded are passed through raw under `experimental` in `web/server/proton/client.ts` and listed in `docs/proton-integration.md`. Decode them there before giving them proper labels.

## Neutron for several people on one server

Built October 2026 (agreed with the owner). Friends (fewer than 5 for now) open the same Neutron
server, each signs in with **their own** Proton Link account and controls **only their own** car.

### How it works
- **Proton login is the Neutron login.** No separate accounts. Signing in with a Proton number and password creates or reuses that person's server-side session, keyed by Proton `userId`.
- **Browser ↔ person:** on sign-in the server issues a random session token in a cookie (`neutron_session`: `HttpOnly`, `Secure` when the page came over HTTPS, `SameSite=Lax`, 30 days). Every `/api/*` request finds the person from that cookie (`resolveUser` in `web/server/index.ts`) and uses **only** their Proton session and `ProtonClient`, kept in a `Map` by `userId`. Nothing falls back to "the" session.
- **Several devices per person:** a second sign-in for the same `userId` replaces that person's stored Proton tokens (Proton allows one session per account) and keeps their other cookies valid. Sign out drops one cookie; the last sign-out also removes the Proton tokens.
- **Who may use the server:** `ALLOWED_PHONES` (comma-separated, any format; compared after `normalizeMsisdn`). Any other number is refused **before** contacting Proton. Five failures per number or address lock sign-in for 15 minutes, and each failure waits a second. Empty means only the first person to sign in (the owner) and people already on the server, so a fresh server is never open to everyone.
- **Tokens at rest:** `web/server/users.ts` encrypts each stored Proton session with AES-256-GCM using `SESSION_SECRET` (required in production; in dev one is generated into `${DATA_DIR}/dev-session-secret`). Layout: `${DATA_DIR}/users/<userId>/session.json.enc`, `commands.jsonl`, and `${DATA_DIR}/cookies.json` (token hashes → `userId`). Proton passwords are never stored.
- **Command log:** `{time, userId, vin, command, result}` per person, shown in Settings (`GET /api/log`).
- **Delete my data:** Settings button (`POST /api/delete-my-data`) removes the person's session, cookies and log.
- **Migration:** a plain `/data/session.json` becomes the first user's encrypted session on startup, flagged `legacy`; the first browser to call `/api/session` claims it and gets a cookie, so the owner needn't sign in again.
- `proton/push-device.ts` tracks its retry back-off per `userId`. The pinned broker certificate chain, `geocode.json` and the scene caches stay shared.
- Also done early from the packaging list: `/api/health`, `HOST`/`PORT`, and a Docker health check in `compose.yaml`.

### Checked with a real account (15 October 2026)
Sign-in, reload keeping the session, a second browser with a non-listed number refused before Proton, the command log filling, Delete my data, and Proton Link signing in on the phone sending the browser back to the sign-in screen with its tokens removed.

### Planned next: packaging
- **GitHub Actions on a tag `web-v*`:** build `web/Containerfile` for amd64 and arm64, push `ghcr.io/shananyaa/neutron-web:<version>` and `:latest`, and create a GitHub Release with notes and a ready `compose.yaml`.
- **Production settings:** `SESSION_SECRET`, `ALLOWED_PHONES`, `ALLOWED_HOSTS` (the public hostname), `TZ`, a configurable listen address and port, and a `/api/health` endpoint for Docker's health check.
- **`web/DEPLOY.md`:**
  - requirements: Docker or Podman; outbound HTTPS to `app-atlas.acotech.my:8443` and `app.acotech.my:8443`, and port 55883 for MQTT
  - HTTPS through Caddy, Traefik or Nginx Proxy Manager, Tailscale, or Cloudflare Tunnel (HTTPS is required to install the app)
  - how to add a friend, update, and back up the data volume

### Things to tell users
- Signing in to Neutron signs that person's Proton Link phone app out (one session per account).
- Proton sees every user from the server's IP address. That's a low risk for a few people, but Proton could block the address, which would affect everyone on the server.
- The server owner hosts everyone's Proton session tokens. Friends should be comfortable with that.
- Neutron uses Proton's private API: unofficial, and it could stop working at any time.

### Decided
- The product name is Neutron, for the mobile app and the web app (renamed from Mottokar, the fork's origin, in October 2026; the mobile app got a new identity, `com.shananyaa.neutron`). Credit to Mottokar by Zackry Rosli stays in the README and both Settings screens.
- Order of work (October 2026): finish the web app and its packaging first, then the Android app, and iOS later. The Apple team ID `PAJK9L7KYM` in `app.json` and the keychain group strings is left over from the fork; replace it with the owner's before any iOS build.
- The `ios/` and `android/` folders are committed. The rename edited them directly; if they drift from `app.json`, regenerate with `bunx expo prebuild --clean` rather than patching further.

### Not decided yet
- Whether display settings (theme, units, layout) should sync per person on the server. Today they're per device in localStorage.
