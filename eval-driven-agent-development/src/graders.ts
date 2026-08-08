// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

/**
 * The eval, declaratively.
 *
 * Each scorecard column is a `Grader` object: a name, a kind (code-grader
 * vs LLM-judge), a one-line description, and a `grade` method that turns a
 * prepared GraderContext into one number (or short string) for the table.
 *
 * The harness (eval-runner.ts) builds the context once per deck — parsed pptx,
 * rendered JPGs, memoized judge calls — and runs every check against it.
 * Adding a metric = appending one object to GRADERS.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import memoize from "lodash/memoize.js";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { JUDGE_MODEL, JUDGE_VIA_TOOL_CALL } from "./lib.js";

export type { Grader, GraderContext } from "./graders/types.js";
import type { Grader, GraderContext } from "./graders/types.js";

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One 0-5 rubric score. */
const ScoreSchema = z.number().int().min(0).max(5);

// --------------------------------------------------------------- judging

/**
 * Ask the judge model for one object matching `schema`, two ways.
 *
 * Structured outputs (`output_config`) is the direct route, but it is a
 * hosted-Anthropic feature. Endpoints that don't implement it generally accept
 * the field and answer in prose anyway — which surfaces as a missing score and
 * averages to NaN instead of raising. So when JUDGE_VIA_TOOL_CALL is set we
 * ask for the identical shape through a tool the model is forced to call,
 * which every Anthropic-protocol endpoint supports.
 *
 * Returns null when the model produced no structured result at all.
 */
async function judgeStructured<T extends z.ZodType>(
    client: Anthropic,
    schema: T,
    jsonSchema: Record<string, unknown>,
    system: string,
    content: Anthropic.Messages.MessageParam["content"],
): Promise<z.infer<T> | null> {
    if (JUDGE_VIA_TOOL_CALL) {
        const resp = await client.messages.create(
            {
                model: JUDGE_MODEL,
                max_tokens: 512,
                system,
                messages: [{ role: "user", content }],
                tools: [
                    {
                        name: "record_scores",
                        description: "Record the scores for this slide.",
                        input_schema: jsonSchema as Anthropic.Messages.Tool.InputSchema,
                    },
                ],
                tool_choice: { type: "tool", name: "record_scores" },
            },
            { maxRetries: 10 },
        );
        const call = resp.content.find((b) => b.type === "tool_use");
        // The model is forced to call the tool, but nothing forces the
        // arguments to typecheck — validate rather than trust.
        const parsed = schema.safeParse(call?.input);
        return parsed.success ? parsed.data : null;
    }

    const resp = await client.messages.parse(
        {
            model: JUDGE_MODEL,
            max_tokens: 512,
            system,
            output_config: { format: zodOutputFormat(schema) },
            messages: [{ role: "user", content }],
        },
        { maxRetries: 10 },
    );
    return resp.parsed_output ?? null;
}

/** One slide's scores from the aesthetic vision judge — four criteria, 0-5. */
const SlideScores = z.object({
    text: ScoreSchema,
    image: ScoreSchema,
    layout: ScoreSchema,
    color: ScoreSchema,
    comment: z.string(),
});

const SLIDE_SCORES_JSON_SCHEMA = {
    type: "object",
    properties: {
        text: { type: "integer", minimum: 0, maximum: 5 },
        image: { type: "integer", minimum: 0, maximum: 5 },
        layout: { type: "integer", minimum: 0, maximum: 5 },
        color: { type: "integer", minimum: 0, maximum: 5 },
        comment: { type: "string" },
    },
    required: ["text", "image", "layout", "color", "comment"],
};

const AESTHETIC_SYSTEM = `Please evaluate the slide based on each of the following criteria:

text: The title should be simple and clear to indicate the main point. For main content, avoid too many texts and keep words concise. Use a consistent and readable font size, style, and color.

image: Use high-quality images with a reasonable proportion. Do not penalize the slide if no image is involved.

layout: Elements should be aligned, do not overlap, and have sufficient margins to each other. All elements should not exceed the page.

color: Use high-contrast color especially between the text and the background. Avoid using high-glaring colors.

For each criterion, give an integer score between 0 and 5 (higher = better). Give scores across the full spectrum (0-5) instead of only good ones (3-5).`;

