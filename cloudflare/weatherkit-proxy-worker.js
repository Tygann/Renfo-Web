const WEATHERKIT_BASE_URL = "https://weatherkit.apple.com/api/v1/weather/en";
const encoder = new TextEncoder();

let cachedSigningKeyPromise = null;
let cachedToken = null;
let cachedTokenExpUnix = 0;

function getEnvString(env, key) {
  return String(env?.[key] ?? "").trim();
}

function getAllowedOrigins(env) {
  const multi = getEnvString(env, "ALLOWED_ORIGINS");
  if (multi) {
    const list = multi
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }

  const single = getEnvString(env, "ALLOWED_ORIGIN");
  return single ? [single] : [];
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOriginAllowed(origin, allowedOrigins) {
  for (const allowed of allowedOrigins) {
    if (allowed === "*") return true;
    if (!allowed.includes("*")) {
      if (origin === allowed) return true;
      continue;
    }

    const regex = new RegExp(`^${escapeRegexLiteral(allowed).replace(/\\\*/g, ".*")}$`);
    if (regex.test(origin)) return true;
  }
  return false;
}

function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function stringToBase64Url(value) {
  return toBase64Url(encoder.encode(String(value)));
}

function pemToArrayBuffer(pem) {
  const clean = String(pem)
    .replace(/\r/g, "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\n/g, "")
    .trim();

  if (!clean) {
    throw new Error("WEATHERKIT_P8 is empty or invalid.");
  }

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function readAsnLength(bytes, index) {
  const first = bytes[index];
  if (first < 0x80) {
    return { length: first, nextIndex: index + 1 };
  }

  const count = first & 0x7f;
  if (count <= 0 || count > 4) {
    throw new Error("Invalid ASN.1 length.");
  }

  let length = 0;
  for (let i = 0; i < count; i += 1) {
    length = (length << 8) | bytes[index + 1 + i];
  }
  return { length, nextIndex: index + 1 + count };
}

function normalizeInteger(bytes, size) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00) {
    start += 1;
  }

  const sliced = bytes.slice(start);
  if (sliced.length > size) {
    throw new Error("Invalid ECDSA integer length.");
  }

  const out = new Uint8Array(size);
  out.set(sliced, size - sliced.length);
  return out;
}

function derToJoseSignature(signatureBytes, size = 32) {
  if (signatureBytes.length === size * 2 && signatureBytes[0] !== 0x30) {
    return signatureBytes;
  }

  let index = 0;
  if (signatureBytes[index] !== 0x30) {
    throw new Error("Expected DER sequence.");
  }
  index += 1;

  const sequenceLen = readAsnLength(signatureBytes, index);
  index = sequenceLen.nextIndex;
  const sequenceEnd = index + sequenceLen.length;

  if (signatureBytes[index] !== 0x02) {
    throw new Error("Expected DER integer for R.");
  }
  index += 1;

  const rLen = readAsnLength(signatureBytes, index);
  index = rLen.nextIndex;
  const r = signatureBytes.slice(index, index + rLen.length);
  index += rLen.length;

  if (signatureBytes[index] !== 0x02) {
    throw new Error("Expected DER integer for S.");
  }
  index += 1;

  const sLen = readAsnLength(signatureBytes, index);
  index = sLen.nextIndex;
  const s = signatureBytes.slice(index, index + sLen.length);
  index += sLen.length;

  if (index !== sequenceEnd) {
    throw new Error("Invalid DER signature length.");
  }

  const out = new Uint8Array(size * 2);
  out.set(normalizeInteger(r, size), 0);
  out.set(normalizeInteger(s, size), size);
  return out;
}

async function getSigningKey(env) {
  if (cachedSigningKeyPromise) {
    return cachedSigningKeyPromise;
  }

  const p8 = getEnvString(env, "WEATHERKIT_P8");
  if (!p8) {
    throw new Error("Missing WEATHERKIT_P8 secret.");
  }

  cachedSigningKeyPromise = crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(p8),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  return cachedSigningKeyPromise;
}

function getTokenTtlSeconds(env) {
  const raw = Number(getEnvString(env, "WEATHERKIT_TOKEN_TTL_SECONDS") || "1800");
  if (!Number.isFinite(raw) || raw <= 0) return 1800;
  return Math.max(300, Math.min(3600, Math.floor(raw)));
}

async function getWeatherKitToken(env) {
  const teamId = getEnvString(env, "WEATHERKIT_TEAM_ID");
  const serviceId = getEnvString(env, "WEATHERKIT_SERVICE_ID");
  const keyId = getEnvString(env, "WEATHERKIT_KEY_ID");
  if (!teamId || !serviceId || !keyId) {
    throw new Error("Missing required WeatherKit env vars.");
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  if (cachedToken && nowUnix < cachedTokenExpUnix - 60) {
    return cachedToken;
  }

  const ttl = getTokenTtlSeconds(env);
  const expUnix = nowUnix + ttl;
  const key = await getSigningKey(env);

  const header = {
    alg: "ES256",
    kid: keyId,
    id: `${teamId}.${serviceId}`,
    typ: "JWT"
  };
  const payload = {
    iss: teamId,
    sub: serviceId,
    iat: nowUnix,
    exp: expUnix
  };

  const encodedHeader = stringToBase64Url(JSON.stringify(header));
  const encodedPayload = stringToBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signatureDer = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(signingInput)
    )
  );
  const signatureJose = derToJoseSignature(signatureDer);
  const token = `${signingInput}.${toBase64Url(signatureJose)}`;

  cachedToken = token;
  cachedTokenExpUnix = expUnix;
  return token;
}

function buildCorsHeaders(request, env) {
  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins.length === 0) return {};

  const origin = request.headers.get("Origin");
  if (!origin) return {};

  if (!isOriginAllowed(origin, allowedOrigins)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function jsonResponse(status, payload, corsHeaders = {}, cacheControl = "no-store") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      ...corsHeaders
    }
  });
}

function parseCoordinate(rawValue, min, max) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function buildWeatherKitUrl(lat, lng) {
  const path = `${encodeURIComponent(lat.toFixed(6))}/${encodeURIComponent(lng.toFixed(6))}`;
  const url = new URL(`${WEATHERKIT_BASE_URL}/${path}`);
  url.searchParams.set("dataSets", "currentWeather,forecastDaily");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("countryCode", "US");
  return url.toString();
}

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);
    if (corsHeaders === null) {
      return jsonResponse(403, { error: "forbidden_origin" });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, { error: "method_not_allowed" }, corsHeaders);
    }

    const url = new URL(request.url);

    const lat = parseCoordinate(url.searchParams.get("lat"), -90, 90);
    const lng = parseCoordinate(url.searchParams.get("lng"), -180, 180);
    if (lat == null || lng == null) {
      return jsonResponse(400, { error: "invalid_coordinates" }, corsHeaders);
    }

    try {
      const token = await getWeatherKitToken(env);
      const weatherResponse = await fetch(buildWeatherKitUrl(lat, lng), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!weatherResponse.ok) {
        return jsonResponse(
          weatherResponse.status,
          { error: "weatherkit_error", status: weatherResponse.status },
          corsHeaders
        );
      }

      const weatherPayload = await weatherResponse.json();
      return jsonResponse(
        200,
        {
          currentWeather: weatherPayload?.currentWeather ?? null,
          forecastDaily: weatherPayload?.forecastDaily ?? null
        },
        corsHeaders,
        "public, max-age=600"
      );
    } catch (error) {
      return jsonResponse(500, { error: "proxy_error", message: String(error?.message ?? "Unknown error.") }, corsHeaders);
    }
  }
};
