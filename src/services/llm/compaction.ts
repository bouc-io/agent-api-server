import { LLMMessage, LLMClient } from '../../types/llm';
import { createComponentLogger } from '../../lib/logger';

const log = createComponentLogger('compaction');

const DEFAULT_KEEP_RECENT = parseInt(process.env.MAX_HISTORY_MESSAGES || '10', 10);

export interface CompactionOptions {
    /** Model name (reserved for future model-aware thresholds). */
    model?: string | null;
    /** Number of most recent messages kept verbatim; older ones are summarized. */
    keepRecent?: number;
}

export interface CompactionResult {
    /** Messages after compaction (leading system msg + rolling summary + recent). */
    messages: LLMMessage[];
    /** True when older turns were summarized into a rolling summary. */
    compacted: boolean;
    /** How many older messages were folded into the summary (or dropped on fallback). */
    summarizedCount: number;
    /** The generated rolling summary text, when compaction succeeded. */
    summary?: string;
}

/**
 * Compaction (not truncation): when the conversation exceeds the keep-recent
 * window, summarize the older turns into a single rolling-summary system message
 * instead of dropping them, so earlier goals/decisions/facts survive long sessions.
 *
 * A leading system message (if present) is preserved outside the window. If the
 * summarizer call fails or returns nothing, falls back to plain truncation (keep
 * the recent turns only) so a run never blocks on summarization.
 */
export async function compactHistory(
    messages: LLMMessage[],
    summarizer: LLMClient,
    options: CompactionOptions = {}
): Promise<CompactionResult> {
    const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;

    if (messages.length <= keepRecent) {
        return { messages, compacted: false, summarizedCount: 0 };
    }

    const hasSystem = messages.length > 0 && messages[0].role === 'system';
    const lead = hasSystem ? [messages[0]] : [];
    const body = hasSystem ? messages.slice(1) : messages.slice();

    if (body.length <= keepRecent) {
        return { messages, compacted: false, summarizedCount: 0 };
    }

    const older = body.slice(0, body.length - keepRecent);
    const recent = body.slice(body.length - keepRecent);

    const transcript = older
        .map((m) => `${(m.role || 'user').toUpperCase()}: ${m.content ?? ''}`)
        .join('\n');

    let summaryText = '';
    try {
        const resp = await summarizer.chat(
            [
                {
                    role: 'system',
                    content:
                        "/no_think\nYou compress conversation history. Summarize the earlier turns below into a concise factual summary (<=200 words) capturing the user's goals, key decisions, established facts, and any open threads. Output ONLY the summary text.",
                },
                { role: 'user', content: transcript },
            ],
            { think: false }
        );
        summaryText = (resp.content || '').trim();
    } catch (err) {
        log.warn({ err }, 'compaction: summarizer call failed — falling back to truncation');
    }

    if (!summaryText) {
        return { messages: [...lead, ...recent], compacted: false, summarizedCount: older.length };
    }

    const summaryMessage: LLMMessage = {
        role: 'system',
        content: `Summary of earlier conversation (older turns compacted to save context):\n${summaryText}`,
    };

    return {
        messages: [...lead, summaryMessage, ...recent],
        compacted: true,
        summarizedCount: older.length,
        summary: summaryText,
    };
}
