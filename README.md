# Neutron

An iOS and Android app for controlling connected cars: lock and unlock, remote start, climate, find the car, and read its status. It talks to each brand's own backend with the account you already use in the brand's app.

There's also a web version for Proton cars in `web/`: a React app with a small Node server, run with Podman or Docker, that several people can share. The web app is the current focus; Android comes next and iOS later.

Neutron began as a fork of [Mottokar](https://github.com/zekr89/mottokar) by Zackry Rosli, which is the origin of the mobile app. The web version is added here.

Brands:

- **Proton Link 2.0** (Proton X50, X70, S70 and other Atlas-based cars). Complete.
- **Honda CONNECT One**. Listed as coming soon; no backend work yet.
- **Demo**. A fake car for trying the app without an account.

Beyond the app itself, on iOS it adds:

- Home Screen widgets, a Lock Screen widget, and Control Center controls.
- Siri and Shortcuts actions ("Lock my car with Neutron").
- A Live Activity that tracks each command from phone to cloud to car, on the Lock Screen, Dynamic Island and CarPlay.

## Running it

Requires Bun, Xcode for iOS, Android Studio for Android. The app needs a development build: it uses native modules that Expo Go doesn't bundle.

```bash
bun install
bunx expo run:ios        # or: bunx expo run:android
bunx expo start          # the dev server, once a build is installed
```

### Web version

Needs only Podman or Docker (`docker compose` takes the same commands); Node and the npm packages stay inside the containers. From `web/`:

```bash
podman compose up                                  # dev, http://localhost:5173
podman compose --profile prod up -d --build prod   # production, http://localhost:8080
podman compose run --rm dev npm run typecheck
```

See `web/README.md` for how it works and what it stores.

Checks:

```bash
bunx tsc --noEmit
bunx expo lint
```

The `ios/` and `android/` folders come from `bunx expo prebuild` with `app.json` and the plugins in `plugins/`, and are committed. Change `app.json` or a plugin and regenerate rather than editing them by hand.

## Layout

```
src/app/          Expo Router screens. Tabs: Car, Inbox, Connections, Settings.
src/core/         What the app knows about a car, independent of brand: types,
                  the ProviderDefinition contract, connections, secure storage.
src/providers/    One folder per brand. A provider signs in, lists vehicles,
                  reads status and sends commands. Registered in index.ts.
src/components/   UI. controls.tsx is the command grid; sheet.tsx the bottom sheet.
src/lib/          Confirmation and PIN flow, notices, logging, formatting.
src/widgets/      Widgets and the Live Activity, written in JSX for expo-widgets.
plugins/          Config plugins. with-car-intents.js copies the Swift under
                  plugins/native/ into the app and widget extension.
plugins/native/   Swift for Shortcuts, Control Center and the widgets' buttons,
                  which run without the JS runtime. ProtonCarClient.swift is the
                  Proton provider again, in Swift, for that path.
docs/             Notes from reverse engineering Proton Link.
web/              Browser version (React + Node), run with Podman or Docker. See web/README.md.
```

## Adding a brand

1. Add `src/providers/<brand>/index.ts` exporting a `ProviderDefinition` (see `src/core/provider.ts` for the contract and `src/providers/proton/` for a full one).
2. List it in `src/providers/index.ts`.
3. For Shortcuts and Control Center support, add a `CarClient` in `plugins/native/<Brand>CarClient.swift`, list it in `NeutronBrands.swift`, and add both file copies to `plugins/with-car-intents.js`. Without this the brand still works in the app and its widgets open the app.

## Proton

`docs/proton-integration.md` documents the Proton Link backend as found by decompiling the Android app: hosts, login, the status payload and what its codes mean, the command service keys, the PIN scheme and the MQTT result channel. The OpenAPI files beside it index the endpoints.

## Licence

GPL-3.0. See `LICENSE`.
