const isLocalPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);

window.RENFO_CONFIG = {
  MAPKIT_TOKEN: "eyJraWQiOiJGOVlQS1hBNFNEIiwidHlwIjoiSldUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJYS1E0MjRIUTMzIiwiaWF0IjoxNzcxNTE1MTY3LCJvcmlnaW4iOiIqLnJlbmZvLmFwcCJ9.z-ycIQdcxWkgTZLNpAlg9N0anT14BKlDy8Wydrv-dLJVBUji7ZS4b5N08NMmkElAFDkQC36QeepOHOFdHE_t7Q",
  WEATHERKIT_TOKEN: "",
  WEATHER_API_URL: isLocalPreview ? "https://www.renfo.app/api/weather" : "/api/weather",
  ASSETS_BASE_URL: "https://assets.renfo.app"
};
