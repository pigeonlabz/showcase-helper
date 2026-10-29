import { createScanRecord, parseOCR } from "./ocr";
import { findSpecies, SPECIES } from "./species";
import { calculateScore, formatPoints } from "./scoring";
import { newScanId } from "./data";
import type { ScanRecord } from "./types";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing.");

let records: ScanRecord[] = [];
let isProcessing = false;
let sortBy: "score" | "species" | "cp" | "order" = "score";
let progressLabel = "";
let progressValue = 0;

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true">XL</div>
      <div><p class="eyebrow">POKÉMON GO</p><h1>Showcase Helper</h1></div>
    </header>
    <p class="intro">Find your best Biggest Showcase Pokémon.</p>

    <section class="upload-panel" aria-labelledby="upload-title">
      <div id="drop-zone" class="drop-zone">
        <div class="upload-icon" aria-hidden="true">＋</div>
        <h2 id="upload-title">Choose screenshots</h2>
        <p>Select one or more Pokémon photos.</p>
        <label class="primary-button upload-button" for="image-input">Choose photos</label>
        <input id="image-input" class="visually-hidden" type="file" accept="image/*" multiple aria-label="Choose Pokémon screenshots" />
        <small>Photos are scanned on this device.</small>
      </div>
      <div id="progress-wrap" class="progress-wrap" aria-live="polite" hidden>
        <div class="progress-copy"><span id="progress-label"></span><span id="progress-count">0%</span></div>
        <progress id="progress-bar" max="100" value="0"></progress>
      </div>
    </section>

    <section id="results-section" class="results-section" aria-labelledby="results-title">
      <div class="results-heading">
        <h2 id="results-title">Results <span id="result-count" class="count-pill">0</span></h2>
        <label id="add-more-button" class="secondary-button add-more-button" for="image-input" hidden>＋ Add photos</label>
      </div>
      <div class="toolbar">
        <label class="sort-label"><span class="visually-hidden">Sort results</span><select id="sort-select" aria-label="Sort results">
            <option value="score">Highest score</option><option value="species">Species</option><option value="cp">CP</option><option value="order">Scan order</option>
          </select></label>
        <button id="clear-button" class="quiet-button" type="button" disabled>Clear</button>
      </div>
      <div id="empty-state" class="empty-state"><strong>No scans yet</strong><span>Choose photos above to get started.</span></div>
      <div id="results-list" class="results-list"></div>
    </section>

    <details class="method-note">
      <summary>About estimates</summary>
      <p>Scores use height, weight, IVs and XXL status. CP does not count. In-game sizes are rounded, so scores are estimates. Scoring data is currently available for Bulbasaur and Machop.</p>
    </details>
    <footer>Photos stay in this browser. No scan history is saved.</footer>
  </main>
  <datalist id="supported-species">${SPECIES.map((species) => `<option value="${species.name}"></option>`).join("")}</datalist>
