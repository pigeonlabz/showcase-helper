import { createScanRecord, parseOCR } from "./ocr";
import { findSpecies } from "./species";
import { POKEMON_SPECIES_NAMES } from "./pokemon-names";
import { calculateScore, formatPoints } from "./scoring";
import { submitManualEdits, type ManualEditErrors, type ManualScanEdits } from "./editing";
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
      <div id="results-heading" class="results-heading">
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
      <p>Scores use height, weight, IVs and XXL status. CP does not count. In-game sizes are rounded, so scores are estimates. Some Pokémon do not yet have verified size data.</p>
    </details>
    <footer>Photos stay in this browser. No scan history is saved.</footer>
  </main>
  <datalist id="supported-species">${POKEMON_SPECIES_NAMES.map((name) => `<option value="${name}"></option>`).join("")}</datalist>
`;

const imageInput = app.querySelector<HTMLInputElement>("#image-input")!;
const dropZone = app.querySelector<HTMLDivElement>("#drop-zone")!;
const resultsList = app.querySelector<HTMLDivElement>("#results-list")!;
const resultsHeading = app.querySelector<HTMLDivElement>("#results-heading")!;
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

function onEditInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  const form = target.closest<HTMLFormElement>("form[data-edit-form]");
  if (!form) return;

  const fieldError = form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(target.name)}"]`);
  if (fieldError) {
    fieldError.textContent = "";
    fieldError.hidden = true;
    target.removeAttribute("aria-invalid");
  }
  if (!form.querySelector<HTMLElement>(".field-error:not([hidden])")) {
    form.querySelector<HTMLElement>(".edit-error")!.hidden = true;
  }
  form.querySelector<HTMLElement>(".edit-status")!.hidden = true;
}

function valuesFromForm(form: HTMLFormElement): ManualScanEdits {
  const values = new FormData(form);
  return {
    species: String(values.get("species") ?? ""),
    cp: String(values.get("cp") ?? ""),
    heightM: String(values.get("heightM") ?? ""),
    weightKg: String(values.get("weightKg") ?? ""),
    xxl: String(values.get("xxl") ?? ""),
    attackIV: String(values.get("attackIV") ?? ""),
    defenseIV: String(values.get("defenseIV") ?? ""),
    hpIV: String(values.get("hpIV") ?? ""),
  };
}

function showEditErrors(form: HTMLFormElement, errors: ManualEditErrors): void {
  for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[name]")) {
    const message = errors[input.name as keyof ManualScanEdits] ?? "";
    const error = form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(input.name)}"]`)!;
    error.textContent = message;
    error.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  const summary = form.querySelector<HTMLElement>(".edit-error")!;
  summary.textContent = "Check the highlighted fields. Your entries are still here.";
  summary.hidden = false;
  form.querySelector<HTMLInputElement | HTMLSelectElement>('[aria-invalid="true"]')?.focus();
}

