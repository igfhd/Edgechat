#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { D1_MIGRATIONS } from "./d1-migration-manifest.mjs";
import { buildD1MigrationPlan, D1_MIGRATION_LEDGER } from "./d1-migration-plan.mjs";
import { D1_REPAIRS } from "./d1-repair-manifest.mjs";

const API_BASE_URL = "https://api.cloudflare.com/client/v4";
const OUTPUT_PATH = ".tmp/edgechat-d1-migrations.sql";
const requiredEnv = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "EDGECHAT_D1_DATABASE_ID",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.EDGECHAT_D1_DATABASE_ID;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function extractApiError(payload, fallback) {
  if (!payload || !Array.isArray(payload.errors) || payload.errors.length === 0) {
    return fallback;
  }
  return payload.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
}

async function queryD1(sql) {
  const response = await fetch(
    `${API_BASE_URL}/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  );
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(extractApiError(payload, `Cloudflare D1 query failed with ${response.status}`));
  }
  return payload.result?.[0]?.results ?? [];
}

async function collectArtifacts() {
  const artifacts = new Set();
  const objects = await queryD1(
    "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'trigger', 'index')",
  );

  for (const object of objects) {
    artifacts.add(`${object.type}:${object.name}`);
  }

  const inspectedTables = new Set(
    D1_MIGRATIONS.flatMap((migration) => migration.artifacts)
      .filter((artifact) => artifact.startsWith("column:"))
      .map((artifact) => artifact.slice("column:".length).split(".")[0]),
  );

  for (const table of inspectedTables) {
    // D1 REST API 禁止直接执行 PRAGMA，使用等价表值函数才能在 CI 中安全读取列结构。
    const escapedTable = table.replaceAll("'", "''");
    const columns = await queryD1(`SELECT name FROM pragma_table_info('${escapedTable}')`);
    for (const column of columns) {
      artifacts.add(`column:${table}.${column.name}`);
    }
  }

  return artifacts;
}

async function collectAppliedMigrations(artifacts) {
  if (!artifacts.has(`table:${D1_MIGRATION_LEDGER}`)) {
    return new Map();
  }
  const rows = await queryD1(
    `SELECT migration_id, checksum FROM ${D1_MIGRATION_LEDGER} ORDER BY migration_id`,
  );
  return new Map(rows.map((row) => [String(row.migration_id), String(row.checksum)]));
}

async function main() {
  const artifacts = await collectArtifacts();
  const appliedMigrations = await collectAppliedMigrations(artifacts);
  const plan = await buildD1MigrationPlan({
    migrations: D1_MIGRATIONS,
    repairs: D1_REPAIRS,
    appliedMigrations,
    artifacts,
    readSql(file) {
      return readFileSync(resolve(repositoryRoot, file), "utf8");
    },
  });
  const outputFile = process.env.EDGECHAT_MIGRATION_OUTPUT_PATH
    ? resolve(process.env.EDGECHAT_MIGRATION_OUTPUT_PATH)
    : resolve(process.cwd(), OUTPUT_PATH);
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, plan.sql, "utf8");

  for (const decision of plan.decisions) {
    console.log(`[d1-migration] ${decision.id}: ${decision.action}`);
  }
  console.log(`D1 migration plan written to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
