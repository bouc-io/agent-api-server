import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { createComponentLogger } from '../../../lib/logger';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import duration from 'dayjs/plugin/duration';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(relativeTime);
dayjs.extend(advancedFormat);
dayjs.extend(duration);

const log = createComponentLogger('time-date-tool');

/**
 * Time & Date Tool - Handles time/date operations, timezone conversions, and date arithmetic
 */
export const timeDateTool: ToolHandler = {
    trust: 'trusted',
    name: 'time_date',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        const operation = args.operation as string;

        log.debug({ operation, args }, 'time_date: execute called');

        // Validate operation
        const validOperations = [
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
        ];

        if (!operation) {
            return {
                success: false,
                output: null,
                error: `Missing required parameter: operation. Must be one of: ${validOperations.join(', ')}`,
            };
        }
        if (!validOperations.includes(operation)) {
            return {
                success: false,
                output: null,
                error: `Unknown operation "${operation}". Must be one of: ${validOperations.join(', ')}`,
            };
        }

        try {
            let result: ToolResult;
            switch (operation) {
                case 'current_time':
                    result = await handleCurrentTime(args);
                    break;
                case 'convert_timezone':
                    result = await handleConvertTimezone(args);
                    break;
                case 'add_duration':
                    result = await handleAddDuration(args);
                    break;
                case 'subtract_duration':
                    result = await handleSubtractDuration(args);
                    break;
                case 'format_date':
                    result = await handleFormatDate(args);
                    break;
                case 'parse_date':
                    result = await handleParseDate(args);
                    break;
                case 'difference':
                    result = await handleDifference(args);
                    break;
                case 'is_past':
                    result = await handleIsPast(args);
                    break;
                case 'is_future':
                    result = await handleIsFuture(args);
                    break;
                case 'day_of_week':
                    result = await handleDayOfWeek(args);
                    break;
                default:
                    result = {
                        success: false,
                        output: null,
                        error: 'Unknown operation',
                    };
            }
            log.debug({ operation, result }, 'time_date: result');
            return result;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                output: null,
                error: `Time/Date operation error: ${errorMessage}`,
            };
        }
    },
};

/**
 * Get current time
 */
