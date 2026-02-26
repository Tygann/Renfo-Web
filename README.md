# Renfo Web

Renfo map + festival detail web app with a Cloudflare Worker WeatherKit proxy.

## Project structure

- `index.html`: page markup + third-party script includes.
- `styles.css`: CSS entrypoint that imports layered style files.
- `styles/tokens.css`: theme variables and color-scheme tokens.
- `styles/base.css`: global/page-level layout and base controls.
- `styles/ui.css`: sidebar/detail/list component styles.
- `styles/mobile.css`: mobile-specific overrides.
- `src/main.js`: main orchestration (map wiring + UI state + rendering).
- `src/lib/festival-utils.js`: festival/data formatting and grouping helpers.
- `src/lib/weather.js`: forecast fetching, mapping, and caching.
- `src/types.js`: shared JSDoc typedefs (`Festival`, `WeatherForecast`).
- `config.js`: runtime client config (`MAPKIT_TOKEN`, weather endpoint, assets URL).
- `data/festivals.json`: festival data source.
- `assets/images/`: app images (brand logo, crown marker glyph, favicon).
- `cloudflare/api-worker.js`: WeatherKit proxy worker.
- `wrangler.jsonc`: worker name/routes/vars for deploys.

## Code map

- `src/main.js`
  - `loadFestivals()`: fetches and normalizes `data/festivals.json`.
  - `renderListGrouped()`: renders the grouped/sorted left list.
  - `updateDetailPanel()`: hydrates the right-side detail panel.
  - `renderDetailWeather()`: renders forecast state/rows for selected festival.
  - `main()`: app bootstrap (MapKit init, events, initial render).
- `src/lib/festival-utils.js`
  - `getDerivedFestivalStatus()`: computes active/upcoming/inactive/discontinued.
  - `sortFestivals()`: sort strategy for list rendering.
  - `getResourceEntries()`: resource link generation for detail panel.
- `src/lib/weather.js`
  - `fetchWeatherForecast()`: proxy/direct WeatherKit fetch path.
  - `getWeatherForecast()`: cached weather accessor used by UI.
- `cloudflare/api-worker.js`
  - Worker entrypoint for `/api/weather` requests, token generation, and CORS.

## Local preview workflow (recommended)

Use your tunnel-backed dev domain so MapKit and WeatherKit both behave like production.

1. Start your local server (VS Code Live Server on `127.0.0.1:5500`).
2. Ensure the Cloudflare tunnel connector is running (`renfo-dev`).
3. Open `https://dev.renfo.app` for preview (instead of `http://127.0.0.1:5500`).

## API worker routing

Current route pattern:

- `*.renfo.app/api/weather*` -> `renfo-api`

That allows weather requests from production and subdomain previews.

## Worker vars/secrets

Set in Cloudflare Worker settings:

- `WEATHERKIT_TEAM_ID` (secret)
- `WEATHERKIT_SERVICE_ID` (secret)
- `WEATHERKIT_KEY_ID` (secret)
- `WEATHERKIT_P8` (secret)
- `WEATHERKIT_TOKEN_TTL_SECONDS` (text, e.g. `1800`)
- `ALLOWED_ORIGINS` (text, currently `https://*.renfo.app`)

## Development commands

- `npm run check`: run lint checks.
- `npm run check:all`: run lint + prettier check.
- `npm run lint`: lint JavaScript files.
- `npm run lint:fix`: lint and auto-fix where possible.
- `npm run format`: format files with Prettier.
- `npm run format:check`: verify formatting without writing changes.

## Notes

- Keep `.p8` keys out of git (already covered by `.gitignore`).
- If you rename worker/routes in Cloudflare UI, keep `wrangler.jsonc` aligned.

## Cache behavior (Cloudflare)

- `_headers` defines caching for static site files when deployed on Cloudflare Pages.
- HTML/JS/CSS/config/data/manifest are set to `max-age=0, must-revalidate` so clients (including iOS Safari) check for updates quickly.
- `/assets/*` is cached for 7 days to keep image loads fast.
