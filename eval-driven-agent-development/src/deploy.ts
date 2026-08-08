// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

/**
 * Deploys resources/*.yaml to the control plane — what `ant beta:agents create`
 * and `ant beta:agents update` do, minus the CLI.
 *
 * The first deploy of a file creates the resource and writes the returned `id`
 * back into the YAML; every later one sees that `id` and updates in place. An
 * agent update is optimistically concurrent — it has to send the version it is
 * editing — so the agent's YAML also carries `version`, bumped here from each
 * response. That bookkeeping at the top of the file is the whole reason it is
 * written back rather than just printed.
 *
 *   npm run deploy                 # environment, then agent
 *   npm run deploy -- agent        # just one of them
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { isMap, parseDocument, type Document } from "yaml";
import { ROOT } from "./lib.js";

const BETAS: Anthropic.Beta.AnthropicBeta[] = ["managed-agents-2026-04-01"];

/**
 * The definition read out of a YAML file, minus our bookkeeping keys.
 *
 * These files are authored by hand and validated by the control plane, so the
 * SDK's param unions can't describe them ahead of time — each call site casts
 * once, on purpose, and a malformed definition comes back as a 400 rather than
 * a type error.
 */
type Definition = Record<string, unknown>;

/** The slice of a create/update response this script writes back. */
interface Deployed {
    id: string;
    version?: number;
}

interface Resource {
    /** Path relative to the repo root. */
    file: string;
    /** Sent when the YAML has no id yet. */
    create(client: Anthropic, body: Definition): Promise<Deployed>;
    /** Sent when it does. `version` is undefined for unversioned kinds. */
    update(
        client: Anthropic,
        id: string,
        body: Definition,
        version: number | undefined,
    ): Promise<Deployed>;
}

const RESOURCES: Record<string, Resource> = {
    // Environments are not versioned — one id, live until archived.
    environment: {
        file: "resources/workshop-pptx.environment.yaml",
        create: (client, body) =>
            client.beta.environments.create({
                ...body,
                betas: BETAS,
            } as Anthropic.Beta.EnvironmentCreateParams),
        update: (client, id, body) =>
            client.beta.environments.update(id, {
                ...body,
                betas: BETAS,
            } as Anthropic.Beta.EnvironmentUpdateParams),
    },
    agent: {
        file: "resources/agent.yaml",
        create: (client, body) =>
            client.beta.agents.create({
                ...body,
                betas: BETAS,
            } as Anthropic.Beta.AgentCreateParams),
        update: (client, id, body, version) => {
            if (version === undefined) {
                throw new Error(
                    "agent.yaml has an id but no version — an update has to say " +
                        "which version it edits. Restore the version, or drop the id " +
                        "to create a fresh agent.",
                );
            }
            return client.beta.agents.update(id, {
                ...body,
                version,
                betas: BETAS,
            } as Anthropic.Beta.AgentUpdateParams);
        },
    },
};

/**
 * Set `key` on a YAML document, preserving the file's comments and layout.
 * A key that isn't there yet goes to the top, which is where the bookkeeping
 * belongs — above `name`, out of the way of the definition itself.
 */
function setKey(doc: Document, key: string, value: string | number): void {
    if (doc.has(key)) {
        doc.set(key, value);
        return;
    }
    if (!isMap(doc.contents)) {
        throw new Error(`${key}: expected a mapping at the top level of the file`);
    }
    doc.contents.items.unshift(doc.createPair(key, value));
}

async function deploy(
    client: Anthropic,
    name: string,
    resource: Resource,
): Promise<string> {
    const file = path.join(ROOT, resource.file);
    // parseDocument rather than parse: writing the file back out has to keep
    // its comments and block scalars intact, since this is a file people edit.
    const doc = parseDocument(await fs.readFile(file, "utf8"));

    const id = doc.get("id") as string | undefined;
    const version = doc.get("version") as number | undefined;
    const body = doc.toJS() as Definition;
    delete body.id;
    delete body.version;

    const result = id
        ? await resource.update(client, id, body, version)
        : await resource.create(client, body);

    // A new key goes to the top, so the last one written ends up first —
    // version before id leaves them reading `id` then `version` in the file.
    if (result.version !== undefined) setKey(doc, "version", result.version);
    setKey(doc, "id", result.id);
    await fs.writeFile(file, String(doc));

    const at = result.version === undefined ? "" : ` (version ${result.version})`;
    console.log(
        `${name}: ${id ? "updated" : "created"} ${result.id}${at} → ${resource.file}`,
    );
    return result.id;
}

// ---------------------------------------------------------------- CLI entry

const { positionals } = parseArgs({ allowPositionals: true });
const available = Object.keys(RESOURCES);
const selected = positionals.length > 0 ? positionals : available;

for (const name of selected) {
    if (!(name in RESOURCES)) {
        console.error(`unknown resource: ${name}\navailable: ${available.join(", ")}`);
        process.exit(1);
    }
}

// One client, reading ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY from .env — the
// same control plane create-slides.ts drives.
const client = new Anthropic();

// Sequential, not concurrent: the output reads as a deploy log, and a failure
// stops before the next resource drifts out of step with it.
const ids = new Map<string, string>();
for (const name of selected) {
    ids.set(name, await deploy(client, name, RESOURCES[name]!));
}

// create-slides.ts reads these from the environment before falling back to its
// own constants, so pasting them into .env is enough to point it at this deploy.
console.log("\nSet these in .env (or the constants in src/create-slides.ts):");
for (const [name, id] of ids) {
    console.log(`${name === "agent" ? "AGENT_ID" : "ENVIRONMENT_ID"}=${id}`);
}