resultsList.addEventListener("input", onEditInput);
resultsList.addEventListener("change", onEditInput);
resultsList.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("form[data-edit-form]")) return;
  event.preventDefault();

  const card = form.closest<HTMLElement>("[data-scan-id]");
  const index = records.findIndex((record) => record.scanId === card?.dataset.scanId);
  if (index < 0) return;

  const result = submitManualEdits(records[index], valuesFromForm(form));
  if (!result.ok) {
    showEditErrors(form, result.errors);
    return;
  }

  records[index] = result.record;
  renderResults();
  const savedCard = resultsList.querySelector<HTMLElement>(`[data-scan-id="${CSS.escape(result.record.scanId)}"]`);
  savedCard?.querySelector<HTMLDetailsElement>("details.result-details")?.setAttribute("open", "");
  const status = savedCard?.querySelector<HTMLElement>(".edit-status");
  if (status) {
    status.textContent = result.score.exact === null
      ? "Saved. The score range has been updated."
      : "Saved. Score and nickname updated.";
    status.hidden = false;
  }
  savedCard?.querySelector<HTMLButtonElement>(".save-button")?.focus();
});

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
        reviewReasons: ["Image processing failed. Try another photo or enter visible values manually."],
        ocrText: "",
      });
    }
  }
  isProcessing = false;
  progressValue = 100;
  progressLabel = `Scanned ${files.length} photo${files.length === 1 ? "" : "s"} · ${records.length - startCount} result${records.length - startCount === 1 ? "" : "s"} added`;
  renderProgress();
  renderResults();
  if (!resultsList.querySelector("form[data-edit-form]:focus-within")) {
    requestAnimationFrame(() => {
      if (resultsList.querySelector("form[data-edit-form]:focus-within")) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultsHeading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  }
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

function renderResults(): void {
  const sorted = sortRecords();
  const openDetails = new Set(
    Array.from(resultsList.querySelectorAll<HTMLDetailsElement>("details.result-details[open]"))
      .map((details) => details.closest<HTMLElement>("[data-scan-id]")?.dataset.scanId)
      .filter((scanId): scanId is string => Boolean(scanId)),
  );
  const drafts = new Map<string, Record<string, string>>();
  for (const form of resultsList.querySelectorAll<HTMLFormElement>("form[data-edit-form]")) {
    const scanId = form.closest<HTMLElement>("[data-scan-id]")?.dataset.scanId;
    if (scanId) drafts.set(scanId, Object.fromEntries(Array.from(new FormData(form).entries()).map(([key, entry]) => [key, String(entry)])));
  }
  const active = document.activeElement;
  const focusedForm = active instanceof HTMLElement ? active.closest<HTMLFormElement>("form[data-edit-form]") : null;
  const focusedScanId = focusedForm?.closest<HTMLElement>("[data-scan-id]")?.dataset.scanId;
  const focusedField = focusedForm && focusedScanId
    ? {
      scanId: focusedScanId,
      field: active instanceof HTMLInputElement || active instanceof HTMLSelectElement ? active.name : "",
      saveButton: active instanceof HTMLButtonElement && active.matches(".save-button"),
      start: active instanceof HTMLInputElement ? active.selectionStart : null,
      end: active instanceof HTMLInputElement ? active.selectionEnd : null,
    }
    : null;
  emptyState.hidden = sorted.length > 0;
  app!.querySelector<HTMLSpanElement>("#result-count")!.textContent = String(records.length);
  app!.querySelector<HTMLButtonElement>("#clear-button")!.disabled = records.length === 0 || isProcessing;
  addMoreButton.hidden = records.length === 0 || isProcessing;
  resultsList.innerHTML = sorted.map((record, index) => renderCard(record, index)).join("");
  for (const card of resultsList.querySelectorAll<HTMLElement>("[data-scan-id]")) {
    const scanId = card.dataset.scanId ?? "";
    if (openDetails.has(scanId)) card.querySelector<HTMLDetailsElement>("details.result-details")!.open = true;
    const draft = drafts.get(scanId);
    if (draft) {
      for (const [name, entry] of Object.entries(draft)) {
        const field = card.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`);
        if (field) field.value = entry;
      }
    }
  }
  if (focusedField?.saveButton) {
    resultsList.querySelector<HTMLButtonElement>(`[data-scan-id="${CSS.escape(focusedField.scanId)}"] .save-button`)?.focus();
  } else if (focusedField?.field) {
    const selector = `[data-scan-id="${CSS.escape(focusedField.scanId)}"] [name="${CSS.escape(focusedField.field)}"]`;
    const input = resultsList.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    input?.focus();
    if (input instanceof HTMLInputElement && focusedField.start !== null && focusedField.end !== null) {
      try { input.setSelectionRange(focusedField.start, focusedField.end); } catch { /* Selection is not supported for every input type. */ }
    }
  }
}

function renderCard(record: ScanRecord, index: number): string {
  const species = findSpecies(record.species);
  const score = calculateScore(record, species);
  const exactReady = score.exact !== null;
  const unsupportedScoring = Boolean(record.species && !species);
  const status = unsupportedScoring ? "Scoring unavailable" : !record.species ? "Choose species" : record.reviewReasons.length ? "Check details" : score.exact === null ? "Score range" : "Estimate";
  const displayedScore = score.exact !== null
    ? formatPoints(score.exact)
    : score.low !== null && score.high !== null ? `${Math.floor(score.low)}–${Math.ceil(score.high)}` : unsupportedScoring ? "N/A" : "—";
  const scoreCaption = unsupportedScoring
    ? "No verified size data"
    : score.low !== null && score.high !== null
      ? `${score.exact === null ? "Range" : "Size range"} ${Math.floor(score.low)}–${Math.ceil(score.high)}`
      : "Enter height and weight";
  const reviewText = record.reviewReasons.length ? `<ul class="review-list">${record.reviewReasons.map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul>` : "";
  const nickname = score.exact === null
    ? unsupportedScoring ? "Scoring data unavailable" : "Complete IVs and size for nickname"
    : `${record.xxl ? "XXL" : "GO"} ${formatPoints(score.exact)}`;
  const sizeStatus = record.xxl === true ? "XXL" : record.xxl === false ? "Not XXL" : "Size unknown";
  const unsupportedText = unsupportedScoring ? `<p class="review-message">Scoring data unavailable for ${escapeHTML(record.species)}. Extracted values are retained.</p>` : "";
  const breakdown = score.parts
    ? `<div class="score-breakdown"><span>Height <b>${score.parts.height.toFixed(1)}</b></span><span>Weight <b>${score.parts.weight.toFixed(1)}</b></span><span>IVs <b>${score.parts.ivs.toFixed(1)}</b></span><span>XXL <b>${score.parts.xxl.toFixed(1)}</b></span></div>`
    : "";
  return `
    <article class="scan-card" data-scan-id="${escapeHTML(record.scanId)}">
      <div class="card-topline"><span class="scan-order">Scan ${index + 1}</span><span class="status-pill ${status === "Estimate" ? "is-ready" : unsupportedScoring ? "is-unsupported" : "is-review"}">${escapeHTML(status)}</span></div>
      <div class="compact-facts">
        <div class="pokemon-summary">
          <div class="pokemon-title"><strong>${escapeHTML(record.species || "Unknown species")}</strong></div>
          <div class="pokemon-facts"><span class="fact-chip">CP ${value(record.cp) || "—"}</span><span class="fact-chip ${record.xxl ? "fact-chip-xxl" : ""}">${sizeStatus}</span></div>
        </div>
        <div class="score-block"><span class="score-label">Estimated score</span><strong>${displayedScore}</strong><small>${scoreCaption}</small></div>
      </div>
      <div class="nickname-row"><div class="nickname-copy"><span>Nickname</span><strong>${escapeHTML(nickname)}</strong></div><button class="copy-button" type="button" data-copy-scan="${escapeHTML(record.scanId)}" aria-label="${exactReady ? `Copy nickname ${escapeHTML(nickname)}` : "Enter all IVs to enable nickname copy"}" ${exactReady ? "" : "disabled"}>Copy</button></div>
      ${unsupportedText}
      <details class="result-details">
        <summary>Details</summary>
        <div class="details-content">
          ${breakdown}${reviewText}
          <p class="technical-details">Height ${value(record.heightM)} m · Weight ${value(record.weightKg)} kg · IVs ${record.ivs.attack ?? "?"}/${record.ivs.defense ?? "?"}/${record.ivs.hp ?? "?"}</p>
          <span class="scan-id">Scan ID ${escapeHTML(record.scanId.slice(0, 8))}</span>
          <form class="edit-form" data-edit-form novalidate>
            <h3>Correct scan</h3><p class="edit-error" role="alert" hidden></p><p class="edit-status" role="status" hidden></p>
            <div class="scan-fields">
              ${editField(record, "species", "Species", "Choose species", "supported-species")}
              ${editField(record, "cp", "CP", "", undefined, "numeric")}
              ${editField(record, "heightM", "Height (m)", "", undefined, "decimal")}
              ${editField(record, "weightKg", "Weight (kg)", "", undefined, "decimal")}
              <label>Size<select name="xxl" data-field="xxl"><option value="unknown" ${record.xxl === null ? "selected" : ""}>Unknown</option><option value="yes" ${record.xxl === true ? "selected" : ""}>XXL</option><option value="no" ${record.xxl === false ? "selected" : ""}>Not XXL</option></select><span class="field-error" data-error-for="xxl" hidden></span></label>
              ${editField(record, "attackIV", "Attack IV", "Unknown", undefined, "numeric", record.ivs.attack)}
              ${editField(record, "defenseIV", "Defence IV", "Unknown", undefined, "numeric", record.ivs.defense)}
              ${editField(record, "hpIV", "HP IV", "Unknown", undefined, "numeric", record.ivs.hp)}
            </div>
            <button class="save-button" type="submit">Save changes</button>
          </form>
        </div>
      </details>
    </article>`;
}

function editField(
  record: ScanRecord,
  name: "species" | "cp" | "heightM" | "weightKg" | "attackIV" | "defenseIV" | "hpIV",
  label: string,
  placeholder: string,
  list?: string,
  inputmode?: "numeric" | "decimal",
  editedValue?: number | null,
): string {
  const initialValue = name === "species" ? record.species
    : name === "cp" ? value(record.cp)
      : name === "heightM" ? value(record.heightM)
        : name === "weightKg" ? value(record.weightKg)
          : value(editedValue ?? (name === "attackIV" ? record.ivs.attack : name === "defenseIV" ? record.ivs.defense : record.ivs.hp));
  return `<label>${label}<input type="text" name="${name}" data-field="${name}" value="${escapeHTML(initialValue)}" placeholder="${placeholder}" ${list ? `list="${list}"` : ""} ${inputmode ? `inputmode="${inputmode}"` : ""} /><span class="field-error" data-error-for="${name}" hidden></span></label>`;
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
