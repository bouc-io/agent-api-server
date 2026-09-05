# New Tools Implementation Guide

This guide covers the three newly implemented tools: Echo, Calculator, and Time & Date.

## Installation

After pulling the latest changes, install the new dependencies:

```bash
npm install
```

New dependencies added:
- `mathjs` (^14.0.1) - Safe mathematical expression parser for Calculator tool
- `dayjs` (^1.11.13) - Lightweight date/time library for Time & Date tool

## Seeding the Database

After installation, you must seed the database to register the new tools:

```bash
# Development
npm run db:seed:dev

# Production (after build)
npm run db:seed
```

This will register all four tools in the database:
1. ✅ echo
2. ✅ web_search
3. ✅ calculator (NEW)
4. ✅ time_date (NEW)

## Verifying Installation

### Via API
```bash
curl http://localhost:3000/v1/tools \
  -H "Authorization: Bearer <token>"
```

You should see all four tools listed with their schemas.

### Via Logs
When you start the server, you should see:
```
Registered 4 built-in tools: echo, web_search, calculator, time_date
```

## Tool Usage Examples

### 1. Echo Tool

**Purpose**: Simple diagnostic tool for testing

**Example LLM Request**:
```json
{
  "tool": "echo",
  "arguments": {
    "message": "Hello, World!"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "echoed": "Hello, World!",
    "length": 13,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### 2. Calculator Tool

**Purpose**: Mathematical calculations and evaluations

**Basic Arithmetic**:
```json
{
  "tool": "calculator",
  "arguments": {
    "expression": "2 + 2"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "expression": "2 + 2",
    "result": 4,
    "formatted": "4.0000000000",
    "type": "number",
    "precision": 10
  }
}
```

**Advanced Functions**:
```json
{
  "tool": "calculator",
  "arguments": {
    "expression": "sqrt(144) + 2^3",
    "precision": 2
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "expression": "sqrt(144) + 2^3",
    "result": 20,
    "formatted": "20.00",
    "type": "number",
    "precision": 2
  }
}
```

**Supported Operations**:
- Basic: `+`, `-`, `*`, `/`, `%`, `^` (or `**`)
- Functions: `sqrt`, `abs`, `ceil`, `floor`, `round`, `sin`, `cos`, `tan`, `log`, `log10`, `exp`, `min`, `max`
- Constants: `pi`, `e`

**Example Expressions**:
- `"(100 - 20) / 4"` → 20
- `"sin(pi/2)"` → 1
- `"log10(1000)"` → 3
- `"round(3.14159, 2)"` → 3.14

### 3. Time & Date Tool

**Purpose**: Time/date operations, timezone conversions, date arithmetic

#### Operation: current_time

Get current time in a specific timezone:

```json
{
  "tool": "time_date",
  "arguments": {
    "operation": "current_time",
    "timezone": "America/Los_Angeles"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "iso": "2024-01-15T10:30:00-08:00",
    "unix": 1705345800,
    "timezone": "America/Los_Angeles",
    "formatted": "2024-01-15T10:30:00-08:00",
    "day_of_week": "Monday"
  }
}
```

#### Operation: convert_timezone

Convert between timezones:

```json
{
  "tool": "time_date",
  "arguments": {
    "operation": "convert_timezone",
    "date": "2024-01-15T10:00:00",
    "timezone": "America/New_York",
    "target_timezone": "Asia/Tokyo"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "source": {
      "iso": "2024-01-15T15:00:00.000Z",
      "timezone": "America/New_York",
      "formatted": "2024-01-15T10:00:00-05:00"
    },
    "target": {
      "iso": "2024-01-15T15:00:00.000Z",
      "timezone": "Asia/Tokyo",
      "formatted": "2024-01-16T00:00:00+09:00"
    }
  }
}
```

#### Operation: add_duration

Add time to a date:

```json
{
  "tool": "time_date",
  "arguments": {
    "operation": "add_duration",
    "date": "2024-01-15T10:00:00",
    "duration": "3 hours"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "original": "2024-01-15T10:00:00.000Z",
    "result": "2024-01-15T13:00:00.000Z",
    "duration": "3 hours",
    "timezone": "UTC",
    "formatted": "2024-01-15T13:00:00Z"
  }
}
```

#### Operation: format_date

Format a date with custom format:

```json
{
  "tool": "time_date",
  "arguments": {
    "operation": "format_date",
    "date": "2024-01-15",
    "format": "dddd, MMMM Do YYYY"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "iso": "2024-01-15T00:00:00.000Z",
    "formatted": "Monday, January 15th 2024",
    "format": "dddd, MMMM Do YYYY",
    "timezone": "UTC"
  }
}
```

#### Operation: difference

Calculate time difference:

```json
{
  "tool": "time_date",
  "arguments": {
    "operation": "difference",
    "date": "2024-12-31"
  }
}
```

**Response**:
```json
{
  "success": true,
  "output": {
    "milliseconds": 30240000000,
    "seconds": 30240000,
    "minutes": 504000,
    "hours": 8400,
    "days": 350,
    "human_readable": "in 350 days"
  }
}
```

#### Other Operations

**is_past / is_future**:
```json
{
  "tool": "time_date",
  "arguments": {
    "operation": "is_past",
    "date": "2020-01-01"
  }
}
```

**day_of_week**:
```json
{
  "tool": "time_date",
  "arguments": {
    "operation": "day_of_week",
    "date": "2024-01-15"
  }
}
```

**Supported Duration Formats**:
- `"2 hours"`
- `"3 days"`
- `"1 week"`
- `"30 minutes"`
- `"2 months"`
- `"1 year"`

**Common Timezones**:
- `UTC`
- `America/New_York`
- `America/Los_Angeles`
- `America/Chicago`
- `Europe/London`
- `Europe/Paris`
- `Asia/Tokyo`
- `Asia/Shanghai`
- `Australia/Sydney`

## Testing the Tools

### Manual Testing via API

1. Create an assignment:
```bash
ASSIGNMENT_ID=$(curl -s -X POST http://localhost:3000/v1/assignments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"title": "Tool Testing"}' | jq -r '.id')
```

2. Send a message that will trigger tool usage:

**Calculator Test**:
```bash
curl -X POST "http://localhost:3000/v1/assignments/${ASSIGNMENT_ID}/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"role": "user", "content": "What is the square root of 144 plus 2 to the power of 3?"}'
```

**Time/Date Test**:
```bash
curl -X POST "http://localhost:3000/v1/assignments/${ASSIGNMENT_ID}/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"role": "user", "content": "What time is it in Tokyo right now?"}'
```

3. Stream the run to see tool execution:
```bash
curl -N "http://localhost:3000/v1/assignments/${ASSIGNMENT_ID}/runs/<RUN_ID>/stream" \
  -H "Authorization: Bearer <token>"
```

You should see SSE events like:
- `tool.call` - Tool being invoked
- `tool.result` - Tool execution result
- `step.reasoning` - LLM's reasoning about tool use

### Example LLM Prompts that Trigger Tools

**Calculator**:
- "Calculate 15% of 250"
- "What's the circumference of a circle with radius 5?"
- "How much is 2^10?"
- "Calculate the average of 15, 23, 42, and 18"

**Time/Date**:
- "What time is it in London?"
- "How many days until Christmas?"
- "What day of the week is January 1st, 2025?"
- "Add 3 hours to 2:30 PM"
- "Is tomorrow a weekday?"

**Echo** (for testing):
- "Echo back: Hello World"
- "Test the echo tool with this message"

## Troubleshooting

### Tools not showing up in `/v1/tools`
Run the seed script:
```bash
npm run db:seed:dev
```

### "Tool X not found in registry" error
Make sure you've restarted the server after adding the tools:
```bash
npm run dev
```

Check the server logs for:
```
Registered 4 built-in tools: echo, web_search, calculator, time_date
```

### TypeScript compilation errors
Make sure you've installed the new dependencies:
```bash
npm install
```

### Calculator returning errors
- Check that the expression is valid
- Ensure expression is less than 500 characters
- Verify you're using supported functions (see TOOL_DESIGN.md)

### Time/Date timezone errors
- Use IANA timezone identifiers (e.g., `America/New_York`, not `EST`)
- Check spelling of timezone names
- Refer to the timezone list in TOOL_DESIGN.md

## Architecture Notes

### Dual Registry System
Tools are registered in two places:
1. **In-memory handler registry** (`src/services/tools/handlers/`)
2. **Database Tool table** (seeded via `src/scripts/seed.ts`)

Both must be synchronized for tools to work.

### Tool Execution Flow
```
User Message
  ↓
Run Created → BullMQ Job
  ↓
Planner Phase (LLM analyzes context)
  ↓
Executor Phase (LLM calls tools iteratively)
  ↓
Tool Registry Lookup (DB query)
  ↓
Tool Handler Execute (in-memory)
  ↓
Result returned to LLM
  ↓
Continue or Complete
```

### Safety Features
- **Calculator**: Uses mathjs (no eval), 500 char limit, timeout protection
- **Time/Date**: Read-only, validated timezones, ±100 year limit
- **All tools**: Structured logging, timeout handling, error recovery

## Next Steps

Consider implementing:
- HTTP/API Request Tool
- File Reader Tool
- Database Query Tool (leveraging existing Prisma setup)
- JSON Transformer Tool

See `TOOL_DESIGN.md` for detailed specifications of all tools.

---

**Last Updated**: 2024-01-15
**Tools Count**: 4 (echo, web_search, calculator, time_date)
