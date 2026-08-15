import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // Clear existing tools (optional - remove if you want to preserve existing tools)
    await prisma.tool.deleteMany({});
    console.log('  Cleared existing tools');

    // Seed Echo Tool
    const echoTool = await prisma.tool.upsert({
        where: { name: 'echo' },
        update: {},
        create: {
            name: 'echo',
            description: 'A simple echo tool that returns the input message. Useful for testing tool execution.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: 'The message to echo back',
                    },
                },
                required: ['message'],
            },
            policy: {
                max_calls_per_run: 10,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', echoTool.name);

    // Seed Web Search Tool
    const webSearchTool = await prisma.tool.upsert({
        where: { name: 'web_search' },
        update: {
            description: 'Search the web for information using DuckDuckGo. Returns relevant search results. Set fetch_top_result=true to also fetch and read the content of the top result URL.',
            schema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query to execute',
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 5)',
                        default: 5,
                    },
                    fetch_top_result: {
                        type: 'boolean',
                        description: 'If true, fetch and extract readable text from the top search result URL (default: false)',
                        default: false,
                    },
                },
                required: ['query'],
            },
        },
        create: {
            name: 'web_search',
            description: 'Search the web for information using DuckDuckGo. Returns relevant search results. Set fetch_top_result=true to also fetch and read the content of the top result URL.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query to execute',
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 5)',
                        default: 5,
                    },
                    fetch_top_result: {
                        type: 'boolean',
                        description: 'If true, fetch and extract readable text from the top search result URL (default: false)',
                        default: false,
                    },
                },
                required: ['query'],
            },
            policy: {
                max_calls_per_run: 5,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', webSearchTool.name);

    // Seed Calculator Tool
    const calculatorTool = await prisma.tool.upsert({
        where: { name: 'calculator' },
        update: {
            description:
                'Evaluates math expressions. Supports arithmetic, sqrt, sin, cos, log, pi, e. Use ^ for exponentiation (e.g. "1000 * 1.05^10"), NOT **.',
            schema: {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description:
                            'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(pi/2)", "(100 - 20) / 4", "1000 * 1.05^10"). Use ^ for exponentiation, NOT **.',
                    },
                    precision: {
                        type: 'number',
                        description:
                            'Number of decimal places in result (0-20, default: 10)',
                        default: 10,
                        minimum: 0,
                        maximum: 20,
                    },
                },
                required: ['expression'],
            },
        },
        create: {
            name: 'calculator',
            description:
                'Evaluates math expressions. Supports arithmetic, sqrt, sin, cos, log, pi, e. Use ^ for exponentiation (e.g. "1000 * 1.05^10"), NOT **.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description:
                            'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(pi/2)", "(100 - 20) / 4", "1000 * 1.05^10"). Use ^ for exponentiation, NOT **.',
                    },
                    precision: {
                        type: 'number',
                        description:
                            'Number of decimal places in result (0-20, default: 10)',
                        default: 10,
                        minimum: 0,
                        maximum: 20,
                    },
                },
                required: ['expression'],
            },
            policy: {
                max_calls_per_run: 100,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', calculatorTool.name);

    const timeDateDescription =
        'Time and date operations. "operation" is required. ' +
        'Use "difference" to compute the gap between two dates (date + reference_date). ' +
        'Use "subtract_duration" to subtract a time span from a date (date + duration). ' +
        'Do NOT pass "duration" to "difference" — use "subtract_duration" instead.';

    const timeDateSchema = {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: [
                    'current_time',
                    'convert_timezone',
                    'add_duration',
                    'subtract_duration',
                    'format_date',
                    'parse_date',
                    'difference',
                    'is_past',
                    'is_future',
                    'day_of_week',
                ],
                description:
                    'Required. The time/date operation to perform. ' +
                    '"difference": gap between two dates — needs date + reference_date. ' +
                    '"subtract_duration": date minus a span — needs date + duration. ' +
                    '"add_duration": date plus a span — needs date + duration.',
            },
            timezone: {
                type: 'string',
                description:
                    'IANA timezone identifier (e.g., "America/New_York", "Europe/London", "Asia/Tokyo")',
            },
            date: {
                type: 'string',
                description:
                    'Date in ISO 8601 format or natural language (e.g., "2024-01-15", "tomorrow")',
            },
            target_timezone: {
                type: 'string',
                description: 'Target timezone for conversion operations',
            },
            format: {
                type: 'string',
                description:
                    'Output format string (e.g., "YYYY-MM-DD", "h:mm A", "dddd, MMMM Do YYYY")',
            },
            duration: {
                type: 'string',
                description:
                    'Duration string for add_duration / subtract_duration (e.g., "2 hours", "3 days", "1 week"). NOT used with "difference".',
            },
            reference_date: {
                type: 'string',
                description:
                    'Second date for "difference" operation (defaults to current time). Do NOT use with subtract_duration.',
            },
        },
        required: ['operation'],
    };

    // Seed Time & Date Tool
    const timeDateTool = await prisma.tool.upsert({
        where: { name: 'time_date' },
        update: {
            description: timeDateDescription,
            schema: timeDateSchema,
        },
        create: {
            name: 'time_date',
            description: timeDateDescription,
            enabled: true,
            schema: timeDateSchema,
            policy: {
                max_calls_per_run: 50,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', timeDateTool.name);

    // Seed HTTP Request Tool
    const httpRequestToolSchema = {
        type: 'object',
        properties: {
            api_id: {
                type: 'string',
                description:
                    'Pre-configured API ID. Options: open_meteo_weather, open_meteo_geocoding',
            },
            url: {
                type: 'string',
                description: 'Full URL for custom requests (use this OR api_id, not both)',
            },
            method: {
                type: 'string',
                enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                default: 'GET',
                description: 'HTTP method to use',
            },
            endpoint: {
                type: 'string',
                description:
                    'REQUIRED when using api_id. The path to call (e.g., "/forecast", "/search"). Omitting this will cause an error.',
            },
            params: {
                type: 'object',
                description: 'URL query parameters as key-value pairs',
            },
            headers: {
                type: 'object',
                description: 'Custom HTTP headers as key-value pairs',
            },
            body: {
                type: 'object',
                description: 'Request body for POST/PUT/PATCH requests',
            },
            timeout: {
                type: 'number',
                description: 'Request timeout in milliseconds (default: 10000, max: 30000)',
                default: 10000,
                minimum: 1000,
                maximum: 30000,
            },
            max_response_chars: {
                type: 'number',
                description:
                    'Maximum characters of response body to return (default: 50000). ' +
                    'Use a smaller value if the response is too large for context. ' +
                    'Response is truncated with truncated:true when the limit is hit.',
                default: 50000,
            },
            json_path: {
                type: 'string',
                description:
                    'Dot-notation path to extract a sub-field from the JSON response ' +
                    'instead of returning the full body (e.g. "results[0].name", "hourly.temperature_2m"). ' +
                    'Useful for large API responses where only one field is needed.',
            },
        },
        // NOTE: No `required` here — the tool has two modes (api_id vs url),
        // enforced by description rather than schema (oneOf is not supported by Anthropic).
    };
    const httpRequestToolData = {
        name: 'http_request',
        description:
            'Makes HTTP requests. Two modes — pick one:\n' +
            'MODE A (pre-configured API): provide api_id AND endpoint together — both are required.\n' +
            '  • Geocode a city → api_id:"open_meteo_geocoding", endpoint:"/search", params:{name:"Paris",count:"1"}\n' +
            '  • Current weather → api_id:"open_meteo_weather", endpoint:"/forecast", params:{latitude:"48.8566",longitude:"2.3522",current_weather:"true"}\n' +
            'MODE B (custom URL): provide url with all query params already embedded (e.g. "https://api.example.com/data?key=val").\n' +
            'Use json_path to extract one field from a large JSON response (e.g. "current_weather.temperature").',
        enabled: true,
        schema: httpRequestToolSchema,
        policy: {
            max_calls_per_run: 20,
            requires_approval: false,
            state_changing: true,
            timeout_ms: 30000,
        },
    };
    const httpRequestTool = await prisma.tool.upsert({
        where: { name: 'http_request' },
        update: { schema: httpRequestToolSchema, description: httpRequestToolData.description },
        create: httpRequestToolData,
    });
    console.log('  ✅ Created tool:', httpRequestTool.name);

    // Seed Fetch Page Tool
    const fetchPageTool = await prisma.tool.upsert({
        where: { name: 'fetch_page' },
        update: {},
        create: {
            name: 'fetch_page',
            description:
                'Fetch a URL and extract clean readable text content from the page. ' +
                'Complements web_search: use web_search to find URLs, then fetch_page to read them. ' +
                'Strips navigation, scripts, and boilerplate to return just the main content.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to fetch (must be http or https)',
                    },
                    selector: {
                        type: 'string',
                        description: 'CSS selector to scope extraction (default: body)',
                    },
                    max_length: {
                        type: 'number',
                        description: 'Maximum characters to return (default: 5000, max: 20000)',
                        default: 5000,
                        minimum: 100,
                        maximum: 20000,
                    },
                },
                required: ['url'],
            },
            policy: {
                max_calls_per_run: 10,
                requires_approval: false,
                timeout_ms: 15000,
            },
        },
    });
    console.log('  ✅ Created tool:', fetchPageTool.name);

    // Seed JSON Query Tool
    const jsonQueryTool = await prisma.tool.upsert({
        where: { name: 'json_query' },
        update: {},
        create: {
            name: 'json_query',
            description:
                'Extract values from JSON data using dot-path notation. ' +
                'Useful for pulling specific fields from large API responses without passing the whole payload to the model. ' +
                'Supports nested paths (data.results.count), array indexing (results[0].name), and wildcards (results[*].url).',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    data: {
                        description: 'JSON string or object to query',
                    },
                    path: {
                        type: 'string',
                        description: 'Dot-notation path, e.g. "results[0].name" or "items[*].url"',
                    },
                    default_value: {
                        description: 'Value to return if the path is not found (optional)',
                    },
                },
                required: ['data', 'path'],
            },
            policy: {
                max_calls_per_run: 50,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', jsonQueryTool.name);

    // Seed Text Extract Tool
    const textExtractTool = await prisma.tool.upsert({
        where: { name: 'text_extract' },
        update: {},
        create: {
            name: 'text_extract',
            description:
                'Extract structured data from unstructured text using regular expressions. ' +
                'Operations: find_all (all matches), find_first (first match with index), ' +
                'extract_groups (named/indexed capture groups), replace (substitution with backreferences).',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'Input text to process (max 100,000 characters)',
                    },
                    pattern: {
                        type: 'string',
                        description: 'JavaScript regex pattern without delimiters, e.g. "[\\\\w.]+@[\\\\w.]+\\\\.[a-z]+"',
                    },
                    flags: {
                        type: 'string',
                        description: 'Regex flags: g (global), i (case-insensitive), m (multiline), s (dot-all) — default: "g"',
                        default: 'g',
                    },
                    operation: {
                        type: 'string',
                        enum: ['find_all', 'find_first', 'extract_groups', 'replace'],
                        description: 'Operation to perform on the text',
                    },
                    replacement: {
                        type: 'string',
                        description: 'Replacement string for the replace operation (supports $1, $2, $<name> backreferences)',
                    },
                },
                required: ['text', 'pattern', 'operation'],
            },
            policy: {
                max_calls_per_run: 100,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', textExtractTool.name);

    // Seed Memory Search Tool
    const memorySearchTool = await prisma.tool.upsert({
        where: { name: 'memory_search' },
        update: {},
        create: {
            name: 'memory_search',
            description:
                'Search the memory service for stored memories relevant to a query. ' +
                'Use this to recall facts, preferences, or past context about the user mid-execution. ' +
                'Returns memories sorted by relevance with confidence scores. ' +
                'Only available when MEMORY_SERVICE_ENABLED=true.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Semantic search query to find relevant memories (e.g. "user food preferences", "previous project names")',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of memories to return (default: 5, max: 10)',
                        default: 5,
                        minimum: 1,
                        maximum: 10,
                    },
                },
                required: ['query'],
            },
            policy: {
                max_calls_per_run: 20,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', memorySearchTool.name);

    // ── Client-side tools (executed locally by agent-cli) ────────────────────
    // These are seeded so the LLM knows about them, but execution is delegated
    // to the CLI via the tool.client_call SSE event + POST /tool-results.

    const bashTool = await prisma.tool.upsert({
        where: { name: 'bash' },
        update: {},
        create: {
            name: 'bash',
            description:
                'Execute a shell command on the local machine where the CLI is running. ' +
                'Returns stdout, stderr, and exit code. ' +
                'Use for file manipulation, running scripts, listing directories, and other shell operations. ' +
                'Commands run in the user\'s current working directory.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute',
                    },
                    cwd: {
                        type: 'string',
                        description:
                            'Working directory for the command (defaults to the CLI\'s current directory)',
                    },
                    timeout_ms: {
                        type: 'number',
                        description: 'Maximum execution time in milliseconds (default: 30000)',
                        default: 30000,
                    },
                },
                required: ['command'],
            },
            policy: {
                max_calls_per_run: 20,
                requires_approval: false, // Approval handled interactively by the CLI
            },
        },
    });
    console.log('  ✅ Created tool:', bashTool.name);

    const readFileTool = await prisma.tool.upsert({
        where: { name: 'read_file' },
        update: {},
        create: {
            name: 'read_file',
            description:
                'Read the contents of a file on the local machine where the CLI is running. ' +
                'Returns the file content as a string. Supports text files.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute or relative path to the file to read',
                    },
                    encoding: {
                        type: 'string',
                        description: 'File encoding (default: utf8)',
                        default: 'utf8',
                    },
                },
                required: ['path'],
            },
            policy: {
                max_calls_per_run: 50,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', readFileTool.name);

    const writeFileTool = await prisma.tool.upsert({
        where: { name: 'write_file' },
        update: {
            policy: {
                max_calls_per_run: 20,
                requires_approval: false, // Approval handled interactively by the CLI
            },
        },
        create: {
            name: 'write_file',
            description:
                'Write or overwrite a file on the local machine where the CLI is running. ' +
                'Creates parent directories if create_dirs is true. ' +
                'You MUST use exactly the parameter names "path" and "content" — do not use "file_path", "filename", "text", or any other aliases.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute or relative path to the file to write. Parameter name is "path" (not "file_path" or "filename").',
                    },
                    content: {
                        type: 'string',
                        description: 'The full text content to write to the file. Parameter name is "content" (not "text", "code", or "body").',
                    },
                    create_dirs: {
                        type: 'boolean',
                        description:
                            'Create parent directories if they do not exist (default: false)',
                        default: false,
                    },
                },
                required: ['path', 'content'],
            },
            policy: {
                max_calls_per_run: 20,
                requires_approval: false, // Approval handled interactively by the CLI
            },
        },
    });
    console.log('  ✅ Created tool:', writeFileTool.name);

    const globFilesTool = await prisma.tool.upsert({
        where: { name: 'glob_files' },
        update: {},
        create: {
            name: 'glob_files',
            description:
                'Find files matching a glob pattern on the local machine where the CLI is running. ' +
                'Returns a list of matching file paths. Example patterns: "**/*.ts", "src/**/*.json".',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Glob pattern to match files against (e.g. "**/*.ts")',
                    },
                    cwd: {
                        type: 'string',
                        description:
                            'Base directory for the search (defaults to the CLI\'s current directory)',
                    },
                },
                required: ['pattern'],
            },
            policy: {
                max_calls_per_run: 20,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', globFilesTool.name);

    const listDirTool = await prisma.tool.upsert({
        where: { name: 'list_dir' },
        update: {},
        create: {
            name: 'list_dir',
            description:
                'List the contents of a directory on the local machine where the CLI is running. ' +
                'Returns file names, types (file/directory), sizes, and modification times.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute or relative path to the directory to list',
                    },
                    show_hidden: {
                        type: 'boolean',
                        description: 'Include hidden files (starting with .) (default: false)',
                        default: false,
                    },
                },
                required: ['path'],
            },
            policy: {
                max_calls_per_run: 50,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', listDirTool.name);

    const grepFilesTool = await prisma.tool.upsert({
        where: { name: 'grep_files' },
        update: {
            description:
                'Search for a regex pattern in files on the local machine. ' +
                'Uses ripgrep if installed, falls back to grep. ' +
                'Returns structured matches with file path, line number, and matched content. ' +
                'Faster than bash+grep and returns structured output.',
            schema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Regex pattern to search for',
                    },
                    path: {
                        type: 'string',
                        description: 'Directory or file to search (default: current directory)',
                        default: '.',
                    },
                    case_insensitive: {
                        type: 'boolean',
                        description: 'Case-insensitive match (default: false)',
                        default: false,
                    },
                    include_glob: {
                        type: 'string',
                        description: 'Only search files matching this glob pattern (e.g. "*.ts")',
                    },
                    context_lines: {
                        type: 'number',
                        description: 'Lines of context to show around each match (default: 0)',
                        default: 0,
                        minimum: 0,
                        maximum: 10,
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of matches to return (default: 200)',
                        default: 200,
                    },
                },
                required: ['pattern'],
            },
        },
        create: {
            name: 'grep_files',
            description:
                'Search for a regex pattern in files on the local machine. ' +
                'Uses ripgrep if installed, falls back to grep. ' +
                'Returns structured matches with file path, line number, and matched content. ' +
                'Faster than bash+grep and returns structured output.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Regex pattern to search for',
                    },
                    path: {
                        type: 'string',
                        description: 'Directory or file to search (default: current directory)',
                        default: '.',
                    },
                    case_insensitive: {
                        type: 'boolean',
                        description: 'Case-insensitive match (default: false)',
                        default: false,
                    },
                    include_glob: {
                        type: 'string',
                        description: 'Only search files matching this glob pattern (e.g. "*.ts")',
                    },
                    context_lines: {
                        type: 'number',
                        description: 'Lines of context to show around each match (default: 0)',
                        default: 0,
                        minimum: 0,
                        maximum: 10,
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of matches to return (default: 200)',
                        default: 200,
                    },
                },
                required: ['pattern'],
            },
            policy: {
                max_calls_per_run: 30,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', grepFilesTool.name);

    const fileEditTool = await prisma.tool.upsert({
        where: { name: 'file_edit' },
        update: {
            description:
                'Replace an exact unique string in a local file. ' +
                'old_string must match the file content EXACTLY (including whitespace and indentation) and must appear EXACTLY ONCE. ' +
                'If old_string appears multiple times, add more surrounding context to make it unique. ' +
                'Prefer this over write_file for targeted edits — it is safer and shows a diff in the approval UI.',
            schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file to edit',
                    },
                    old_string: {
                        type: 'string',
                        description:
                            'The exact text to replace. Must appear exactly once in the file. Include enough surrounding context to be unique.',
                    },
                    new_string: {
                        type: 'string',
                        description: 'The text to replace old_string with',
                    },
                },
                required: ['path', 'old_string', 'new_string'],
            },
        },
        create: {
            name: 'file_edit',
            description:
                'Replace an exact unique string in a local file. ' +
                'old_string must match the file content EXACTLY (including whitespace and indentation) and must appear EXACTLY ONCE. ' +
                'If old_string appears multiple times, add more surrounding context to make it unique. ' +
                'Prefer this over write_file for targeted edits — it is safer and shows a diff in the approval UI.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file to edit',
                    },
                    old_string: {
                        type: 'string',
                        description:
                            'The exact text to replace. Must appear exactly once in the file. Include enough surrounding context to be unique.',
                    },
                    new_string: {
                        type: 'string',
                        description: 'The text to replace old_string with',
                    },
                },
                required: ['path', 'old_string', 'new_string'],
            },
            policy: {
                max_calls_per_run: 30,
                requires_approval: false, // Approval handled interactively by the CLI
            },
        },
    });
    console.log('  ✅ Created tool:', fileEditTool.name);

    // str_replace_file is a common LLM name for the same operation — keep both registered
    const strReplaceFileTool = await prisma.tool.upsert({
        where: { name: 'str_replace_file' },
        update: {},
        create: {
            name: 'str_replace_file',
            description:
                'Alias for file_edit. Replace an exact unique string in a local file. ' +
                'old_string must match exactly once in the file.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the file to edit' },
                    old_string: { type: 'string', description: 'Exact text to replace (must be unique in file)' },
                    new_string: { type: 'string', description: 'Replacement text' },
                },
                required: ['path', 'old_string', 'new_string'],
            },
            policy: { max_calls_per_run: 30, requires_approval: false },
        },
    });
    console.log('  ✅ Created tool:', strReplaceFileTool.name);

    const webFetchTool = await prisma.tool.upsert({
        where: { name: 'web_fetch' },
        update: {
            description:
                'Fetch the text content of a URL from the local machine. ' +
                'HTML is stripped to plain text. ' +
                'Useful for reading documentation, articles, or any web page. ' +
                'Complements web_search: use web_search to find URLs then web_fetch to read them.',
            schema: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to fetch (must be http or https)',
                    },
                    max_chars: {
                        type: 'number',
                        description: 'Maximum characters of text to return (default: 10000)',
                        default: 10000,
                    },
                },
                required: ['url'],
            },
        },
        create: {
            name: 'web_fetch',
            description:
                'Fetch the text content of a URL from the local machine. ' +
                'HTML is stripped to plain text. ' +
                'Useful for reading documentation, articles, or any web page. ' +
                'Complements web_search: use web_search to find URLs then web_fetch to read them.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to fetch (must be http or https)',
                    },
                    max_chars: {
                        type: 'number',
                        description: 'Maximum characters of text to return (default: 10000)',
                        default: 10000,
                    },
                },
                required: ['url'],
            },
            policy: {
                max_calls_per_run: 10,
                requires_approval: false,
                timeout_ms: 15000,
            },
        },
    });
    console.log('  ✅ Created tool:', webFetchTool.name);

    const fileDeleteTool = await prisma.tool.upsert({
        where: { name: 'file_delete' },
        update: {},
        create: {
            name: 'file_delete',
            description:
                'Delete a file or directory on the local machine. ' +
                'Requires user approval in the CLI before executing. ' +
                'Set recursive=true to delete a non-empty directory and all its contents — use with caution.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute or relative path to the file or directory to delete',
                    },
                    recursive: {
                        type: 'boolean',
                        description:
                            'If true, delete a directory and all its contents recursively (default: false). ' +
                            'Without this flag, deleting a non-empty directory will fail.',
                        default: false,
                    },
                },
                required: ['path'],
            },
            policy: {
                max_calls_per_run: 10,
                requires_approval: false, // Approval handled interactively by the CLI
            },
        },
    });
    console.log('  ✅ Created tool:', fileDeleteTool.name);

    const fileMoveTool = await prisma.tool.upsert({
        where: { name: 'file_move' },
        update: {},
        create: {
            name: 'file_move',
            description:
                'Move or rename a file or directory on the local machine. ' +
                'Requires user approval in the CLI before executing. ' +
                'Works across filesystems (falls back to copy+delete if needed).',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    source: {
                        type: 'string',
                        description: 'Absolute or relative path to the file or directory to move',
                    },
                    destination: {
                        type: 'string',
                        description: 'Target path (including filename if renaming)',
                    },
                },
                required: ['source', 'destination'],
            },
            policy: {
                max_calls_per_run: 10,
                requires_approval: false, // Approval handled interactively by the CLI
            },
        },
    });
    console.log('  ✅ Created tool:', fileMoveTool.name);

    const processListTool = await prisma.tool.upsert({
        where: { name: 'process_list' },
        update: {},
        create: {
            name: 'process_list',
            description:
                'List running processes on the local machine. ' +
                'Returns pid, cpu%, mem%, name, and full command for each process. ' +
                'Use the optional filter to search by process name or command substring.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    filter: {
                        type: 'string',
                        description:
                            'Optional substring filter applied to process name and command (case-insensitive). ' +
                            'If omitted, all running processes are returned.',
                    },
                },
                required: [],
            },
            policy: {
                max_calls_per_run: 20,
                requires_approval: false,
            },
        },
    });
    console.log('  ✅ Created tool:', processListTool.name);

    const askUserTool = await prisma.tool.upsert({
        where: { name: 'ask_user' },
        update: {
            description:
                'Ask the user a question and wait for their answer. ' +
                'If options are provided, the user selects one by pressing a number. ' +
                'If no options are provided, the user types a free-text answer. ' +
                'Use this when you need a decision or clarification from the user before proceeding.',
            schema: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to present to the user',
                    },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Optional list of selectable answers. If provided, the user picks one by pressing its number. ' +
                            'If omitted, the user types a free-text answer.',
                    },
                },
                required: ['question'],
            },
        },
        create: {
            name: 'ask_user',
            description:
                'Ask the user a question and wait for their answer. ' +
                'If options are provided, the user selects one by pressing a number. ' +
                'If no options are provided, the user types a free-text answer. ' +
                'Use this when you need a decision or clarification from the user before proceeding.',
            enabled: true,
            requires_client_execution: true,
            schema: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to present to the user',
                    },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Optional list of selectable answers. If provided, the user picks one by pressing its number. ' +
                            'If omitted, the user types a free-text answer.',
                    },
                },
                required: ['question'],
            },
            policy: {
                max_calls_per_run: 10,
                requires_approval: false, // The "approval" IS the answer — handled by the CLI UI
            },
        },
    });
    console.log('  ✅ Created tool:', askUserTool.name);

    // Seed Code Execute Tool (sandboxed, server-side, approval-gated)
    const codeExecuteTool = await prisma.tool.upsert({
        where: { name: 'code_execute' },
        update: {},
        create: {
            name: 'code_execute',
            description:
                'Execute a short program in a sandboxed, network-isolated container and return its stdout, stderr, and exit code. ' +
                'Use for computation, data transformation, parsing, and quick scripts. Supported languages: python, node. ' +
                'No network access is available inside the sandbox.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    language: {
                        type: 'string',
                        enum: ['python', 'node'],
                        description: 'Programming language to run (default: python)',
                        default: 'python',
                    },
                    code: {
                        type: 'string',
                        description: 'The program source code to execute',
                    },
                    stdin: {
                        type: 'string',
                        description: 'Optional data piped to the program on standard input',
                    },
                    timeout_ms: {
                        type: 'number',
                        description: 'Optional wall-clock timeout in milliseconds (default 10000, max 60000)',
                    },
                },
                required: ['code'],
            },
            policy: {
                max_calls_per_run: 10,
                requires_approval: true,
                state_changing: true,
            },
        },
    });
    console.log('  ✅ Created tool:', codeExecuteTool.name);

    // Seed Scratchpad Tools (server-side, durable per-assignment workspace)
    const scratchpadWriteTool = await prisma.tool.upsert({
        where: { name: 'scratchpad_write' },
        update: {},
        create: {
            name: 'scratchpad_write',
            description:
                'Save a named note to the assignment scratchpad — a durable workspace that persists across runs. ' +
                'Use it to record plans, intermediate results, and findings you want to recall later.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'Identifier for the note (e.g. "plan", "findings")' },
                    content: { type: 'string', description: 'The note content to store' },
                },
                required: ['key', 'content'],
            },
            policy: { max_calls_per_run: 20, requires_approval: false },
        },
    });
    console.log('  ✅ Created tool:', scratchpadWriteTool.name);

    const scratchpadReadTool = await prisma.tool.upsert({
        where: { name: 'scratchpad_read' },
        update: {},
        create: {
            name: 'scratchpad_read',
            description:
                'Read a named note from the assignment scratchpad, or list all note keys when no key is given. ' +
                'Notes persist across runs of the same assignment.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'Note identifier to read; omit to list all keys' },
                },
                required: [],
            },
            policy: { max_calls_per_run: 20, requires_approval: false },
        },
    });
    console.log('  ✅ Created tool:', scratchpadReadTool.name);

    // Seed Sub-agent Tool (delegates a sub-task to a scoped child run)
    const spawnSubagentTool = await prisma.tool.upsert({
        where: { name: 'spawn_subagent' },
        update: {},
        create: {
            name: 'spawn_subagent',
            description:
                'Delegate a self-contained sub-task to a scoped child agent with its own context and budget. ' +
                'Blocks until the child finishes and returns its final answer. Use for decomposable, independent sub-tasks.',
            enabled: true,
            schema: {
                type: 'object',
                properties: {
                    goal: { type: 'string', description: 'The sub-task goal for the child agent to accomplish' },
                    context: { type: 'string', description: 'Optional supporting context to pass to the child agent' },
                },
                required: ['goal'],
            },
            policy: { max_calls_per_run: 5, requires_approval: false },
        },
    });
    console.log('  ✅ Created tool:', spawnSubagentTool.name);

    console.log('✨ Seeding complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
