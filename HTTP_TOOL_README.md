# HTTP Request Tool - Implementation Summary

## Overview

The HTTP Request Tool has been successfully added to the agent-api-server, following the existing tool implementation patterns. This tool enables agents to make HTTP requests to external APIs, with support for both pre-configured APIs and custom URLs.

## Features

### ✅ Pre-configured APIs
- **Open-Meteo Weather API**: Free weather forecasts and current conditions
  - Base URL: `https://api.open-meteo.com/v1`
  - Endpoints: `/forecast`, `/historical`
  - No authentication required

- **Open-Meteo Geocoding API**: Convert location names to coordinates
  - Base URL: `https://geocoding-api.open-meteo.com/v1`
  - Endpoints: `/search`
  - No authentication required

### ✅ Custom URL Support
Make requests to any public HTTP/HTTPS API endpoint

### ✅ Security Features
- ✓ URL validation (blocks localhost, private IPs, file:// protocol)
- ✓ Request size limits (1MB body, 10MB response)
- ✓ Timeout enforcement (default 10s, max 30s)
- ✓ User-Agent header injection
- ✓ Error sanitization

### ✅ HTTP Methods
- GET
- POST
- PUT
- DELETE
- PATCH

## Files Created

1. **`src/services/tools/handlers/apiRegistry.ts`** - Registry of pre-configured APIs
2. **`src/services/tools/handlers/httpRequestTool.ts`** - Main tool handler
3. **`test-http-tool.js`** - Test suite demonstrating functionality

## Files Modified

1. **`src/services/tools/handlers/index.ts`** - Registered new tool
2. **`src/scripts/seed.ts`** - Added tool definition for database

## Usage Examples

### Example 1: Get Weather (Pre-configured API)
```json
{
  "api_id": "open_meteo_weather",
  "endpoint": "/forecast",
  "params": {
    "latitude": 45.5017,
    "longitude": -73.5673,
    "current_weather": true
  }
}
```

**Result**: Returns current weather conditions for Montreal
- Temperature: -0.4°C
- Wind speed: 18.9 km/h
- Weather code: 0 (clear sky)

### Example 2: Geocode Location (Pre-configured API)
```json
{
  "api_id": "open_meteo_geocoding",
  "endpoint": "/search",
  "params": {
    "name": "Montreal",
    "count": 1,
    "language": "en"
  }
}
```

**Result**: Returns coordinates and metadata for Montreal
- Latitude: 45.50884
- Longitude: -73.58781
- Population: 1,762,949
- Timezone: America/Toronto

### Example 3: Custom URL
```json
{
  "url": "https://api.github.com/zen",
  "method": "GET"
}
```

**Result**: Returns a random Zen quote from GitHub

### Example 4: POST Request with Body
```json
{
  "url": "https://api.example.com/data",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "key": "value"
  }
}
```

## Tool Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `api_id` | string | Conditional* | Pre-configured API ID (e.g., "open_meteo_weather") |
| `url` | string | Conditional* | Full URL for custom requests |
| `method` | string | No | HTTP method (default: GET) |
| `endpoint` | string | When using api_id | Endpoint path (e.g., "/forecast") |
| `params` | object | No | URL query parameters |
| `headers` | object | No | Custom HTTP headers |
| `body` | object | No | Request body for POST/PUT/PATCH |
| `timeout` | number | No | Timeout in ms (default: 10000, max: 30000) |

*Must provide either `api_id` OR `url`, not both.

## Response Structure

```typescript
{
  success: boolean;
  output: {
    status: number;           // HTTP status code (e.g., 200)
    statusText: string;       // Status text (e.g., "OK")
    headers: object;          // Response headers
    data: any;               // Response data (parsed JSON or text)
    api_used?: string;       // Pre-configured API ID (if used)
    url: string;             // Actual URL called
    duration_ms: number;     // Request duration in milliseconds
  };
  error?: string;            // Error message if failed
}
```

## Testing

Run the test suite to verify functionality:

```bash
node test-http-tool.js
```

### Test Results
✅ All 6 tests passed:
1. ✅ List available pre-configured APIs
2. ✅ Open-Meteo Weather API (real API call)
3. ✅ Open-Meteo Geocoding API (real API call)
4. ✅ Custom URL (GitHub API)
5. ✅ Security validation (localhost blocked)
6. ✅ Error handling (invalid API ID)

## Security Considerations

### Blocked URLs
- `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`
- Private IP ranges (10.x, 172.16-31.x, 192.168.x)
- Link-local addresses (169.254.x)
- `.local` domains
- `file://` protocol

### Rate Limiting
- Maximum 20 calls per run (configurable via policy)

### Size Limits
- Request body: 1MB max
- Response: 10MB max

### Timeout
- Default: 10 seconds
- Maximum: 30 seconds

## Database Setup

To add the tool to your database:

```bash
# Build TypeScript
npm run build

# Seed database (requires DB connection)
npm run db:seed:dev

# Or in production
npm run db:seed
```

## Future Enhancements

Potential improvements (not implemented in this version):
- API key management for authenticated APIs
- Response caching
- Retry logic with exponential backoff
- More pre-configured APIs (news, currency, etc.)
- Request/response transformation templates
- OAuth flow support

## Integration with LLM

The tool is automatically registered and available to the LLM. The tool description includes:
- List of pre-configured APIs with examples
- Parameter schema with validation
- Usage examples for each API

The LLM can efficiently use this tool without needing to discover API endpoints, as they are pre-configured and documented in the schema.

## Logging

All requests are logged with the `http-request-tool` component logger:
- Debug: Parameter validation
- Info: Request start/completion with duration
- Warn: Timeouts and network errors
- Error: Unexpected failures

Example log entry:
```json
{
  "level": "info",
  "component": "http-request-tool",
  "method": "GET",
  "url": "https://api.open-meteo.com/v1/forecast",
  "status": 200,
  "duration_ms": 614,
  "msg": "HTTP request completed"
}
```

## Production Readiness

The implementation includes:
- ✅ Type safety (TypeScript)
- ✅ Error handling
- ✅ Security validation
- ✅ Structured logging
- ✅ Timeout protection
- ✅ Input validation
- ✅ Comprehensive tests
- ✅ Documentation

The tool is production-ready and follows all existing patterns in the codebase.
