# Proton Link backend

From decompiling Proton Link 2.1.0 (`cn.com.ecarx.protonlink_2.1.0.apk`) with jadx.
App code is under `cn/com/ecarx/`, the Atlas SDK under `com/malaysia/acosdk/`; class
names below refer to that output. `protonlink_2.1.0_openapi.json` in this folder indexes
the endpoints. Where it disagrees with the decompiled code, the code is right; the
differences are noted.

## Hosts

Two backends, three HTTP clients. Production is on `acotech.my`.

| Client | Used for | Production base URL | Auth header |
|---|---|---|---|
| Legacy app API (`lib_http`, `ConfigKt.defaultConfig`) | login, user, messages, most `/app/v1/*` | `https://app.acotech.my:8443/` | `AUTHORIZATION: <token>` |
| AcoApi (`module_base/api/AcoApi`) | `/bigdata/*` trips and geofences, some Atlas calls | `https://app-atlas.acotech.my:8443` | `AUTHORIZATION: Bearer <token>` |
| acosdk (the Atlas SDK) | `/iot/function/*`, `/basic/*`, push and MQTT | `https://app-atlas.acotech.my:8443/` | `Authorization: Bearer <token>` |

Atlas hosts (`EnvInternalConfig`, tenant `acotech`):

- DEV `https://qaapp-atlas.acotech.my:50012/`
- UAT `https://uatapp-atlas.acotech.my:60012/`
- PROD `https://app-atlas.acotech.my:8443/`

Legacy hosts (`ApiConfig`): PROD `app.acotech.my:8443`, QA `:50011`, `ApiConfig.HOST`
`:50012`, UAT `appuat.acotech.my:60033`, TEST `218.60.53.133:50010`.

The app picks the environment from the port in its stored `baseUrl`: `8443` is PROD,
`60033` is TEST/UAT, anything else is DEV.

## Authentication

- Login is by password. SMS codes are used to register, reset the password and bind a
  phone.
- The password is sent as lowercase hex `MD5(password)`, with no salt.
- One token for both backends: the legacy login's `accessToken` is sent to Atlas as
  `Bearer <accessToken>`.
- Requests aren't signed. `REQUEST-ID` is a random UUID without dashes. `appSecret` is
  used only by the push SDK to encrypt the device registration.

### Login

`POST app/v1/member/login` (`module_user/service/HttpServices`), body built in `UserModel`:

```json
{ "mobilePhone": "<msisdn>", "password": "<md5 hex, lowercase>",
  "type": "1", "clientType": "phone", "deviceId": "<push device id>" }
```

`type` and `clientType` are hardcoded; `deviceId` comes from `AcoPush.getDeviceId()`. The
legacy `HeaderInterceptor` sends an empty `AUTHORIZATION` header on this request.

The response is `ApiResult<LoginEntity>`:

```json
{ "userId": "str", "accessToken": "str", "expiresIn": "str",
  "refreshToken": "str", "clientId": "str" }
```

`expiresIn` is a string.

Third-party login is `POST app/v1/member/thirdPartyLogin` with
`{thirdPartyType, openId, clientType, deviceId}`, and returns the same `LoginEntity`.

### Tokens

After login (`AccountViewModel`) the app does:

```
UserModel.updateToken(accessToken, refreshToken)  // saved to SPUtils LAST_TOKEN / REFRESH_TOKEN
AcoMobileSdk.INSTANCE.setUserToken(accessToken)    // the Atlas SDK's token
```

The SDK is also initialised from the same `LAST_TOKEN` on launch. The MD5 password is
cached in SPUtils as `password`.

A client needs one login: send the `accessToken` as `AUTHORIZATION: <token>` to the
legacy API and as `Authorization: Bearer <token>` to Atlas.

### Refresh

The app never checks `expiresIn`. `TokenRefreshInterceptor` looks at every response body
instead, and treats `ApiResult.code == "40006"` as an expired token. It then calls
`POST app/v1/member/tokenRefresh` (`CustomServices`) and retries the original request with
the new token.

```json
{ "userId": "str", "refreshToken": "str", "clientType": "phone", "deviceId": "str" }
```

The response is `TokenEntity`:

```json
{ "userId": "str", "accessToken": "str", "expiresIn": "str" }
```

No new refresh token comes back. The refresh request is excluded from the bearer-header
injection.

### SMS codes and captcha

These are for register, reset password and bind phone only.

- Send a code (v1): `GET app/v1/member/common/verificationCode?mobilePhone=&purpose=`
- Send a code (v2, needs a captcha):
  `GET app/v2/member/common/verificationCode?mobilePhone=&purpose=&deviceId=&graphicalCode=`
