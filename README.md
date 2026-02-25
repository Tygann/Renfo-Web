# Renfo Web

Renfo map + festival detail web app with a Cloudflare Worker WeatherKit proxy.

## Project structure

- `index.html`: page markup + third-party script includes.
- `styles.css`: CSS entrypoint that imports layered style files.
- `styles/tokens.css`: theme variables and color-scheme tokens.
- `styles/base.css`: global/page-level layout and base controls.
- `styles/ui.css`: sidebar/detail/list component styles.
- `styles/mobile.css`: mobile-specific overrides.
- `app.js`: main orchestration (map wiring + UI state + rendering).
- `src/lib/festival-utils.js`: festival/data formatting and grouping helpers.
- `src/lib/weather.js`: forecast fetching, mapping, and caching.
- `src/types.js`: shared JSDoc typedefs (`Festival`, `WeatherForecast`).
- `config.js`: runtime client config (`MAPKIT_TOKEN`, weather endpoint, assets URL).
- `festivals.json`: festival data source.
- `cloudflare/api-worker.js`: WeatherKit proxy worker.
- `wrangler.jsonc`: worker name/routes/vars for deploys.

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
