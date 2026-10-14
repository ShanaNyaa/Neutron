# Mottokar web

A browser version of Mottokar for Proton Link cars. It's a React app plus a small Node server.
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

## Data and security

- Your Proton session tokens are kept in the `data` volume (`session.json`). Your password
  isn't stored. Sign out in the app, or run `podman volume rm web_data`, to remove them.
- Addresses for trips and the parked car come from OpenStreetMap's Nominatim service, so the
  server sends it those coordinates. Lookups are limited to one a second, as Nominatim asks,
  and each answer is cached in `geocode.json` in the data volume.
- Display preferences (theme, tyre pressure unit, option picker style, and the Car condition
  widgets and their order) are kept in the browser, per device.
- The MQTT broker uses a self-signed certificate. It's saved to the data volume on first use and
  must match after that.
- Ports are bound to `127.0.0.1` because the app can unlock your car. To use it from your phone,
  bind to your LAN address in `compose.yaml` and add that address to `ALLOWED_HOSTS`. Don't
  expose it to the internet: there's no login of its own.
- The server rejects requests that aren't JSON or don't come from an allowed host name, so other
  websites can't send commands through your browser.
