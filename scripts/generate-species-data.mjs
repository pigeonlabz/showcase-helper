import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [sourcePath, sourceRevision] = process.argv.slice(2);
if (!sourcePath || !/^[a-f\d]{7,40}$/i.test(sourceRevision ?? "")) {
  console.error("Usage: npm run generate:species -- <pokemon_stats.tsv> <source-commit-sha>");
  process.exit(1);
}

const input = await readFile(resolve(sourcePath));
const [headerLine, ...lines] = input.toString("utf8").trimEnd().split(/\r?\n/);
const headers = headerLine.split("\t");
const requiredHeaders = [
  "pokedex_number",
  "name",
  "mean_height_m",
  "mean_weight_kg",
  "weight_stddev_kg",
  "xxl_class",
  "data_quality",
];
for (const header of requiredHeaders) {
  if (!headers.includes(header)) throw new Error(`Input table is missing required column: ${header}`);
}

const column = Object.fromEntries(headers.map((header, index) => [header, index]));
const excluded = { unverified: 0, missingConstants: 0, unsupportedClass: 0 };
const rows = [];
const identifiers = new Set();

for (const line of lines) {
  if (!line.trim()) continue;
  const fields = line.split("\t");
  const value = (key) => fields[column[key]]?.trim() ?? "";
  if (value("data_quality") !== "verified") {
    excluded.unverified += 1;
    continue;
  }

  const identifier = value("name");
  const dex = Number(value("pokedex_number"));
  const height = Number(value("mean_height_m"));
  const weight = Number(value("mean_weight_kg"));
  const deviation = Number(value("weight_stddev_kg"));
  const heightClass = Number(value("xxl_class"));
  if (!identifier || !Number.isInteger(dex) || dex < 1
    || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(weight) || weight <= 0
    || !Number.isFinite(deviation) || deviation <= 0) {
    excluded.missingConstants += 1;
    continue;
  }
  if (![1.55, 1.75, 2].includes(heightClass)) {
    excluded.unsupportedClass += 1;
    continue;
  }
  if (identifiers.has(identifier)) throw new Error(`Duplicate form identifier: ${identifier}`);
  identifiers.add(identifier);
  rows.push([identifier, dex, height, weight, deviation, heightClass]);
}

if (rows.length === 0) throw new Error("No verified size profiles with complete scoring constants were found.");

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/species-sizes.json");
const dataset = {
  schemaVersion: 1,
  source: {
    repository: "https://github.com/bmenrigh/pogo_size",
    revision: sourceRevision.toLowerCase(),
    file: "pokemon_stats.tsv",
    sha256: createHash("sha256").update(input).digest("hex"),
    method: "Verified rows extracted from a complete decoded Pokémon GO Game Master",
  },
  includedRows: rows.length,
  excludedRows: excluded,
  // [Game Master form identifier, Pokédex number, mean height (m), mean weight (kg), weight SD (kg), XXL height class]
  rows,
};

await writeFile(outputPath, `${JSON.stringify(dataset)}\n`, "utf8");
console.log(`Wrote ${rows.length} verified profiles to ${outputPath}`);
console.log(`Excluded rows: ${JSON.stringify(excluded)}`);