async function handleCurrentTime(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const tz = (args.timezone as string) || 'UTC';
    const format = args.format as string | undefined;

    // Validate timezone explicitly — dayjs silently falls back to local time
    // for unknown zones, which produces wrong results without any error.
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
        return {
            success: false,
            output: null,
            error: `Invalid IANA timezone: "${tz}". Use a valid identifier like "America/New_York", "Europe/London", "Asia/Tokyo", or "UTC".`,
        };
    }

    try {
        const now = dayjs().tz(tz);

        return {
            success: true,
            output: {
                iso: now.toISOString(),
                unix: now.unix(),
                timezone: tz,
                formatted: format ? now.format(format) : now.format(),
                day_of_week: now.format('dddd'),
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Timezone error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Convert between timezones
 */
async function handleConvertTimezone(
    args: Record<string, unknown>
): Promise<ToolResult> {
    // Default to current time when no date is provided (e.g. "what time is it in Tokyo?")
    const date = (args.date as string) || dayjs().toISOString();
    const sourceTimezone = (args.timezone as string) || 'UTC';
    const targetTimezone = args.target_timezone as string;

    if (!targetTimezone) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: target_timezone',
        };
    }

    // Validate both timezones before converting
    for (const [label, zone] of [['timezone', sourceTimezone], ['target_timezone', targetTimezone]] as const) {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: zone });
        } catch {
            return {
                success: false,
                output: null,
                error: `Invalid IANA timezone for "${label}": "${zone}"`,
            };
        }
    }

    try {
        const sourceDate = dayjs.tz(date, sourceTimezone);
        const targetDate = sourceDate.tz(targetTimezone);

        return {
            success: true,
            output: {
                source: {
                    iso: sourceDate.toISOString(),
                    timezone: sourceTimezone,
                    formatted: sourceDate.format(),
                },
                target: {
                    iso: targetDate.toISOString(),
                    timezone: targetTimezone,
                    formatted: targetDate.format(),
                },
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Timezone conversion error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Add duration to a date
 */
async function handleAddDuration(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = (args.date as string) || dayjs().toISOString();
    const durationStr = args.duration as string;
    const tz = (args.timezone as string) || 'UTC';

    if (!durationStr) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: duration',
        };
    }

    try {
        const parsedDuration = parseDuration(durationStr);
        const startDate = dayjs.tz(date, tz);
        const resultDate = startDate.add(
            parsedDuration.value,
            parsedDuration.unit
        );

        return {
            success: true,
            output: {
                original: startDate.toISOString(),
                result: resultDate.toISOString(),
                duration: durationStr,
                timezone: tz,
                formatted: resultDate.format(),
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Duration parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Subtract duration from a date
 */
async function handleSubtractDuration(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = (args.date as string) || dayjs().toISOString();
    const durationStr = args.duration as string;
    const tz = (args.timezone as string) || 'UTC';

    if (!durationStr) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: duration',
        };
    }

    try {
        const parsedDuration = parseDuration(durationStr);
        const startDate = dayjs.tz(date, tz);
        const resultDate = startDate.subtract(
            parsedDuration.value,
            parsedDuration.unit
        );

        return {
            success: true,
            output: {
                original: startDate.toISOString(),
                result: resultDate.toISOString(),
                duration: durationStr,
                timezone: tz,
                formatted: resultDate.format(),
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Duration parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Format a date according to a format string
 */
async function handleFormatDate(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = (args.date as string) || dayjs().toISOString();
    const format = args.format as string;
    const tz = (args.timezone as string) || 'UTC';

    if (!format) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: format',
        };
    }

    try {
        const dateObj = dayjs.tz(date, tz);
        const formatted = dateObj.format(format);

        return {
            success: true,
            output: {
                iso: dateObj.toISOString(),
                formatted,
                format,
                timezone: tz,
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Date formatting error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Parse a date string
 */
async function handleParseDate(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = args.date as string;
    const tz = (args.timezone as string) || 'UTC';

    if (!date) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: date',
        };
    }

    try {
        const parsed = dayjs.tz(date, tz);

        if (!parsed.isValid()) {
            return {
                success: false,
                output: null,
                error: 'Unable to parse date string',
            };
        }

        return {
            success: true,
            output: {
                iso: parsed.toISOString(),
                unix: parsed.unix(),
                timezone: tz,
                formatted: parsed.format(),
                day_of_week: parsed.format('dddd'),
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Date parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Calculate difference between dates
 */
async function handleDifference(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = args.date as string;
    const referenceDate =
        (args.reference_date as string) || dayjs().toISOString();

    if (!date) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: date',
        };
    }

    // LLMs sometimes confuse "difference" with "subtract_duration" and pass a duration instead of reference_date.
    // Catch this early with a clear redirect rather than silently ignoring the duration.
    if (args.duration && !args.reference_date) {
        return {
            success: false,
            output: null,
            error:
                'Operation "difference" computes the gap between two dates — use "date" and "reference_date". ' +
                'To subtract a time span from a date, use operation "subtract_duration" with "date" and "duration" instead.',
        };
    }

    try {
        const date1 = dayjs(referenceDate);
        const date2 = dayjs(date);

        // Signed ms: positive = date is after reference_date, negative = before
        const diffMs = date2.diff(date1);
        const absMs = Math.abs(diffMs);

        // All breakdown values are absolute; direction conveys the sign
        const diffSeconds = Math.floor(absMs / 1000);
        const diffMinutes = Math.floor(diffSeconds / 60);
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);
        const diffWeeks = Math.floor(diffDays / 7);

        // Use dayjs for calendar-accurate month/year counts
        const diffMonths = Math.abs(date2.diff(date1, 'month'));
        const diffYears = Math.abs(date2.diff(date1, 'year'));

        const direction: 'future' | 'past' | 'same' =
            diffMs > 0 ? 'future' : diffMs < 0 ? 'past' : 'same';

        const humanReadable = date1.to(date2);

        return {
            success: true,
            output: {
                direction,   // "future" | "past" | "same" (relative to reference_date)
                milliseconds: absMs,
                seconds: diffSeconds,
                minutes: diffMinutes,
                hours: diffHours,
                days: diffDays,
                weeks: diffWeeks,
                months: diffMonths,
                years: diffYears,
                human_readable: humanReadable,
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Difference calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Check if date is in the past
 */
async function handleIsPast(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = args.date as string;

    if (!date) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: date',
        };
    }

    try {
        const dateObj = dayjs(date);
        const now = dayjs();
        const isPast = dateObj.isBefore(now);

        return {
            success: true,
            output: {
                date: dateObj.toISOString(),
                is_past: isPast,
                current_time: now.toISOString(),
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Date comparison error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Check if date is in the future
 */
async function handleIsFuture(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = args.date as string;

    if (!date) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: date',
        };
    }

    try {
        const dateObj = dayjs(date);
        const now = dayjs();
        const isFuture = dateObj.isAfter(now);

        return {
            success: true,
            output: {
                date: dateObj.toISOString(),
                is_future: isFuture,
                current_time: now.toISOString(),
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Date comparison error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Get day of week for a date
 */
async function handleDayOfWeek(
    args: Record<string, unknown>
): Promise<ToolResult> {
    const date = args.date as string;

    if (!date) {
        return {
            success: false,
            output: null,
            error: 'Missing required parameter: date',
        };
    }

    try {
        const dateObj = dayjs(date);

        return {
            success: true,
            output: {
                date: dateObj.toISOString(),
                day_of_week: dateObj.format('dddd'),
                day_number: dateObj.day(), // 0-6 (Sunday-Saturday)
                formatted: dateObj.format(),
            },
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: `Date parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Parse duration string into value and unit
 * Examples: "2 hours", "3 days", "1 week", "30 minutes"
 */
function parseDuration(durationStr: string): {
    value: number;
    unit: dayjs.ManipulateType;
} {
    const parts = durationStr.trim().toLowerCase().split(/\s+/);

    if (parts.length < 2) {
        throw new Error(
            'Invalid duration format. Expected format: "2 hours", "3 days", etc.'
        );
    }

    const value = parseFloat(parts[0]);
    if (isNaN(value)) {
        throw new Error('Invalid duration value: must be a number');
    }

    let unit = parts[1];

    // Normalize plural forms
    const unitMap: Record<string, dayjs.ManipulateType> = {
        second: 'second',
        seconds: 'second',
        minute: 'minute',
        minutes: 'minute',
        hour: 'hour',
        hours: 'hour',
        day: 'day',
        days: 'day',
        week: 'week',
        weeks: 'week',
        month: 'month',
        months: 'month',
        year: 'year',
        years: 'year',
    };

    const normalizedUnit = unitMap[unit];
    if (!normalizedUnit) {
        throw new Error(
            `Invalid duration unit: ${unit}. Must be one of: ${Object.keys(unitMap).join(', ')}`
        );
    }

    return { value, unit: normalizedUnit };
}