- Check a code: `POST app/v1/member/common/verificationCode` (form body)
- `purpose` is `"reg"` or `"reset-pwd"`.
- Captcha: `GET app/v2/member/common/getGraphicalCode?deviceId=&purpose=` returns
  `ApiResult<Map<String,String>>` whose value is a base64 image. What the user types goes
  into the v2 send call as `graphicalCode`.

Bodies (`UserModel`), with every password MD5'd as above:

- Register: `{mobilePhone, password, invitationCode, verificationCode}`
- Reset: `{mobilePhone, newPassword, verificationCode}`
- Change: `{mobilePhone, newPassword, oldPassword}`

### Headers

Atlas SDK (`VehicleHeaderProvider.getHeaders()`), 14 headers and no signature:

| Header | Value | Proton value |
|---|---|---|
| `ACCEPT-LANGUAGE` | locale language | `en` (locale defaults to `en_MY`) |
| `VERSION-NAME` | app versionName | |
| `VERSION-CODE` | longVersionCode | |
| `X-EQUIPMENT-TYPE` | equipmentType, else appId | `Proton_Link` |
| `X-EQUIPMENT-BRAND` | `Build.BRAND` | |
| `X-EQUIPMENT-MODEL` | `Build.MODEL` | |
| `X-EQUIPMENT-OS-VERSION` | `Build.VERSION.RELEASE` | |
| `X-AGENT-VERSION` | `Build.VERSION.SDK_INT` | |
| `Authorization` | `Bearer <token>` | the login `accessToken` |
| `Content-Type` | `application/json` | |
| `CLIENT-ID` | clientId | `android` |
| `TENANT-ID` | appId | `acotech` |
| `APP-NAME` | appName | `Proton Link` |
| `REQUEST-ID` | UUID without dashes | new per request |

AcoApi (`AcoApi.getHeaders()`) starts from the legacy headers and overrides
`X-EQUIPMENT-TYPE: Proton_Link`, `CLIENT-ID: android`, `TENANT-ID: acotech`,
`APP-NAME: Proton Link` and the `X-EQUIPMENT-BRAND/MODEL/OS-VERSION` trio. Its interceptor
adds `AUTHORIZATION: Bearer <token>`.

Legacy (`module_base/api/Header.buildHeader()`): `X-AGENT-TYPE: android`,
`Accept-Language: en`, `Connection: close`, `APP-NAME: Proton Link`, `Version-Name`,
`Version-Code`, `X-APP-ID: protonlink_01`, `X-EQUIPMENT-TYPE: proton link`,
`X-AGENT-VERSION: <SDK_INT>`, `Content-Type: application/json`. `HeaderInterceptor` adds
`AUTHORIZATION: <token>` without `Bearer`.

### Tenant constants

Hardcoded in `ApplicationVM` (production branch of the env switch):

- `appId` / `TENANT-ID`: `acotech`
- `appName` / `APP-NAME`: `Proton Link`
- `equipmentType` / `X-EQUIPMENT-TYPE`: `Proton_Link`
- `clientId` / `CLIENT-ID`: `android` (SDK default)
- locale: `en_MY` (SDK default)
- `appSecret`: PROD `eG[llZO)N0vw2+,%A&6KHX`, DEV/UAT `KrRn@{dn#%&BdOvi@!=9$@`. Only used
  to encrypt push device data, never for HTTP.
- `mqPassword`: PROD `Y7ZlUtuG)YDiNMF_BzjpnpCb[VtH#Tf[`, others
  `8u8yK"bc,].a3l'>w?e;@_A%.vKWh}?6`. The MQTT password (see MQTT below).

## Vehicles

Response envelopes:

- Atlas: `ApiResult{code: int, data: T, msg}`. `isSuccess` is computed from `code == 200` and
  not sent.
- Legacy: `ApiResult{code, msg, exceptionCode, currentPage, pageSize, totalNum, totalPage,
  data}`. The Java field is `originData` but the JSON key is `data`.

The OpenAPI index lists `originData` and `isSuccess` as wire fields; neither is.

### Atlas

- List: `GET basic/user/vehicle/list`, no parameters (the user comes from the token),
  returns `VehicleInfo[]`.
- Set default: `POST basic/user/vehicle/default` with `{"status": true, "vin": "<VIN>"}`.
  `status` is always `true` and there's no `userId`.
- Capabilities: `GET basic/ability/vehicle/{vin}` returns `CapabilityEntity[]`.

`VehicleInfo` keys, all nullable except `vin`: `userId, vin, customPlateNo, plateNo,
vehicleModelUrl, bindType, shareStartExpire (Long), shareEndExpire (Long), isDefault
(bool), setPinStatus (bool), vehicleName, enablePin (bool), matCode, matName, modelCode,
modelName, brandCode, brandName, bodyColorCode, topColorCode, interiorColorCode,
controlPinLockStatus (bool), enablePinLockStatus (bool)`.

