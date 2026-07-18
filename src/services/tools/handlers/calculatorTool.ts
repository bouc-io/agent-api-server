import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { create, all, MathJsInstance, Unit } from 'mathjs';
import { createComponentLogger } from '../../../lib/logger';

const log = createComponentLogger('calculator-tool');

/**
 * Singleton mathjs instance — created once at module load, not per request.
 * Creating it inside execute() was an expensive mistake (~20ms per call).
 */
const math: MathJsInstance = create(all, {
    number: 'BigNumber',
    precision: 64,
});

/**
 * Strip trailing zeros from a fixed-precision number string.
 * "42.0000000000" → "42"
 * "3.1400000000"  → "3.14"
 * "0.1234500000"  → "0.12345"
 */
function stripTrailingZeros(fixed: string): string {
    if (!fixed.includes('.')) return fixed;
    return fixed.replace(/\.?0+$/, '');
}

/**
 * Format a numeric result to the requested precision, stripping meaningless trailing zeros.
 */
function formatResult(value: number, precision: number): string {
    if (precision === 0) return Math.round(value).toString();
    return stripTrailingZeros(value.toFixed(precision));
}

/**
 * Calculator Tool - Safe mathematical expression evaluator
 * Uses mathjs library for secure calculation without eval()
 */
export const calculatorTool: ToolHandler = {
    trust: 'trusted',
    name: 'calculator',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        const expression = args.expression as string;
        const precision = (args.precision as number) ?? 10;

        log.debug({ expression, precision }, 'calculator: execute called');

        // Validation
        if (!expression || typeof expression !== 'string') {
            return {
                success: false,
                output: null,
                error: 'Missing or invalid required parameter: expression (must be a string)',
            };
        }

        if (expression.length > 500) {
            return {
                success: false,
                output: null,
                error: 'Expression too long (max 500 characters)',
            };
        }

        if (typeof precision !== 'number' || precision < 0 || precision > 20) {
            return {
                success: false,
                output: null,
                error: 'Precision must be a number between 0 and 20',
            };
        }

        try {
            // Strip trailing "= ?" or "= <value>" patterns the LLM sometimes appends
            // as answer hints (e.g. "(2 + 2) * 3 = ?" → "(2 + 2) * 3").
            // mathjs treats "=" as assignment and rejects "?" as an invalid right-hand side.
            // Also replace Python/JS-style ** exponentiation with mathjs ^ operator.
            const cleanExpression = expression
                .replace(/\s*=\s*.*$/, '')  // strip trailing "= ?" hint
                .replace(/\*\*/g, '^')       // ** → ^ (mathjs exponentiation syntax)
                .trim();

            const rawResult = math.evaluate(cleanExpression);

            // Multi-statement: mathjs returns an array — use the last value
            const result = Array.isArray(rawResult)
                ? rawResult[rawResult.length - 1]
                : rawResult;

            // Unit result (e.g. "5 km + 3 m", "5 miles to km")
            if (result instanceof Unit) {
                const unitStr = result.toString();
                // Also expose the numeric value in SI base units when possible
                let numericValue: number | null = null;
                try {
                    numericValue = result.toNumber();
                } catch {
                    // Some compound units don't have a scalar value
                }

                log.debug({ expression: cleanExpression, unitStr }, 'calculator: unit result');
                return {
                    success: true,
                    output: {
                        expression: cleanExpression,
                        result: unitStr,
                        numeric_value: numericValue,
                        type: 'unit',
                        precision,
                    },
                };
            }

            // Convert to number (handles BigNumber, Complex, etc.)
            let numericResult: number;
            if (typeof result === 'object' && result !== null) {
                numericResult = Number(result.toString());
            } else {
                numericResult = Number(result);
            }

            if (!isFinite(numericResult)) {
                return {
                    success: false,
                    output: null,
                    error: 'Result is not a finite number (infinity or NaN) — check your expression',
                };
            }

            const formatted = formatResult(numericResult, precision);

            log.debug({ expression: cleanExpression, numericResult, formatted }, 'calculator: result computed');

            return {
                success: true,
                output: {
                    expression: cleanExpression,
                    result: numericResult,
                    formatted,
                    type: 'number',
                    precision,
                },
            };
        } catch (error) {
            return {
                success: false,
                output: null,
                error: `Calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    },
};
