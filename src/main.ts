import { createScanRecord, parseOCR } from "./ocr";
import { findSpecies, SPECIES } from "./species";
import { calculateScore, formatPoints } from "./scoring";
import { exportCSV, exportJSON, importJSON, newScanId } from "./data";
import type { ScanRecord } from "./types";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing.");

let records: ScanRecord[] = [];
let isProcessing = false;
let sortBy: "score" | "species" | "cp" | "order" = "score";
let progressLabel = "Ready for screenshots";
let progressValue = 0;

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true">XL</div>
      <div><p class="eyebrow">POKÉMON GO TOOL</p><h1>Showcase Helper</h1></div>
      <span class="privacy-chip"><span></span>On this device</span>
    </header>
    <p class="intro">Estimate Biggest Showcase scores from your Pokémon screenshots. Images stay in this browser and are cleared after processing.</p>

    <section class="upload-panel" aria-labelledby="upload-title">
      <div id="drop-zone" class="drop-zone">
        <div class="upload-icon" aria-hidden="true">＋</div>
        <h2 id="upload-title">Add Pokémon screenshots</h2>
        <p>Choose one or more images, or drop them here</p>
        <label class="primary-button upload-button" for="image-input">Choose screenshots</label>
        <input id="image-input" class="visually-hidden" type="file" accept="image/*" multiple />
        <small>Photos, screenshots, JPEG, PNG, HEIC supported by your browser</small>
      </div>
      <div class="progress-wrap" aria-live="polite">
        <div class="progress-copy"><span id="progress-label">${progressLabel}</span><span id="progress-count">0%</span></div>
        <progress id="progress-bar" max="100" value="0"></progress>
      </div>
    </section>

    <section class="privacy-note"><span aria-hidden="true">🔒</span><span><strong>Private by design.</strong> OCR and pixel analysis run locally. Screenshots are not sent, saved, or included in exports.</span></section>

    <section id="results-section" class="results-section" aria-labelledby="results-title">
      <div class="results-heading">
        <div><p class="eyebrow">YOUR SCANS</p><h2 id="results-title">Results <span id="result-count" class="count-pill">0</span></h2></div>
        <div class="toolbar">
          <label class="sort-label">Sort <select id="sort-select" aria-label="Sort results">
            <option value="score">Highest score</option><option value="species">Species</option><option value="cp">CP</option><option value="order">Scan order</option>
          </select></label>
          <button id="clear-button" class="quiet-button" type="button" disabled>Clear results</button>
        </div>
      </div>
      <div class="export-row">
        <button id="json-export" class="secondary-button" type="button" disabled>Export JSON</button>
        <label class="secondary-button import-button" for="json-input">Import JSON</label>
        <input id="json-input" class="visually-hidden" type="file" accept="application/json,.json" />
        <button id="csv-export" class="secondary-button" type="button" disabled>Export CSV</button>
      </div>
      <div id="empty-state" class="empty-state"><div class="empty-mark" aria-hidden="true">◎</div><strong>No scans yet</strong><span>Your separate scan results will appear here.</span></div>
      <div id="results-list" class="results-list"></div>
    </section>

    <details class="method-note">
      <summary>About score estimates and supported species</summary>
      <p>Standard single-species Biggest Showcases use height (800 points), weight (150), IVs (50), and a flat 178-point XXL bonus. CP is not part of the formula. Displayed size values are rounded, so the estimate includes a small range.</p>
      <p>Species data is currently included for Bulbasaur and Machop. Other species can be entered manually, but their score is marked unsupported until species-specific size data is added. Other Showcase formats are not supported.</p>
    </details>
    <footer>Showcase Helper · MVP · No account or history storage</footer>
  </main>
  <datalist id="supported-species">${SPECIES.map((species) => `<option value="${species.name}"></option>`).join("")}</datalist>