/**
 * One vision call per slide returning all four aesthetic criteria. Memoized on
 * the context object so the four aesthetic graders share a single batch of
 * model calls per deck.
 */
const judgeAll = memoize(async (ctx: GraderContext) => {
    const results = await Promise.all(
        ctx.jpgPaths.map(async (jpg) => {
            const data = (await fs.readFile(jpg)).toString("base64");
            return judgeStructured(
                ctx.client,
                SlideScores,
                SLIDE_SCORES_JSON_SCHEMA,
                AESTHETIC_SYSTEM,
                [
                    {
                        type: "image",
                        source: { type: "base64", media_type: "image/jpeg", data },
                    },
                    { type: "text", text: "Score this slide on the four criteria." },
                ],
            );
        }),
    );
    return results.filter((r) => r !== null);
});

/** Build one scorecard column that averages a single aesthetic criterion. */
function aestheticJudge(
    criterion: "text" | "image" | "layout" | "color",
    description: string,
): Grader {
    return {
        name: `${criterion[0]!.toUpperCase()}${criterion.slice(1)} judge`,
        kind: "judge",
        description,
        scale: { min: 0, max: 5, good: "high" },
        format: (v) => `${v.toFixed(1)}/5`,
        async grade(ctx) {
            const scored = await judgeAll(ctx);
            return scored.length > 0
                ? avg(scored.map((s) => s[criterion]))
                : "-";
        },
    };
}

const Coherence = z.object({ coherence: ScoreSchema, comment: z.string() });

const COHERENCE_JSON_SCHEMA = {
    type: "object",
    properties: {
        coherence: { type: "integer", minimum: 0, maximum: 5 },
        comment: { type: "string" },
    },
    required: ["coherence", "comment"],
};

// ---------------------------------------------------------------- the eval

export const GRADERS: Grader[] = [
    {
        name: "Produced result",
        kind: "code",
        description: "Did the agent produce a valid .pptx at all?",
        grade(ctx) {
            if (!ctx.parsedPptx.exists) {
                return "missing";
            }
            if (!ctx.parsedPptx.validZip) {
                return "invalid";
            }
            return "ok";
        },
    },

    aestheticJudge("text", "Is the wording concise and readable? Mean 0-5."),
    aestheticJudge("image", "Are the images good and well-proportioned? Mean 0-5."),
    aestheticJudge("layout", "Is everything aligned, on-page, non-overlapping? Mean 0-5."),
    aestheticJudge("color", "Is the contrast readable and the palette calm? Mean 0-5."),

    {
        name: "Title-body coherence",
        kind: "judge",
        description: "Does each slide's body deliver on its title? Mean 0-5.",
        scale: { min: 0, max: 5, good: "high" },
        format: (v) => `${v.toFixed(1)}/5`,
        async grade(ctx) {
            // One text-only judge call per slide using the title/body pairs the
            // parser already split out, then average. Only this grader reads
            // these calls, so no cross-grader memoization.
            const results = await Promise.all(
                ctx.parsedPptx.slideTexts.map(({ title, body }) =>
                    judgeStructured(
                        ctx.client,
                        Coherence,
                        COHERENCE_JSON_SCHEMA,
                        `Score 0-5 how well this slide's body content delivers on what its title promises.
0 = title and body are on entirely different topics.
5 = body squarely answers / supports the title.`,
                        `Title: ${title || "(empty)"}\n\nBody:\n${body || "(empty)"}`,
                    ),
                ),
            );
            const scored = results.filter((r) => r !== null);
            return scored.length > 0
                ? avg(scored.map((r) => r.coherence))
                : "-";
        },
    },
];