`CapabilityEntity` is a tree: `{abilityValue: AbilityValue[], itemCode, itemName, child:
CapabilityEntity[]}`, with `AbilityValue{name, type, value, abilityCode?}`. The app
flattens one level (`response.flatMap { it.child }`) and matches the leaf `itemCode`s
against the `Capability` sealed class, which has 71 cases. For example Flash/FindCar is
`A001X001Y001-RHL` and LockDoor is `A001X001Y010-RDU` or `A001X001Y015-RDU`.

If no vehicle comes back with `isDefault: true`, the app makes the first one the default
and saves that with the set-default call. Both backends' code paths do this.

### Legacy

- List: `GET app/v1/vehicle?userId=&onlySearchDefault=&isPage=` (the flags default to
  false) returns `VehicleInfo[]`.
- Set default: `POST app/v1/vehicle/default` with `{"userId": "<id>", "vin": "<VIN>"}`.
- Capabilities: `GET app/v1/vehicle/capability/service/app?userId=&vin=` and
  `.../service/function`, both returning `data.list`.

The legacy `VehicleInfo` has `vin, modelCode, isDefault (bool), res (Int?), brandCode,
modelName, userColorId, userColorName, colorCode, colorName, matCode, matName, seriesName,
seriesCode, isCheck (UI only), msisdn, userPlateNum, plateNum, carResourcePath?,
imageUrl?, engineNo?, colorId`. The plate fields are named differently from Atlas
(`plateNum`/`userPlateNum` vs `plateNo`/`customPlateNo`), `seriesName`/`seriesCode` exist
only here, and `vehicleName` only in Atlas.

The vehicle manager screen that ships uses the Atlas set-default call, not the legacy one.

## Status and position

### Atlas

- Status: `POST iot/function/getVehicleStatus` with `{"vin": "<VIN>"}`, returns
  `VehicleStatus`.
- Position: `POST iot/function/getVehiclePosition` with `{"vin": "<VIN>"}`. This is a
  command, not a query: it returns `CommandResponse{requestId, timestamp, vin}` and goes
  through the command pipeline. When it completes, `getVehicleStatus` carries the new
  `latitude`, `longitude`, `altitude` and `marsCoordinates`. Read the position from
  `getVehicleStatus`.

Every `VehicleStatus` field is nullable. JSON keys match the Java field names except for
these renames:

