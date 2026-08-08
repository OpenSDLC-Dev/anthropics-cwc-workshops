// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tasksJson from "../tasks.json" with { type: "json" };

export const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
export const RUNS_DIR = path.join(ROOT, "runs");

/**
 * The model the judge graders score with, and whether they have to ask for
 * their scores through a forced tool call instead of structured outputs.
 *
 * `output_config` is a hosted-Anthropic feature. An endpoint that doesn't
 * implement it tends to accept the request and answer in prose, which reads
 * back as "no score" and averages to NaN rather than failing — so the escape
 * hatch is a forced tool call, which any Anthropic-protocol endpoint supports.
 */
export const JUDGE_MODEL = process.env.JUDGE_MODEL || "claude-opus-4-7";
export const JUDGE_VIA_TOOL_CALL = process.env.JUDGE_VIA_TOOL_CALL === "1";

/**
 * The client the graders judge with.
 *
 * Deliberately NOT the one create-slides.ts uses. That client talks to a
 * Managed Agents control plane, and a self-hosted, wire-compatible control
 * plane serves sessions and files but not `/v1/messages` — pointing the judges
 * at it 404s every call. With JUDGE_BASE_URL unset this is the hosted API and
 * the workshop behaves exactly as it always has.
 */
export function judgeClient(): Anthropic {
    return new Anthropic({
        baseURL: process.env.JUDGE_BASE_URL || "https://api.anthropic.com",
        apiKey: process.env.JUDGE_API_KEY || process.env.ANTHROPIC_API_KEY,
    });
}

/**
 * One scenario in the eval's test set — a short id and the one-line prompt
 * sent to the agent. Loaded from `tasks.json`.
 */
export interface Task {
    id: string;
    prompt: string;
}

export const tasks: Task[] = tasksJson;

/**
 * Resolve task ids from the CLI. Accepts any number of ids, or `--all` for
 * the full set. Exits with usage if none given or any id is unknown.
 */
export function selectTasks(script: string, ids: string[], all: boolean): Task[] {
    if (all) return tasks;
    const available = tasks.map((t) => t.id).join(", ");
    if (ids.length === 0) {
        console.error(`usage: tsx ${script} <task_id> [<task_id> ...] | --all`);
        console.error(`available: ${available}`);
        process.exit(1);
    }
    return ids.map((id) => {
        const found = tasks.find((t) => t.id === id);
        if (!found) {
            console.error(`unknown task: ${id}\navailable: ${available}`);
            process.exit(1);
        }
        return found;
    });
}
