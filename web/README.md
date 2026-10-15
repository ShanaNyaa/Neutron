# Neutron

Neutron is a web app for Proton Link cars, built on the [Mottokar](https://github.com/zekr89/mottokar)
mobile app. It's a React app plus a small Node server.
The browser can't call Proton directly: Proton's API sends no CORS headers, and command results
arrive over MQTT on a raw TLS socket. So the server signs in to Proton, makes the calls, and
listens for results.

Everything runs in Podman. Nothing is installed on the host.

## Running it

From this folder:

```bash
podman compose up              # dev: http://localhost:5173, reloads on save
podman compose down

podman compose --profile prod up -d --build prod   # production build: http://localhost:8080
```

Checks:

```bash
podman compose run --rm dev npm run typecheck
```

To add a package: `podman compose run --rm dev npm install <package>`.

## Layout

```
server/index.ts         HTTP API (Hono). Serves client/dist in production.
server/users.ts         Per-person Proton sessions (encrypted), sign-in cookies and command logs
server/proton/api.ts    Proton hosts, headers, login and token refresh (port of src/providers/proton/api.ts)
server/proton/client.ts Vehicles, status, commands, trips, inbox (port of src/providers/proton/index.ts)
server/proton/mqtt.ts   Command results over MQTT
client/src/             React app (Vite)
```

The status and trip mappers are imported from the mobile app's `src/providers/proton/` without
changes, so a fix there applies to both apps.

## Themes

Settings → Appearance offers System, Light, Dark, or any of the terminal colour schemes from
[iTerm2-Color-Schemes](https://iterm2colorschemes.com/) (MIT, see
`client/public/themes-LICENSE.txt`). The list is generated into `client/public/themes.json`;
to update it:

```bash
podman compose run --rm dev node scripts/build-themes.mjs
```

## Several people on one server

Each person signs in with their own Proton Link account and sees only their own cars. There are
no Neutron accounts: the Proton sign-in is the sign-in, and a cookie (30 days) ties the browser
to that person's Proton session on the server.

- `ALLOWED_PHONES` lists who may sign in (comma-separated, any format). Any other number is
  refused before Proton is contacted, and five failed sign-ins lock a number or address out for
  15 minutes. Left empty, only the first person to sign in (the owner) may use the server.
- `SESSION_SECRET` encrypts everyone's Proton tokens at rest (AES-256-GCM). It's required in
  production; in dev one is generated into the data volume.
- Signing in on a second device keeps the first one signed in. Proton allows one session per
  account, so signing in to Neutron signs out the Proton Link app on that person's phone.
- Settings shows each person their own command log and offers **Delete my data**, which removes
  their session, sign-ins and log from the server.
- Upgrading from the single-user version: the old `session.json` is encrypted into
  `users/<userId>/session.json.enc` on first start, and the first browser to open the app claims
  it, so the owner needn't sign in again. Open the app yourself straight after upgrading.

Things to tell friends: Proton sees everyone from the server's address and could block it, which
would affect everyone; the server owner holds everyone's Proton session tokens; and Neutron uses
Proton's private API, which could stop working at any time.

## Data and security

- Proton session tokens are kept encrypted in the `data` volume (`users/<userId>/`), with
  sign-in cookie hashes in `cookies.json`. Passwords aren't stored. Sign out in the app, use
  Delete my data, or run `podman volume rm web_data`, to remove them.
- Addresses for trips and the parked car come from OpenStreetMap's Nominatim service, so the
  server sends it those coordinates. Lookups are limited to one a second, as Nominatim asks,
  and each answer is cached in `geocode.json` in the data volume.
- Display preferences (theme, tyre pressure unit, option picker style, and the Car condition
  widgets and their order) are kept in the browser, per device.
- The MQTT broker uses a self-signed certificate. It's saved to the data volume on first use and
  must match after that.
- Ports are bound to `127.0.0.1` because the app can unlock your car. To use it from your phone,
  bind to your LAN address in `compose.yaml` and add that address to `ALLOWED_HOSTS`. Put it
  behind HTTPS (a reverse proxy, Tailscale or a tunnel) before exposing it further; the cookie is
  marked `Secure` whenever the page arrives over HTTPS.
- `HOST` and `PORT` set the listen address; `/api/health` answers for Docker's health check.
- The server rejects requests that aren't JSON or don't come from an allowed host name, so other
  websites can't send commands through your browser.