`;

const imageInput = app.querySelector<HTMLInputElement>("#image-input")!;
const jsonInput = app.querySelector<HTMLInputElement>("#json-input")!;
const dropZone = app.querySelector<HTMLDivElement>("#drop-zone")!;
const resultsList = app.querySelector<HTMLDivElement>("#results-list")!;
const emptyState = app.querySelector<HTMLDivElement>("#empty-state")!;
const progressElement = app.querySelector<HTMLProgressElement>("#progress-bar")!;
const progressText = app.querySelector<HTMLSpanElement>("#progress-label")!;
const progressCount = app.querySelector<HTMLSpanElement>("#progress-count")!;

imageInput.addEventListener("change", () => {
  if (imageInput.files) void processFiles(Array.from(imageInput.files));
  imageInput.value = "";
});

jsonInput.addEventListener("change", async () => {
  const file = jsonInput.files?.[0];
  jsonInput.value = "";
  if (!file) return;
  try {
    const imported = importJSON(await file.text());
    imported.forEach((record, index) => { record.scanId = nextUniqueScanId(imported.slice(0, index)); });
    records.push(...imported);
    setStatus(`Imported ${imported.length} separate scan${imported.length === 1 ? "" : "s"}.`);
    renderResults();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not import this JSON file.");
  }
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});
dropZone.addEventListener("dragleave", (event) => {
  if (!dropZone.contains(event.relatedTarget as Node | null)) dropZone.classList.remove("dragging");
});
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (files.length) void processFiles(files);
});

app.querySelector<HTMLSelectElement>("#sort-select")!.addEventListener("change", (event) => {
  sortBy = (event.currentTarget as HTMLSelectElement).value as typeof sortBy;
  renderResults();
});

app.querySelector<HTMLButtonElement>("#clear-button")!.addEventListener("click", () => {
  records = [];
  progressLabel = "Ready for screenshots";
  progressValue = 0;
  renderProgress();
  renderResults();
});

app.querySelector<HTMLButtonElement>("#json-export")!.addEventListener("click", () => {
  download("showcase-scans.json", exportJSON(records), "application/json");
});
app.querySelector<HTMLButtonElement>("#csv-export")!.addEventListener("click", () => {
  download("showcase-scans.csv", exportCSV(records), "text/csv;charset=utf-8");
});

function onFieldChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  const card = target.closest<HTMLElement>("[data-scan-id]");
  if (!card) return;
  const record = records.find((item) => item.scanId === card.dataset.scanId);
  if (!record) return;
  updateRecordField(record, target.dataset.field ?? "", target.value);
  const focusInfo = {
    scanId: record.scanId,
    field: target.dataset.field ?? "",
    start: target instanceof HTMLInputElement ? target.selectionStart : null,
    end: target instanceof HTMLInputElement ? target.selectionEnd : null,
  };
  renderResults(focusInfo);
}

resultsList.addEventListener("input", onFieldChange);
resultsList.addEventListener("change", onFieldChange);

resultsList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.matches("[data-copy-scan]")) return;
  const record = records.find((item) => item.scanId === target.dataset.copyScan);
  if (!record) return;
  const score = calculateScore(record, findSpecies(record.species));
  if (score.exact === null) return;
  const label = record.xxl ? "XXL" : "GO";
  const nickname = `${label} ${formatPoints(score.exact)}`;
  try {
    await copyText(nickname);
    target.textContent = "Copied";
    window.setTimeout(() => { target.textContent = "Copy nickname"; }, 1500);
  } catch {
    target.textContent = "Copy failed";
    window.setTimeout(() => { target.textContent = "Copy nickname"; }, 1800);
  }
});

function setStatus(message: string): void {
  progressLabel = message;
  if (!isProcessing) {
    progressValue = 100;
    renderProgress();
  }
}

function renderProgress(): void {
  progressText.textContent = progressLabel;
  progressCount.textContent = `${Math.round(progressValue)}%`;
  progressElement.value = progressValue;
  progressElement.toggleAttribute("aria-busy", isProcessing);
}

async function processFiles(files: File[]): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  progressValue = 0;
  renderProgress();
  const startCount = records.length;
  for (const [index, file] of files.entries()) {
    const id = nextUniqueScanId();
    progressLabel = `Processing ${index + 1} of ${files.length}: ${file.name}`;
    progressValue = (index / files.length) * 100;
    renderProgress();
    try {
      const record = await createScanRecord(file, id, (itemProgress) => {
        progressValue = ((index + Math.max(0, Math.min(1, itemProgress))) / files.length) * 100;
        renderProgress();
      });
      records.push(record);
    } catch (error) {
      const fallback = parseOCR("");
      records.push({
        scanId: id,
        fileName: file.name,
        scannedAt: new Date().toISOString(),
        ...fallback,
        ivs: { attack: null, defense: null, hp: null },
        confidence: 0,
        reviewReasons: [error instanceof Error ? error.message : "Could not process this image."],
        ocrText: "",
      });
    }
    renderResults();
  }
  isProcessing = false;
  progressValue = 100;
  progressLabel = `Finished ${files.length} screenshot${files.length === 1 ? "" : "s"}. ${records.length - startCount} separate scan${files.length === 1 ? "" : "s"} added.`;
  renderProgress();
  renderResults();
}

function updateRecordField(record: ScanRecord, field: string, value: string): void {
  if (field === "species") record.species = value.trim();
  else if (field === "cp") record.cp = parseFieldNumber(value, 0, 99999);
  else if (field === "heightM") record.heightM = parseFieldNumber(value, 0, 1000);
  else if (field === "weightKg") record.weightKg = parseFieldNumber(value, 0, 100000);
  else if (field === "xxl") record.xxl = value === "unknown" ? null : value === "yes";
  else if (field.startsWith("iv-")) {
    const stat = field.slice(3) as keyof ScanRecord["ivs"];
    record.ivs[stat] = parseFieldNumber(value, 0, 15);
  }
  record.reviewReasons = reviewReasonsFor(record);
}

function parseFieldNumber(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function reviewReasonsFor(record: ScanRecord): string[] {
  const reasons: string[] = [];
  if (!record.species) reasons.push("Choose the Pokémon species.");
  if (record.cp === null) reasons.push("CP is missing.");
  if (record.heightM === null) reasons.push("Height is missing.");
  if (record.weightKg === null) reasons.push("Weight is missing.");
  if (record.xxl === null) reasons.push("XXL status is unknown.");
  if (record.confidence < 55) reasons.push("OCR confidence is low; review extracted values.");
  return reasons;
}

function nextUniqueScanId(reserved: ScanRecord[] = []): string {
  let id = newScanId();
  while ([...records, ...reserved].some((record) => record.scanId === id)) id = newScanId();
  return id;
}

function sortRecords(): ScanRecord[] {
  const sorted = [...records];
  if (sortBy === "score") {
    return sorted.sort((a, b) => scoreSortValue(b) - scoreSortValue(a) || records.indexOf(a) - records.indexOf(b));
  }
  if (sortBy === "species") return sorted.sort((a, b) => a.species.localeCompare(b.species));
  if (sortBy === "cp") return sorted.sort((a, b) => (b.cp ?? -1) - (a.cp ?? -1));
  return sorted;
}

function scoreSortValue(record: ScanRecord): number {
  const score = calculateScore(record, findSpecies(record.species));
  return score.exact ?? score.low ?? Number.NEGATIVE_INFINITY;
}

function renderResults(restoreFocus?: { scanId: string; field: string; start: number | null; end: number | null }): void {
  const sorted = sortRecords();
  emptyState.hidden = sorted.length > 0;
  app!.querySelector<HTMLSpanElement>("#result-count")!.textContent = String(records.length);
  app!.querySelector<HTMLButtonElement>("#clear-button")!.disabled = records.length === 0 || isProcessing;
  app!.querySelector<HTMLButtonElement>("#json-export")!.disabled = records.length === 0;
  app!.querySelector<HTMLButtonElement>("#csv-export")!.disabled = records.length === 0;
  resultsList.innerHTML = sorted.map((record, index) => renderCard(record, index)).join("");
  if (restoreFocus) {
    const selector = `[data-scan-id="${CSS.escape(restoreFocus.scanId)}"] [data-field="${CSS.escape(restoreFocus.field)}"]`;
    const input = resultsList.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    input?.focus();
    if (input instanceof HTMLInputElement && restoreFocus.start !== null && restoreFocus.end !== null) {
      try { input.setSelectionRange(restoreFocus.start, restoreFocus.end); } catch { /* number-like inputs may not support selections */ }
    }
  }
}

function renderCard(record: ScanRecord, index: number): string {
  const species = findSpecies(record.species);
  const score = calculateScore(record, species);
  const exactReady = score.exact !== null;
  const status = !species && record.species
    ? "Unsupported species data"
    : record.reviewReasons.length
      ? "Review needed"
      : score.exact === null
        ? "Score range"
        : "Estimate";
  const displayedScore = score.exact !== null
    ? formatPoints(score.exact)
    : score.low !== null && score.high !== null
      ? `${Math.floor(score.low)}–${Math.ceil(score.high)}`
      : "—";
  const confidenceText = record.confidence ? `${record.confidence}% OCR` : "OCR unchecked";
  const reviewText = record.reviewReasons.length ? `<ul class="review-list">${record.reviewReasons.map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul>` : "";
  return `
    <article class="scan-card" data-scan-id="${escapeHTML(record.scanId)}">
      <div class="card-topline">
        <div class="scan-order">Scan ${index + 1}</div>
        <span class="status-pill ${status === "Estimate" ? "is-ready" : "is-review"}">${escapeHTML(status)}</span>
      </div>
      <div class="card-main">
        <div class="pokemon-title"><strong>${escapeHTML(record.species || "Unknown species")}</strong><span>${escapeHTML(record.fileName)} · ${confidenceText}</span></div>
        <div class="score-block"><span>Estimated score</span><strong>${displayedScore}</strong>${score.low !== null && score.high !== null ? `<small>rounded-size range ${Math.floor(score.low)}–${Math.ceil(score.high)}</small>` : `<small>enter size to estimate</small>`}</div>
      </div>
      <div class="scan-fields">
        <label>Species<input type="text" list="supported-species" value="${escapeHTML(record.species)}" data-field="species" placeholder="Select or type species" /></label>
        <label>CP<input type="text" inputmode="numeric" value="${value(record.cp)}" data-field="cp" placeholder="—" /></label>
        <label>Height (m)<input type="text" inputmode="decimal" value="${value(record.heightM)}" data-field="heightM" placeholder="—" /></label>
        <label>Weight (kg)<input type="text" inputmode="decimal" value="${value(record.weightKg)}" data-field="weightKg" placeholder="—" /></label>
        <label>XXL<select data-field="xxl"><option value="unknown" ${record.xxl === null ? "selected" : ""}>Unknown</option><option value="yes" ${record.xxl === true ? "selected" : ""}>Yes</option><option value="no" ${record.xxl === false ? "selected" : ""}>No</option></select></label>
        <label>Attack IV<input type="text" inputmode="numeric" value="${value(record.ivs.attack)}" data-field="iv-attack" placeholder="?" /></label>
        <label>Defence IV<input type="text" inputmode="numeric" value="${value(record.ivs.defense)}" data-field="iv-defense" placeholder="?" /></label>
        <label>HP IV<input type="text" inputmode="numeric" value="${value(record.ivs.hp)}" data-field="iv-hp" placeholder="?" /></label>
      </div>
      ${species ? `<p class="species-data">Mean size ${species.meanHeightM.toFixed(2)} m · ${species.meanWeightKg.toFixed(1)} kg · XXL class ${species.maxHeightClass}×</p>` : `<p class="species-data">No species size data; score is unavailable.</p>`}
      ${reviewText}
      <div class="card-actions"><span class="scan-id">ID ${escapeHTML(record.scanId.slice(0, 8))}</span><button class="copy-button" type="button" data-copy-scan="${escapeHTML(record.scanId)}" ${exactReady ? "" : "disabled"}>${exactReady ? "Copy nickname" : "Enter IVs to copy"}</button></div>
    </article>`;
}

function value(valueToShow: number | null): string {
  return valueToShow === null ? "" : String(valueToShow);
}

function escapeHTML(valueToEscape: string): string {
  return valueToEscape.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function download(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard copy is unavailable.");
}

renderProgress();
renderResults();