`;

const imageInput = app.querySelector<HTMLInputElement>("#image-input")!;
const dropZone = app.querySelector<HTMLDivElement>("#drop-zone")!;
const resultsList = app.querySelector<HTMLDivElement>("#results-list")!;
const emptyState = app.querySelector<HTMLDivElement>("#empty-state")!;
const progressWrap = app.querySelector<HTMLDivElement>("#progress-wrap")!;
const progressElement = app.querySelector<HTMLProgressElement>("#progress-bar")!;
const progressText = app.querySelector<HTMLSpanElement>("#progress-label")!;
const progressCount = app.querySelector<HTMLSpanElement>("#progress-count")!;
const addMoreButton = app.querySelector<HTMLLabelElement>("#add-more-button")!;

imageInput.addEventListener("change", () => {
  const files = Array.from(imageInput.files ?? []);
  if (files.length) void processFiles(files);
  imageInput.value = "";
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
  progressLabel = "";
  progressValue = 0;
  renderProgress();
  renderResults();
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
    target.textContent = "Copied!";
    target.setAttribute("aria-label", `Copied ${nickname}`);
    window.setTimeout(() => {
      target.textContent = "Copy";
      target.setAttribute("aria-label", `Copy nickname ${nickname}`);
    }, 1600);
  } catch {
    target.textContent = "Copy failed";
    target.setAttribute("aria-label", "Copy failed. You can select the nickname text manually.");
    window.setTimeout(() => {
      target.textContent = "Copy";
      target.setAttribute("aria-label", `Copy nickname ${nickname}`);
    }, 1800);
  }
});

function renderProgress(): void {
  progressWrap.hidden = !isProcessing && !progressLabel;
  progressText.textContent = progressLabel;
  progressCount.textContent = isProcessing ? `${Math.round(progressValue)}%` : "Done";
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
    progressLabel = `Scanning ${index + 1} of ${files.length}`;
    progressValue = (index / files.length) * 100;
    renderProgress();
    try {
      const record = await createScanRecord(file, id, (itemProgress) => {
        progressValue = ((index + Math.max(0, Math.min(1, itemProgress))) / files.length) * 100;
        renderProgress();
      });
      records.push(record);
    } catch {
      const fallback = parseOCR("");
      records.push({
        scanId: id,
        fileName: file.name,
        scannedAt: new Date().toISOString(),
        ...fallback,
        ivs: { attack: null, defense: null, hp: null },
        confidence: 0,
        reviewReasons: ["Could not scan this image. Try a clearer screenshot or enter the values below."],
        ocrText: "",
      });
    }
    renderResults();
  }
  isProcessing = false;
  progressValue = 100;
  progressLabel = `Scanned ${files.length} photo${files.length === 1 ? "" : "s"} · ${records.length - startCount} result${records.length - startCount === 1 ? "" : "s"} added`;
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
  if (!record.species) reasons.push("Choose a species.");
  if (record.cp === null) reasons.push("Add the CP.");
  if (record.heightM === null) reasons.push("Add the height.");
  if (record.weightKg === null) reasons.push("Add the weight.");
  if (record.xxl === null) reasons.push("Set XXL status.");
  if (record.confidence < 55 && reasons.length === 0) reasons.push("Check the detected values.");
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
  const openEditors = new Set(
    Array.from(resultsList.querySelectorAll<HTMLDetailsElement>("details.edit-controls[open]"))
      .map((details) => details.closest<HTMLElement>("[data-scan-id]")?.dataset.scanId)
      .filter((scanId): scanId is string => Boolean(scanId)),
  );
  emptyState.hidden = sorted.length > 0;
  app!.querySelector<HTMLSpanElement>("#result-count")!.textContent = String(records.length);
  app!.querySelector<HTMLButtonElement>("#clear-button")!.disabled = records.length === 0 || isProcessing;
  addMoreButton.hidden = records.length === 0 || isProcessing;
  resultsList.innerHTML = sorted.map((record, index) => renderCard(record, index)).join("");
  for (const card of resultsList.querySelectorAll<HTMLElement>("[data-scan-id]")) {
    if (openEditors.has(card.dataset.scanId ?? "")) card.querySelector<HTMLDetailsElement>("details.edit-controls")!.open = true;
  }
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
    ? "Not supported"
    : record.reviewReasons.length
      ? "Check details"
      : score.exact === null
        ? "Score range"
        : "Estimate";
  const displayedScore = score.exact !== null
    ? formatPoints(score.exact)
    : score.low !== null && score.high !== null
      ? `${Math.floor(score.low)}–${Math.ceil(score.high)}`
      : "—";
  const reviewText = record.reviewReasons.length ? `<ul class="review-list">${record.reviewReasons.map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul>` : "";
  const nickname = score.exact === null ? "Add IVs to create nickname" : `${record.xxl ? "XXL" : "GO"} ${formatPoints(score.exact)}`;
  const sizeStatus = record.xxl === true ? "XXL" : record.xxl === false ? "Not XXL" : "Size unknown";
  const unsupportedText = !species && record.species
    ? `<p class="review-message">No size data for ${escapeHTML(record.species)}. Score unavailable.</p>`
    : "";
  return `
    <article class="scan-card" data-scan-id="${escapeHTML(record.scanId)}">
      <div class="card-topline">
        <div class="scan-order">Scan ${index + 1}</div>
        <span class="status-pill ${status === "Estimate" ? "is-ready" : status === "Not supported" ? "is-unsupported" : "is-review"}">${escapeHTML(status)}</span>
      </div>
      <div class="pokemon-title"><strong>${escapeHTML(record.species || "Unknown species")}</strong></div>
      <div class="pokemon-facts">
        <span class="fact-chip">CP ${value(record.cp) || "—"}</span>
        <span class="fact-chip ${record.xxl ? "fact-chip-xxl" : ""}">${sizeStatus}</span>
      </div>
      <div class="score-block">
        <span class="score-label">Estimated Showcase score</span>
        <strong>${displayedScore}</strong>
        ${score.low !== null && score.high !== null ? `<small>Rounded size: ${Math.floor(score.low)}–${Math.ceil(score.high)}</small>` : `<small>Enter size details to estimate</small>`}
      </div>
      <div class="nickname-row"><span>Nickname</span><strong>${escapeHTML(nickname)}</strong></div>
      <button class="copy-button" type="button" data-copy-scan="${escapeHTML(record.scanId)}" aria-label="${exactReady ? `Copy nickname ${escapeHTML(nickname)}` : "Enter all IVs to enable nickname copy"}" ${exactReady ? "" : "disabled"}>Copy</button>
      ${unsupportedText}
      ${reviewText}
      <details class="edit-controls">
        <summary>Edit details</summary>
        <div class="scan-fields">
          <label>Species<input type="text" list="supported-species" value="${escapeHTML(record.species)}" data-field="species" placeholder="Choose species" /></label>
          <label>CP<input type="text" inputmode="numeric" value="${value(record.cp)}" data-field="cp" placeholder="—" /></label>
          <label>Height (m)<input type="text" inputmode="decimal" value="${value(record.heightM)}" data-field="heightM" placeholder="—" /></label>
          <label>Weight (kg)<input type="text" inputmode="decimal" value="${value(record.weightKg)}" data-field="weightKg" placeholder="—" /></label>
          <label>XXL<select data-field="xxl"><option value="unknown" ${record.xxl === null ? "selected" : ""}>Unknown</option><option value="yes" ${record.xxl === true ? "selected" : ""}>Yes</option><option value="no" ${record.xxl === false ? "selected" : ""}>No</option></select></label>
          <label>Attack IV<input type="text" inputmode="numeric" value="${value(record.ivs.attack)}" data-field="iv-attack" placeholder="?" /></label>
          <label>Defence IV<input type="text" inputmode="numeric" value="${value(record.ivs.defense)}" data-field="iv-defense" placeholder="?" /></label>
          <label>HP IV<input type="text" inputmode="numeric" value="${value(record.ivs.hp)}" data-field="iv-hp" placeholder="?" /></label>
        </div>
        <span class="scan-id">Scan ID ${escapeHTML(record.scanId.slice(0, 8))}</span>
      </details>
    </article>`;
}

function value(valueToShow: number | null): string {
  return valueToShow === null ? "" : String(valueToShow);
}

function escapeHTML(valueToEscape: string): string {
  return valueToEscape.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Use the iOS-compatible selection fallback when Clipboard API access is denied.
    }
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.width = "2em";
  input.style.height = "2em";
  input.style.padding = "0";
  input.style.fontSize = "16px";
  input.style.opacity = "0";
  document.body.append(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    input.remove();
  }
  if (!copied) throw new Error("Clipboard copy is unavailable.");
}

renderProgress();
renderResults();