- `transimissionGearPostion` → `transmissionGearPosition` (the field name is misspelt, the
  key isn't)
- `distanceToEmptyOnBattery100Soc` → `fullChargeRange`
- `airBlowerActive` → `airBlowerActiveString`
- `defrostActive` → `defrostActiveString`

Fields by group (String unless noted):

- Meta: `vin`, `updateTime` (Long), `time`, `usageMode` (Int)
- Position and motion: `latitude`, `longitude`, `altitude`, `marsCoordinates` (GCJ-02
  flag), `direction`, `speed`, `speedValidity`, `avgSpeed`
- Engine and drive: `engineStatus`, `engineSpeed`, `transimissionGearPostion`,
  `handBrakeStatus`, `electricParkBrakeStatus`
- Energy and range: `fuelLevel`, `distanceToEmpty` (Int), `distanceToEmptyOnBatteryOnly`
  (Int), `distanceToEmptyOnBattery100Soc` (Int), `powerBatteryLevel` (Float),
  `stateOfCharge`, `aveFuelConsumption`, `aveTraFuelConsumption`, `averPowerConsumption`
  (Float), `averTraPowerConsumption` (Float)
- Odometer and service: `odometer`, `odometerOnFuelOnly`, `odometerOnBatteryOnly`,
  `distanceToService`, `daysToService`
- Charging: `chargerState` (enum, int on the wire), `chargeSts`, `chargeHvSts`,
  `bookChargeSts`, `chargingStartTime`, `timeToFullyCharged` (Int), `isPluggedIn`,
  `statusOfChargerConnection` (Int), `dcDcConnectStatus` (Int), `dcOrAcDcChargeLidStatus`
  (Int), `chargeUAct`, `chargeIAct`, `dcChargeUAct`, `dcChargeIAct` (Float),
  `acChargePower`, `dcChargePower` (Int), `wptChargeIAct`, `wptChargeSts`,
  `disChargeConnectStatus`, `disChargeSts`, `disChargeUAct` (Float)
- Battery thermal: `bcCycleActive`, `bcTempActive`, `btActive`, `btHvFaultActive`,
  `btPreBatteryPackHeatStatus`, `btPreChargeStatus`
- Doors: `doorOpenStatus{LeftFront,LeftRear,RightFront,RightRear}` (Int),
  `doorLockStatus{...}` (Int), `centralLockingStatus` (Int)
- Trunk and hood: `trunkOpenStatus`, `trunkLockStatus`, `engineHoodOpenStatus` (Int)
- Windows: `winStatus{LeftFront,LeftRear,RightFront,RightRear}` (Int), `winPos{...}`
  (Int), `winStatusDriverValidity`, `winStatusPassengerValidity`,
  `winStatusDriverRearValidity` (Int), `winCloseReminder`, `ventilateStatus` (Int)
- Roof: `sunroofOpenStatus` (Int), `sunroofOpenStatusValidity`, `curtainOpenStatus` (Int,
  the sunshade)
- Climate: `preClimateActive` (`"true"`/`"false"`), `airConditionTemperature` (Float),
  `airConditionTime`, `airBlowerActive`, `defrostActive`, `interiorTemp`, `exteriorTemp`,
  `exteriorTempValidity`, `drvVentSts`, `passVentSts`, `drvVentDetail` (Int),
  `passVentDetail` (Int), `passHeatingSts`
- Tyres: `tyreStatus{...}` (Float, pressure), `tyreTemp{...}`, `tyrePreWarning{...}` (Int)
- Seat belts: `seatBeltStatusPassenger`, `seatBeltStatusPassengerRear`

What the values mean, from the helpers in `VehicleStatus.java`:

- `doorOpenStatus*`: 2 is closed, anything else open.
- `doorLockStatus*`: 2 or 3 is locked, anything else unlocked.
- `trunkOpenStatus`, `engineHoodOpenStatus`, `dcOrAcDcChargeLidStatus`: 2 is closed.
  `trunkLockStatus`: 2 is locked.
- `winStatus*`, `sunroofOpenStatus`, `curtainOpenStatus`: 0 is closed.
  `tyrePreWarning*`: 0 is normal.
- For all of the above, null means normal.
- Ventilation is on when `ventilateStatus == 1` or all four `winPos*` are 8.
- `centralLockingStatus`: null, 0 or 1 is not locked, anything else (about 2) is locked.
  When present it takes precedence over the per-door locks. The meaning of 1 is unknown.
- The engine is on when `engineStatus == "0"`.
- `bookChargeSts == "1"` means a charge booking is active.
- `chargerState`: 0 DEFAULT, 1 NOT_CHARGING, 2 AC_CHARGING, 3 AC_CHARGING_STOPPED,
  4 AC_CHARGING_COMPLETED, 5 AC_HEATING, 6 AC_APPOINTMENT_IN_PROGRESS, 15 DC_CHARGING,
  18 DC_ERROR, 24 DC_FAST_CHARGING, 25 AC_CHARGING_USER_STOPPED, 26 DC_CHARGING_STOPPED,
  27 AC_ERROR, 28 DC_BOOST_CHARGING, 30 WIRELESS_CHARGING, anything else OTHER (-1). The
  app counts 2, 5, 15, 24, 28 and 30 as charging.

The app clamps some values for display (`MainStatusUtils`): `distanceToEmpty` 0–999,
`fuelLevel` 0.5–172, `powerBatteryLevel` 1–10000, `odometer` 0–1000000,
`aveFuelConsumption` 0.1–19.9, `avgSpeed` 0–254.

Unknown: `usageMode`, `winPos*` (only 8 is decoded), `drvVentDetail` and
`passVentDetail` (only 3 is decoded), the `tyreStatus*` unit, `direction`, and the gear
position values.

#### Fields the server sends but Proton Link doesn't read

The list above comes from `VehicleStatus.java`, so it only covers what the app reads. A live
`getVehicleStatus` response for a parked 2025 S70 (October 2026) also carried these keys,
which are in neither the app nor the OpenAPI index:

| Key | Seen | Meaning |
|---|---|---|
| `voltage` | `13` | 12V battery voltage, in volts. A healthy resting battery reads about 12.4–12.8 and a running engine 13–14.5. The capability list has a matching "Low voltage warning" item (`A001X005Y002`). |
| `engineOilPressureWarning` | `0` | Oil pressure warning, 0 = OK. Capability item "Oil Pressure Warning" (`A001X003Y021`). |
| `engineCoolantTemperature`, `…Validity` | `1.31`, `0` | Coolant temperature; validity 0 means not valid (engine off). Unit unconfirmed. |
| `seatBeltStatusDriver`, `…Passenger`, `…LeftFront`, `…RightFront` | `0` | Seat belt state. The values aren't decoded. |
| `transimissionGearPostion` | `1` | Gear position, with the same misspelt key as the documented one. 1 while parked, probably P; other values unknown. |
| `powerMode`, `powerSource` | `1`, `0` | Ignition and power state. Not decoded. |
| `brakePedalDepressed`, `…Validity` | `0`, `1` | Brake pedal pressed. |
| `engineSpeed`, `…Validity`, `speed` | `0` | Live engine speed and road speed. |
| `aveFuelConsumptionInLatestDrivingCycle` | | Average consumption over the last drive. |
| `posCanBeTrusted`, `carLocatorStatUploadEn` | `true` | The position fix is good; location upload is on. |
| `latitudeOriginal`, `longitudeOriginal` | | The position before any datum shift (see `marsCoordinates`). |
| `taskId`, `requestId`, `lastUpdate` | | The request that produced the report, and when the server stored it (ms). |

`distanceToService` read `0` on that car. Mobile Mottokar treats 0 as "no interval set"
(the car reports it after a service until the next interval is programmed); another
third-party app shows it as "Service overdue". Which is right isn't known. The web app
shows it as reported.

`app/v1/vehicle/realtimeData` (legacy, above) answered "Parameter error" with `envType`
empty, `prod` or `PROD` and `appId=protonlink_01`, so its nested maintenance section
couldn't be checked.

### Legacy (unused in 2.1.0)

Nothing in 2.1.0 calls these.

- `GET app/v1/vehicle/realtimeData?userId=&vin=&envType=&appId=` returns
  `ApiResult<CarStatus>`, which is deeply nested: `result.serviceResult.operationResult`,
  `result.sessionId`, and a `vehicleStatus` with `basicVehicleStatus`,
  `additionalVehicleStatus` (climate, driving safety, EV, maintenance, running, driving
  behaviour and pollution) and `updateTime`. Positions are Driver/Passenger rather than
  Left/Right; mapping them to Left/Right assumes a right-hand-drive car.
- `GET app/v1/vehicle/parkingStatus?userId=&vin=&envType=` returns
  `{"parkingStatus": <int>}`.
- `GET app/v1/vehicle/capability/signal?userId=&vin=&itemType=` returns a
  `CapabilityEntity`. The app checks `A001X003Y006` (sunroof) and `A001X003Y016` (windows)
  against the Atlas capability list.

## Remote commands

### Endpoints

All in `acosdk/rvc/impl/VehicleControllerHttpService`:

- `POST iot/function/vehicleControl`: `CommandRequest` body, returns
  `ApiResult<CommandResponse>`.
- `POST iot/function/vehicleControl/sendJou`: same body, for the trip log.
- `POST basic/vehicle/checkPinCode`, `setPinCode` and `basic/user/vehicle/pinEnable`: map
  bodies (see PIN below).
- `POST basic/sms/sendCode` and `basic/sms/checkCode`: map bodies.

A mock host, `http://192.168.2.254:4523/...`, is also defined.

### Request body

`CommandRequest`:

```jsonc
{
  "serviceKey": "RCE-ON",       // required
  "vin": "<VIN>",               // the default vehicle
  "scheduledTime": 1699999999,  // epoch, or null
  "endTime": 1699999999,        // or null
  "duration": 600,              // seconds (minutes for engine start), or null
  "parameters": [{ "key": "rce.temp", "stringVal": "22" }],  // or null
  "timerData": { "timerInfoList": [/* TimeInfo */], "timerId": null }
}
```

The PIN isn't in the body; it's checked by a separate call first. Each `parameters` entry
is `{"key": <string>, "stringVal" | "intVal" | "boolVal": <value>}`.

The response is `CommandResponse{requestId, timestamp?, vin?}`. `requestId` is what the
MQTT result is matched against.

### Service keys

From `RvcKtxKt.toRequest`. Every command has a timeout (40 s by default), and the app waits
that long for the result.

| Command | serviceKey | Extra fields |
|---|---|---|
| Lock / unlock | `RDL-OFF` / `RDU-ON` | |
| Horn and lights / lights only | `RHL-HornAndLight` / `RHL-LIGHT` | |
| Open / close windows | `RWS-ON` / `RWS-OFF` | |
| Open / close ventilation | `RWS-BreathableON` / `RWS-OFF` | |
| Open / close sunroof | `RWS-SunroofON` / `RWS-SunroofOFF` | |
| Open / close sunshade | `RWS-SunshadeON` / `RWS-SunshadeOFF` | |
| Lock / unlock trunk | `RDU-TargetOFF` / `RDU-TargetON` | |
| Unlock frunk | `RLU-TargetON` | |
| Engine on / off | `RES-Engine-ON` / `RES-Engine-OFF` | `duration` in minutes (on) |
| Climate on / off | `RCE-ON` / `RCE-OFF` | `duration`, `parameters=[{rce.temp}]` (on) |
| Set climate temperature | `RCE-Temperature` | `parameters=[{rce.temp}]` |
| Start / stop charging | `RCS-ChargingStart` / `RCS-ChargingStop` | |
| Rapid cooling | `PAA-RapidCoolingON` | |
| Trip log on / off | `JOU-TargetON` / `JOU-TargetOFF` | sent to `/sendJou` |
| Cabin cleaning on / off | `RCC-VentilationON` / `RCC-VentilationOFF` | |
| Defogger on / off | `RCE-DefrostON` / `RCE-DefrostOFF` | |
| Scheduled charge, repeating | `RBC-CycleON` | `parameters=[startTime, endTime, {rbc.target: 2}]` |
| Scheduled charge, once | `RBC-CycleOFF` | `scheduledTime`, `endTime`, `[{rbc.target: 2}]`; `SingleON` would be expected, so this may be an app bug |
| Cancel scheduled charge | `RBC-CycleOFF` / `RBC-SingleOFF` | |
| Scheduled trip, once | `RBT-SingleON` | `scheduledTime`, `parameters=[{rbt.ac}, {rbt.bw}, {rbt.bwl: 1}]` |
| Scheduled trip, repeating | `RBT-CycleON` | plus `timerData` (days comma-joined) |
| Cancel scheduled trip | `RBT-CycleOFF` / `RBT-SingleOFF` | |
| Seat ventilation | `RCE-VentilationON/OFF`, plus driver and passenger variants | `parameters=[{rce.ventilation.driver/passenger: level}]` |
| Vehicle position | `""` | goes to `getVehiclePosition` with `{vin}` |

`FindCarType` is `Flash` or `HornAndLights`. There's a `SeatPosition` enum, but seat
ventilation only uses the driver/passenger levels. If climate or engine start has no
`duration`, the app fills it from the capability's `DEFAULT_START_TIME`.

### PIN

- `checkPinCode`: `{"vin", "pinCode": md5(md5(pin) + userId), "type": "VEHICLE_CONTROL"}`.
  The PIN screen (`module_car/ui/PinFragment`) passes lowercase `md5(pin) + userId` to the
  SDK, and the SDK hashes that again. `type` is `"VEHICLE_CONTROL"` for remote control and
  `"PIN_ENABLE"` when turning the PIN on or off.
- `setPinCode`: `{"vin", "pinCode": md5(pin), "smsCode"}`
- `pinEnable`: `{"status": <bool>, "vin", "pinCode": md5(pin)}`
- `sendCode`: `{"mobileNo", "codeType": "PIN"}`, returns a `code`. `checkCode`:
  `{"mobileNo", "codeType": "PIN", "smsCode"}`.

Setting or enabling a PIN goes `sendCode` → `checkCode` → `setPinCode` or `pinEnable`. The
app only asks for the PIN when the vehicle's `enablePin` is true, and then it calls
`checkPinCode` before every command.

### Getting the result

Proton Link gets the result over MQTT and doesn't poll. `executeCommand`
(`RemoteVehicleControlServiceImpl`) sends the HTTP call, keeps the `requestId`, emits
`SentToService`, then listens to `AcoPush.pushService().getMessage()`. It keeps messages
with `messageCategory == "VEHICLE_CONTROL"`, parses their `content` as a
`VehicleControlMessage`, and waits for one whose `taskId` equals the `requestId`. If none
arrives within the timeout it gives up with `Timeout`. Either way it refreshes the status
once afterwards.

`VehicleControlMessage`: `{message, code: int, time: Long, taskId, vin, serviceKey,
executionSteps, serviceResult, title, body}`. `serviceResult` values:

- `ISSUED_SUCCESS`: handed to the car's modem (`SentToTBox`), not the result yet
- `EXECUTION_SUCCESS`: done. For climate there's also an `RCE-Engine-ON` step, which the
  app reports as the engine starting.
- `EXECUTION_FAIL`: failed, with `code` and `body`
- anything else: the command started

jadx couldn't fully decompile the Moshi parsing in `executeCommand` or the
`PushHandler.handle` coroutine. Those two parts are reconstructed from the surrounding
code and `@DebugMetadata`, so details may differ.

### MQTT

- Broker (TLS, MQTT 5, HiveMQ client): PROD `ssl://prodinfomq-atlas.acotech.my:55883`, UAT
  `ssl://uatinfomq-atlas.acotech.my:61883`, QA `ssl://qainfomq-atlas.acotech.my:45883`.
- Client id: `DeviceManager.getDeviceId()`.
- Username `Proton Link`, password `mqPassword` (see Tenant constants), sent as plain
  UTF-8 with no hashing. The app skips MQTT if `mqPassword` is empty.
- Options: simple auth, `cleanStart(false)`, 48 h session expiry, auto-reconnect, QoS 1
  publishes.
- Topics: subscribes to `mobile/{deviceId}/notify` and `mobile/{deviceId}/message`;
  publishes heartbeats to `mobile/heartbeat` and receipts to `mobile/receipt`.
- Heartbeat: every `GET /information/mqttConfig/getHeartbeatTime` seconds (default 60),
  with payload `{"deviceId": ..., "timestamp": <ms>}`.
- Incoming messages are JSON `TempMessage{content: Map, notification, inAppMsg,
  messageCategory, messageId, messageSubcategory, timestamp}`. The app turns `content`
  back into a JSON string and passes on `AcoMessage{content, messageCategory,
  messageSubcategory, notification}`. For a command result, `content` is a
  `VehicleControlMessage`.
- Receipts: for each push it handles, the app publishes `MessageReceipt{messageId,
  receiptStatus: int, receiptDesc, deviceId, timestamp}` to `mobile/receipt` at QoS 1.
  There's also `POST /information/notifyReceipt/encryption`, with an `X-UPLOAD-ID` header
  of AES(device info, key `appSecret` + timestamp), but nothing calls it.
- The app's TLS setup trusts every certificate and hostname.

## Car images

The car is drawn from 2D PNG layers at two fixed camera angles; there's no 3D model.

- The decompiled tree has no glTF, FBX, USDZ, Filament, Sceneform, ARCore or Unity code.
  The APK's native libraries are the HERE SDK, CameraX and UCS; its only `.obj` files are
  HERE map markers.
- `VehicleModelManager` decodes the PNGs and draws them one by one onto a canvas. The
  result is two bitmaps, `overHeadView` and `isometricView`.
- The two angles are overhead (the "control view") and a 45° isometric view. The app only
  shows the overhead one, plus a still per colour in the colour picker.
- Each angle is a zip of overlay PNGs for each state (doors, windows, hood, trunk,
  sunroof, charge flap, open or closed), not animation frames.
  `VehicleAppearanceImage.fileUrls[]` has `index`, `status` and `url`, but the app only
  uses the first entry.

### Atlas

All `POST` with a JSON map body. The codes come from the default vehicle's `VehicleInfo`
(`matCode`, `modelCode`, `bodyColorCode`, `topColorCode`).

- `basic/mat/colorModelDetailList` with `{matCode, modelCode}` returns the colours on
  offer: `{brandCode, brandName, matCode, matName, modelCode, modelName, createTime,
  updateTime, bodyColors: [{bodyColorCode, bodyColorName, bodyColorDescription,
  bodyColorIcon, topColorCodes: [{topColorCode, topColorName, topColorDescription,
  topColorIcon}]}], interiorColors: [{interiorColorCode, interiorColorName,
  interiorColorDescription, interiorColorIcon}]}`.
- `basic/mat/model/bodyPictureList` with `{matCode, modelCode, bodyColorCode,
  topColorCode: null}` returns `{fileUrls: [{index, status, url}]}`. Only the first `url`
  is used.
- `basic/model/bodyCode/queryControlColorPicture` (overhead) and
  `basic/model/bodyCode/queryFortyFiveColorPicture` (45°), with `{matCode, modelCode,
  bodyColorCode, topColorCode}`, return `{md5, url}`: a zip. The app downloads it without
  auth, caches it in `<externalCacheDir>/theme/<md5>/`, and composites the PNGs inside.

### Legacy

In `module_car/http/HttpService`:

- `GET app/v1/vehicle/modelColor?vin=&isPage=` returns `CarColor{colorId, colorName,
  colorIcon, sideViewUrl}[]`.
- `POST app/v1/vehicle/modelColor` with `{vin, colorId}`.
- `GET app/v1/vehicle/modelColorImage?colorId=&modelCode=` returns `{packageUrl,
  packageMd5}`, the same layered zip.
- `GET app/v1/vehicle/modelImage?vin=&isPage=` returns `{directionType, imageUrl,
  imageUpdateTime}[]`. Nothing calls it; the `directionType` values are unknown.

## Trips, geofences, charging and messages

`/bigdata/*` and `/app/v1/vehicle/trip/delete/app/v1` go to the Atlas host through
AcoApi, not the legacy host given in the OpenAPI index.

### Trips

These are the calls the app makes (module_car `VehicleService`, Atlas host):

- `POST /bigdata/vehicle/trip/queryList/app/v1` with `{startTime (ms), endTime, vin,
  isPage: true, currentPage, pageSize: 10}` returns `TripRecord{vin, avgSpeed, latitude,
  tripStartLatitude, tripStartLongitude, tripEndLatitude, tripEndLongitude, tripPowerCns,
  tripUseMiles, tripUseTimes, tripStartTime, tripEndTime (long)}[]`.
- `POST /bigdata/vehicle/trip/queryTrackList/app/v1` with `{startTime, endTime,
  currentPage: 0, pageSize: 1000, vin}` returns `{vin, latitude, longitude}[]` (strings).
- `DELETE /app/v1/vehicle/trip/delete/app/v1` with `{vin, startTime: [Long]}`. It's a
  Retrofit `@DELETE` with a `@Body`, which Retrofit doesn't support without a custom
  method, so it may fail.

Whether the trip log is on:

- `POST iot/function/getJouState` with `{vin}` returns a map; `jouState == "1"` means on.
- Turning it on or off is `POST iot/function/vehicleControl/sendJou` with
  `{serviceKey: "JOU-TargetON" | "JOU-TargetOFF", vin}`.

The legacy `POST app/v1/journeyLog/logList` and `trackList` exist but nothing calls them,
so their bodies are unknown.

### Geofences

On the Atlas host, through module_car `VehicleService`:

- `POST /bigdata/geoFence/add` with `{userId, vin, coordinateSystem: "WGS84", name?,
  centerName?, latitude?, longitude?, radius?, status?, startTime?, endTime?, type:
  "Both"}`. Latitude and longitude are strings holding integer degrees × 3,600,000.
- `DELETE /bigdata/geoFence/delete` (with a body) with `{userId, vin, ids: [id]}`.
- `POST /bigdata/geoFence/list` with `{vin, isPage: false}` returns `FenceInfo{id, vin,
  name, centerName, coordinateSystem, latitude, longitude, radius, startTime, endTime,
  gmtCreate, gmtModified, status, expired}[]`.
- `PUT /bigdata/geoFence/modify/{id}` with the same body as `add`.
- `PUT /bigdata/geoFence/status/{id}` with `{vin, status}`.

The legacy `/app/v1/vehicle/electronicFence` endpoints exist but nothing calls them.

### Charging and trip schedules

Atlas:

- `POST iot/function/getBookingChargingSetting` with `{vin}` returns `{vin, requestId,
  cycleStartTime, cycleEndTime, dayOfWeek, openStatus, bcCycleActive, bcTempActive,
  rbcTarget (Int), scheduledTime, endTime, updateTime}`.
- `POST iot/function/getBookingTravelSetting` with `{vin}` returns `{vin, requestId,
  openStatus, airConditioningSwitch, batteryPreheating, btActive, btTempActive,
  batteryWormLevel (Int), scheduledTime, updateTime, timerDataAO}`, where `timerDataAO` is
  `{timerInfoList: [{dayOfWeek, startTimeOfDay, timerActivation: 1}], timerId: 1}` and
  days run from MONDAY (1, "Mon") to SUNDAY (7, "Sun").

Legacy (`GET ?userId&vin`): `getBookingChargingSetting`, `getBookingTravelSetting` and
`getRcsSetting`, returning `ScheduleChargingConfiguration`, `ScheduleTripConfiguration`
and `ChargingResponse{vin, setting, soc, current, updateTime}`. Whether their enums are
ints or names on the wire is unknown.

Changing a schedule is a normal `vehicleControl` command with `RBC-*` or `RBT-*` keys and
`parameters`/`timerData` (see Service keys).

### Messages

On the legacy host, module_message `HttpServices`:

- `GET app/v1/message/obtain/notice?receiveId&isPage&currentPage&pageSize` returns
  `MsgNoticeItem{id, title, description, imageUrl, targetUrl, jumpType, actionType,
  subType, msgState, topState, pushTime, contentId, ...}[]`.
- `GET app/v1/message/obtain/interactive`, `.../trade` and `.../unreadNum` (the last
  returns `{actionType, subType, titleType, unreadNum}[]`).
- `PUT app/v1/message/operation/resetMsgState` with `{receiveId, titleType?, actionType?,
  subType?, ids?, msgState: "1"}`.
- `DELETE app/v1/message/operation/delete` with `{receiveId, titleType, ids}`.
- `GET information/mobileLog/queryPageList?labelIdList&currentPage&pageSize` returns
  `Msg{id, messageTitle, messageContent, businessData, templateLabelId,
  templatesCategoryCode, templatesSubcategoryCode, createTime, createTimeInt (Long),
  readStatus (int)}[]`.
- `GET information/mobileLog/queryLabelList` returns `{labelId, labelName}[]`.
