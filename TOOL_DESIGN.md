# Tool Design Specification

This document outlines the design and implementation details for built-in tools in the Agent API Server.

## Design Principles

1. **Safety First**: Tools should validate inputs and handle errors gracefully
2. **Transparency**: Tools should return structured, predictable outputs
3. **Idempotency**: Where possible, tools should be safe to retry
4. **Logging**: All tool executions are logged with structured metadata
5. **Timeout**: All tools respect the global timeout configuration

## Tool Architecture

Each tool consists of:
- **Handler**: In-memory TypeScript implementation (`src/services/tools/handlers/`)
- **Database Schema**: JSON Schema definition stored in PostgreSQL `Tool` table
- **Policy**: Execution policy (max calls per run, approval requirements)

### Tool Handler Interface

```typescript
export interface ToolHandler {
    name: string;
    execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
    runId: string;
    assignmentId: string;
    userId?: string;
    metadata?: Record<string, unknown>;
}

export interface ToolResult {
    success: boolean;
    output?: unknown;
    error?: string;
    metadata?: Record<string, unknown>;
}
```

---

## Tool: Echo

### Purpose
A simple diagnostic tool for testing the tool execution pipeline. Returns the input message back to the caller.

### Use Cases
- Testing tool execution flow
- Validating tool call syntax
- Debugging LLM tool selection
- Demonstrating tool capabilities to users

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | The message to echo back |

### JSON Schema

```json
{
    "type": "object",
    "properties": {
        "message": {
            "type": "string",
            "description": "The message to echo back"
        }
    },
    "required": ["message"]
}
```

### Output Format

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

### Error Handling
- Empty message: Returns error
- Non-string input: Type validation error

### Policy
- **Max calls per run**: 50
- **Requires approval**: false
- **Timeout**: 5000ms

### Implementation Notes
- No external dependencies
- Extremely low latency
- Safe to call repeatedly
- Useful for health checks

---

## Tool: Calculator

### Purpose
Performs mathematical calculations and evaluations. Supports basic arithmetic, advanced functions, and unit conversions.

