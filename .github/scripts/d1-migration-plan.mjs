import { createHash } from "node:crypto";

export const D1_MIGRATION_LEDGER = "edgechat_schema_migrations";

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedMigrationSql(sql) {
  return sql.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function migrationChecksums(sql) {
  const normalizedSql = normalizedMigrationSql(sql);
  return {
    current: checksum(normalizedSql),
    compatible: new Set([checksum(sql), checksum(normalizedSql.replaceAll("\n", "\r\n"))]),
  };
}

function ledgerInsert(migration, checksum) {
  return `INSERT INTO ${D1_MIGRATION_LEDGER} (migration_id, checksum)
VALUES (${sqlString(migration.id)}, ${sqlString(checksum)});`;
}

export function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inString = false;
  let stringChar = "";
  let inBlockComment = false;
  let inLineComment = false;
  let triggerDepth = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += char;
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += "/";
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (inString) {
      current += char;
      if (char === stringChar) {
        if (next === stringChar) {
          current += next;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      current += "--";
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      current += "/*";
      i++;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    const remaining = sql.slice(i);
    if (/^\bBEGIN\b/i.test(remaining) && (i === 0 || /\s/.test(sql[i - 1]))) {
      triggerDepth++;
    } else if (/^\bEND\b/i.test(remaining) && (i === 0 || /\s/.test(sql[i - 1])) && triggerDepth > 0) {
      triggerDepth--;
    }

    if (char === ";" && triggerDepth === 0) {
      current += char;
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

export function prepareMigrationExecutableSql(sql, artifacts, rerunnable) {
  if (!rerunnable || !artifacts) {
    return sql.trim();
  }
  const statements = splitSqlStatements(sql);
  const executableStatements = [];

  for (const statement of statements) {
    const cleaned = statement.replace(/^(\s*--[^\n]*\r?\n|\s*\/\*[\s\S]*?\*\/\s*)*/g, "").trim();
    const addColumnMatch = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?/i.exec(cleaned);
    if (addColumnMatch) {
      const artifactKey = `column:${addColumnMatch[1]}.${addColumnMatch[2]}`;
      if (artifacts.has(artifactKey)) {
        continue;
      }
    }
    executableStatements.push(statement);
  }

  return executableStatements.join("\n\n").trim();
}

export async function buildD1MigrationPlan({
  migrations,
  repairs = [],
  appliedMigrations,
  artifacts,
  readSql,
}) {
  const chunks = [
    `CREATE TABLE IF NOT EXISTS ${D1_MIGRATION_LEDGER} (
  migration_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  ];
  const decisions = [];

  for (const repair of repairs) {
    const shouldApply = repair.whenArtifacts.every((artifact) => artifacts.has(artifact));
    if (!shouldApply) {
      continue;
    }

    chunks.push(`-- 执行遗留数据库修复 ${repair.id}。`);
    chunks.push((await readSql(repair.file)).trim());
    decisions.push({ id: repair.id, action: "repair" });
  }

  for (const migration of migrations) {
    const sql = await readSql(migration.file);
    const checksums = migrationChecksums(sql);
    const recordedChecksum = appliedMigrations.get(migration.id);

    if (recordedChecksum) {
      if (recordedChecksum === checksums.current) {
        decisions.push({ id: migration.id, action: "skip" });
        continue;
      }
      if (checksums.compatible.has(recordedChecksum)) {
        chunks.push(`-- 统一 ${migration.id} 的跨平台换行符校验值。`);
        chunks.push(
          `UPDATE ${D1_MIGRATION_LEDGER}
SET checksum = ${sqlString(checksums.current)}
WHERE migration_id = ${sqlString(migration.id)};`,
        );
        decisions.push({ id: migration.id, action: "normalize" });
        continue;
      }
      throw new Error(`迁移 ${migration.id} 已执行，但文件校验值发生变化`);
    }

    const presentArtifacts = migration.artifacts.filter((artifact) => artifacts.has(artifact));
    const allPresent = presentArtifacts.length === migration.artifacts.length;
    const nonePresent = presentArtifacts.length === 0;

    if (allPresent) {
      chunks.push(`-- 现有数据库已具备 ${migration.id} 的结构，仅登记迁移基线。`);
      chunks.push(ledgerInsert(migration, checksums.current));
      decisions.push({ id: migration.id, action: "baseline" });
      continue;
    }

    if (!nonePresent && !migration.rerunnable) {
      const missing = migration.artifacts.filter((artifact) => !artifacts.has(artifact));
      throw new Error(
        `迁移 ${migration.id} 的数据库结构只完成了一部分；已存在：${presentArtifacts.join(", ")}；缺少：${missing.join(", ")}`,
      );
    }

    const executableSql = prepareMigrationExecutableSql(sql, artifacts, Boolean(migration.rerunnable));

    chunks.push(`-- 执行迁移 ${migration.id}。`);
    if (executableSql) {
      chunks.push(executableSql);
    }
    chunks.push(ledgerInsert(migration, checksums.current));
    decisions.push({ id: migration.id, action: "apply" });
  }

  return {
    sql: `${chunks.join("\n\n")}\n`,
    decisions,
  };
}