### Use Cases
- Basic arithmetic (addition, subtraction, multiplication, division)
- Advanced math (exponents, roots, logarithms, trigonometry)
- Percentage calculations
- Numerical comparisons
- Multi-step calculations

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expression` | string | Yes | Mathematical expression to evaluate |
| `precision` | number | No | Decimal places for result (default: 10) |

### JSON Schema

```json
{
    "type": "object",
    "properties": {
        "expression": {
            "type": "string",
            "description": "Mathematical expression to evaluate (e.g., '2 + 2', 'sqrt(16)', 'sin(pi/2)')"
        },
        "precision": {
            "type": "number",
            "description": "Number of decimal places in result",
            "minimum": 0,
            "maximum": 20,
            "default": 10
        }
    },
    "required": ["expression"]
}
```

### Supported Operations

**Basic Arithmetic:**
- `+` Addition
- `-` Subtraction
- `*` Multiplication
- `/` Division
- `%` Modulo
- `^` or `**` Exponentiation

**Functions:**
- `sqrt(x)` - Square root
- `abs(x)` - Absolute value
- `ceil(x)` - Round up
- `floor(x)` - Round down
- `round(x)` - Round to nearest
- `sin(x)`, `cos(x)`, `tan(x)` - Trigonometric functions (radians)
- `log(x)` - Natural logarithm
- `log10(x)` - Base-10 logarithm
- `exp(x)` - e^x
- `min(a, b, ...)` - Minimum value
- `max(a, b, ...)` - Maximum value

**Constants:**
- `pi` - π (3.14159...)
- `e` - Euler's number (2.71828...)

### Output Format

```json
{
    "success": true,
    "output": {
        "expression": "sqrt(16) + 2^3",
        "result": 12,
        "formatted": "12",
        "type": "number"
    }
}
```

### Error Handling
- Invalid expression syntax: Returns error with details
- Division by zero: Returns error
- Invalid function: Returns error
- Out of range: Returns error
- Non-numeric result: Returns error

### Security Considerations
- **No code execution**: Uses safe math parser (mathjs or similar), NOT `eval()`
- **Expression length limit**: Max 500 characters
- **Complexity limit**: Prevent deeply nested expressions
- **Timeout**: 3000ms maximum
- **No side effects**: Pure calculations only

### Policy
- **Max calls per run**: 100
- **Requires approval**: false
- **Timeout**: 3000ms

### Implementation Notes
- Use `mathjs` library for safe expression parsing
- Validate expression before evaluation
- Return both numeric and formatted string results
- Log all calculations for audit trail

### Examples

| Expression | Result |
|------------|--------|
| `2 + 2` | 4 |
| `sqrt(144)` | 12 |
| `2^10` | 1024 |
| `sin(pi/2)` | 1 |
| `(100 - 20) / 4` | 20 |
| `round(3.14159, 2)` | 3.14 |

---

## Tool: Time & Date

### Purpose
Handles time and date operations including current time, timezone conversions, date arithmetic, formatting, and parsing.

### Use Cases
- Get current time in various timezones
- Convert between timezones
- Calculate time differences
- Add/subtract time durations
- Format dates for display
- Parse natural language dates
- Check if date is in the past/future
- Calculate business days between dates

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | string | Yes | Operation to perform (see operations below) |
| `timezone` | string | No | IANA timezone (e.g., "America/New_York") |
| `date` | string | No | ISO 8601 date or natural language |
| `target_timezone` | string | No | Target timezone for conversion |
| `format` | string | No | Output format string |
| `duration` | string | No | Duration string (e.g., "2 hours", "3 days") |

### JSON Schema

```json
{
    "type": "object",
    "properties": {
        "operation": {
            "type": "string",
            "enum": [
                "current_time",
                "convert_timezone",
                "add_duration",
                "subtract_duration",
                "format_date",
                "parse_date",
                "difference",
                "is_past",
                "is_future",
                "day_of_week"
            ],
            "description": "The operation to perform"
        },
        "timezone": {
            "type": "string",
            "description": "IANA timezone identifier (e.g., 'America/New_York', 'Europe/London', 'Asia/Tokyo')"
        },
        "date": {
            "type": "string",
            "description": "Date in ISO 8601 format or natural language (e.g., '2024-01-15', 'tomorrow', 'next Monday')"
        },
        "target_timezone": {
            "type": "string",
            "description": "Target timezone for conversion operations"
        },
        "format": {
            "type": "string",
            "description": "Output format string (e.g., 'YYYY-MM-DD', 'h:mm A', 'dddd, MMMM Do YYYY')"
        },
        "duration": {
            "type": "string",
            "description": "Duration string (e.g., '2 hours', '3 days', '1 week', '30 minutes')"
        }
    },
    "required": ["operation"]
}
```

### Supported Operations

#### 1. `current_time`
Get the current date and time.

**Required params**: None
**Optional params**: `timezone`, `format`

**Example**:
```json
{
    "operation": "current_time",
    "timezone": "America/Los_Angeles"
}
```

**Output**:
```json
{
    "success": true,
    "output": {
        "iso": "2024-01-15T10:30:00-08:00",
        "unix": 1705345800,
        "timezone": "America/Los_Angeles",
        "formatted": "January 15, 2024 10:30 AM PST"
    }
}
```

#### 2. `convert_timezone`
Convert a time from one timezone to another.

**Required params**: `date`, `target_timezone`
**Optional params**: `timezone` (source timezone)

**Example**:
```json
{
    "operation": "convert_timezone",
    "date": "2024-01-15T10:00:00",
    "timezone": "America/New_York",
    "target_timezone": "Asia/Tokyo"
}
```

#### 3. `add_duration` / `subtract_duration`
Add or subtract a duration from a date.

**Required params**: `duration`
**Optional params**: `date` (defaults to now), `timezone`

**Example**:
```json
{
    "operation": "add_duration",
    "date": "2024-01-15T10:00:00",
    "duration": "3 hours 30 minutes"
}
```

#### 4. `format_date`
Format a date according to a format string.

**Required params**: `format`
**Optional params**: `date` (defaults to now), `timezone`

**Example**:
```json
{
    "operation": "format_date",
    "date": "2024-01-15",
    "format": "dddd, MMMM Do YYYY"
}
```

#### 5. `parse_date`
Parse a natural language date string.

**Required params**: `date`
**Optional params**: `timezone`

**Example**:
```json
{
    "operation": "parse_date",
    "date": "next Friday at 3pm"
}
```

#### 6. `difference`
Calculate the difference between two dates.

**Required params**: `date` (second date)
**Optional params**: `reference_date` (defaults to now)

**Example**:
```json
{
    "operation": "difference",
    "date": "2024-12-31"
}
```

**Output**:
```json
{
    "success": true,
    "output": {
        "days": 350,
        "hours": 8400,
        "minutes": 504000,
        "human_readable": "350 days, 0 hours"
    }
}
```

#### 7. `is_past` / `is_future`
Check if a date is in the past or future.

**Required params**: `date`

#### 8. `day_of_week`
Get the day of the week for a date.

**Required params**: `date`

### Output Format

```json
{
    "success": true,
    "output": {
        "iso": "2024-01-15T10:30:00Z",
        "unix": 1705319400,
        "timezone": "UTC",
        "formatted": "Monday, January 15, 2024",
        "day_of_week": "Monday",
        "metadata": {}
    }
}
```

### Error Handling
- Invalid timezone: Returns error with list of valid timezones
- Invalid date format: Returns parsing error
- Invalid duration: Returns format error
- Ambiguous natural language: Returns error with suggestions

### Security Considerations
- No system time modification
- Read-only operations
- Timezone database validation
- Maximum date range: ±100 years from current date

### Policy
- **Max calls per run**: 50
- **Requires approval**: false
- **Timeout**: 2000ms

### Implementation Notes
- Use `date-fns` or `dayjs` with timezone plugin
- Support IANA timezone database
- Validate all timezone strings against known list
- Return ISO 8601 format by default
- Include both machine-readable and human-readable formats

### Supported Timezones (Examples)
- `UTC`
- `America/New_York`
- `America/Los_Angeles`
- `America/Chicago`
- `Europe/London`
- `Europe/Paris`
- `Asia/Tokyo`
- `Asia/Shanghai`
- `Australia/Sydney`

### Format String Tokens (dayjs/date-fns compatible)

| Token | Output | Description |
|-------|--------|-------------|
| `YYYY` | 2024 | 4-digit year |
| `MM` | 01-12 | 2-digit month |
| `DD` | 01-31 | 2-digit day |
| `HH` | 00-23 | 2-digit hour (24h) |
| `mm` | 00-59 | 2-digit minute |
| `ss` | 00-59 | 2-digit second |
| `dddd` | Monday | Day of week (full) |
| `MMMM` | January | Month (full) |
| `A` | AM/PM | Meridiem |

---

## Tool Registration Checklist

When adding a new tool:

- [ ] Create handler in `src/services/tools/handlers/{toolName}Tool.ts`
- [ ] Implement `ToolHandler` interface
- [ ] Add comprehensive input validation
- [ ] Add error handling with meaningful messages
- [ ] Export from `src/services/tools/handlers/index.ts`
- [ ] Add to `builtinHandlers` array
- [ ] Add seed entry in `src/scripts/seed.ts`
- [ ] Run `npm run db:seed` to register in database
- [ ] Test with example calls
- [ ] Update this design document
- [ ] Add integration tests

---

## Future Tool Ideas

- File/Document Reader (PDF, CSV, JSON)
- HTTP/API Request
- Database Query (read-only)
- JSON Transformer
- Memory/Context Management
- Code Execution Sandbox
- Image Analysis
- Notification/Webhook

---

## Appendix: Tool Execution Flow

```
User Message → Run Created → BullMQ Job Enqueued
                                    ↓
                            Orchestrator Worker
                                    ↓
                            Planner (LLM Phase 1)
                                    ↓
                            Executor (LLM Phase 2)
                                    ↓
                            Tool Registry Lookup
                                    ↓
                            Tool Handler Execute
                                    ↓
                            Validate Input (JSON Schema)
                                    ↓
                            Execute with Timeout
                                    ↓
                            Return ToolResult
                                    ↓
                            Log to RunStep & ToolCall tables
                                    ↓
                            Continue Executor Loop or Complete
```

---

**Version**: 1.0
**Last Updated**: 2024-01-15
**Maintained By**: Agent API Team
