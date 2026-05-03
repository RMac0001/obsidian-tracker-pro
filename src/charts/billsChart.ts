import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import { TrackerConfig } from "../types";
import { TrackerSettings } from "../settings";
import { resolveDateTemplate } from "../utils";

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_MASTER_FOLDER  = "Data/Bills";
const DEFAULT_PAYMENT_FOLDER = "Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}";

// ─── Column Definitions ────────────────────────────────────────────────────────

interface ColumnDef {
  key:     string;
  label:   string;
  sortVal: (p: PaymentNote) => string | number;
}

const BILL_COLS: ColumnDef[] = [
  { key: "name",        label: "Bill",        sortVal: p => p.bill_name },
  { key: "company",     label: "Company",     sortVal: p => p.bill_company },
  { key: "due",         label: "Due Date",    sortVal: p => p.bill_due_date },
  { key: "amount_due",  label: "Amount Due",  sortVal: p => p.bill_amount_due  ?? -1 },
  { key: "amount_paid", label: "Amount Paid", sortVal: p => p.bill_amount_paid ?? -1 },
  { key: "paid_date",   label: "Paid Date",   sortVal: p => p.bill_paid_date   ?? "" },
];

// ─── Internal Types ────────────────────────────────────────────────────────────

interface MasterBill {
  fileName:        string;
  bill_active:     boolean;
  bill_amount_due?: number;
  bill_company:    string;
  bill_due_date:   string;
  bill_frequency:  "monthly" | "quarterly" | "annual";
  bill_type:       string;
}

interface PaymentNote {
  bill_name:         string;
  bill_company:      string;
  bill_type:         string;
  bill_due_date:     string;
  bill_amount_due?:  number;
  bill_amount_paid?: number;
  bill_paid_date?:   string;
  bill_status:       "unpaid" | "paid";
  filePath:          string;
}

function getBillPaths(settings?: TrackerSettings): { masterFolder: string; paymentTemplate: string } {
  return {
    masterFolder:    (settings?.billsMasterFolder  ?? DEFAULT_MASTER_FOLDER).replace(/\/$/, ""),
    paymentTemplate: settings?.billsPaymentFolder  ?? DEFAULT_PAYMENT_FOLDER,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string")  return val.toLowerCase() === "true";
  return false;
}

function paymentNotePath(billName: string, year: number, month: number, paymentTemplate: string): string {
  const date   = new Date(year, month, 1);
  const folder = resolveDateTemplate(paymentTemplate, date).replace(/\/$/, "");
  const ym     = `${year}-${String(month + 1).padStart(2, "0")}`;
  return normalizePath(`${folder}/BP-${billName}-${ym}.md`);
}

function calculateDueDateForMonth(
  anchor:     string,
  frequency:  "monthly" | "quarterly" | "annual",
  targetYear: number,
  targetMon:  number
): string | null {
  const parts = anchor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;

  const anchorYear = parseInt(parts[1]);
  const anchorMon  = parseInt(parts[2]) - 1;
  const anchorDay  = parseInt(parts[3]);
  const step = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;

  let y = anchorYear;
  let m = anchorMon;

  while (y < targetYear || (y === targetYear && m < targetMon)) {
    m += step;
    y += Math.floor(m / 12);
    m %= 12;
  }

  if (y !== targetYear || m !== targetMon) return null;

  const daysInMonth = new Date(targetYear, targetMon + 1, 0).getDate();
  const day = Math.min(anchorDay, daysInMonth);
  return `${targetYear}-${String(targetMon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Vault Reads ───────────────────────────────────────────────────────────────

function readMasterBills(app: App, masterFolder: string): MasterBill[] {
  return app.vault.getMarkdownFiles()
    .filter(f => {
      if (!f.path.startsWith(masterFolder + "/")) return false;
      const rel = f.path.slice(masterFolder.length + 1);
      return !rel.includes("/") && f.basename.startsWith("Bill-");
    })
    .map(f => {
      const fm   = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const freq = String(fm.bill_frequency ?? "").toLowerCase();
      return {
        fileName:        f.basename.slice("Bill-".length),
        bill_active:     parseBool(fm.bill_active),
        bill_amount_due: fm.bill_amount_due != null ? Number(fm.bill_amount_due) : undefined,
        bill_company:    String(fm.bill_company  ?? ""),
        bill_due_date:   String(fm.bill_due_date ?? ""),
        bill_frequency:  (["monthly","quarterly","annual"].includes(freq) ? freq : "monthly") as MasterBill["bill_frequency"],
        bill_type:       String(fm.bill_type     ?? ""),
      };
    })
    .filter(b => b.bill_active);
}

function readPaymentNote(
  app: App, billName: string, year: number, month: number, paymentTemplate: string
): PaymentNote | null {
  const path = paymentNotePath(billName, year, month, paymentTemplate);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;

  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  return {
    bill_name:        String(fm.bill_name        ?? billName),
    bill_company:     String(fm.bill_company     ?? ""),
    bill_type:        String(fm.bill_type        ?? ""),
    bill_due_date:    String(fm.bill_due_date    ?? ""),
    bill_amount_due:  fm.bill_amount_due  != null ? Number(fm.bill_amount_due)  : undefined,
    bill_amount_paid: fm.bill_amount_paid != null ? Number(fm.bill_amount_paid) : undefined,
    bill_paid_date:   fm.bill_paid_date   ? String(fm.bill_paid_date) : undefined,
    bill_status:      fm.bill_status === "paid" ? "paid" : "unpaid",
    filePath:         path,
  };
}

// ─── Note Creation ─────────────────────────────────────────────────────────────

async function ensureFolders(app: App, filePath: string): Promise<void> {
  const parts = filePath.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try { await app.vault.createFolder(current); } catch { /* already exists */ }
    }
  }
}

function buildPaymentContent(
  billName:   string,
  company:    string,
  billType:   string,
  dueDate:    string,
  amountDue:  number | undefined,
  amountPaid: number | undefined,
  paidDate:   string | undefined,
  status:     "unpaid" | "paid",
  body:       string
): string {
  let fm = "---\n";
  fm += `bill_amount_due: ${amountDue !== undefined ? amountDue : ""}\n`;
  fm += `bill_amount_paid: ${amountPaid !== undefined ? amountPaid : ""}\n`;
  fm += `bill_company: ${company}\n`;
  fm += `bill_due_date: ${dueDate}\n`;
  fm += `bill_name: ${billName}\n`;
  fm += `bill_paid_date: ${paidDate ?? ""}\n`;
  fm += `bill_status: ${status}\n`;
  fm += `bill_type: ${billType}\n`;
  fm += "---\n\n";
  fm += body;
  return fm;
}

async function createPaymentNote(
  app:             App,
  master:          MasterBill,
  dueDate:         string,
  year:            number,
  month:           number,
  paymentTemplate: string
): Promise<PaymentNote> {
  const path = paymentNotePath(master.fileName, year, month, paymentTemplate);
  await ensureFolders(app, path);

  const monthName = new Date(year, month, 1).toLocaleString("en-US", { month: "long" });
  const body      = `Payment record for ${master.bill_company} — ${monthName} ${year}.\n`;
  const content   = buildPaymentContent(
    master.fileName, master.bill_company, master.bill_type,
    dueDate, master.bill_amount_due, undefined, undefined, "unpaid", body
  );

  await app.vault.create(path, content);

  return {
    bill_name:       master.fileName,
    bill_company:    master.bill_company,
    bill_type:       master.bill_type,
    bill_due_date:   dueDate,
    bill_amount_due: master.bill_amount_due,
    bill_status:     "unpaid",
    filePath:        path,
  };
}

function syntheticPayment(
  master: MasterBill, dueDate: string, year: number, month: number, paymentTemplate: string
): PaymentNote {
  return {
    bill_name:       master.fileName,
    bill_company:    master.bill_company,
    bill_type:       master.bill_type,
    bill_due_date:   dueDate,
    bill_amount_due: master.bill_amount_due,
    bill_status:     "unpaid",
    filePath:        paymentNotePath(master.fileName, year, month, paymentTemplate),
  };
}

// ─── Date / Money Formatting ───────────────────────────────────────────────────

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const p = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!p) return iso;
  return new Date(parseInt(p[1]), parseInt(p[2]) - 1, parseInt(p[3]))
    .toLocaleString("en-US", { month: "short", day: "numeric" });
}

function fmtMoney(n: number | undefined): string {
  if (n === undefined) return "—";
  return `$${n.toFixed(2)}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isOverdue(p: PaymentNote): boolean {
  return p.bill_status !== "paid" && p.bill_due_date <= todayIso();
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

class RecordPaymentModal extends Modal {
  private input!: HTMLInputElement;

  constructor(
    app: App,
    private payment: PaymentNote,
    private onSave:  (amountPaid: number) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Record Payment" });

    const info = contentEl.createEl("div", {
      attr: { style: "margin-bottom:12px;color:var(--text-muted);font-size:0.9em;" },
    });
    info.createEl("div", { text: `Bill: ${this.payment.bill_name}` });
    info.createEl("div", { text: `Due: ${fmtDate(this.payment.bill_due_date)}` });
    if (this.payment.bill_amount_due !== undefined) {
      info.createEl("div", { text: `Amount Due: ${fmtMoney(this.payment.bill_amount_due)}` });
    }

    contentEl.createEl("label", {
      text: "Amount Paid",
      attr: { style: "font-size:0.9em;color:var(--text-muted);" },
    });

    this.input = contentEl.createEl("input", {
      attr: {
        type: "number", min: "0", step: "0.01", placeholder: "0.00",
        style:
          "display:block;width:100%;padding:8px 10px;font-size:1.1em;" +
          "border:1px solid var(--background-modifier-border);" +
          "border-radius:6px;background:var(--background-primary);" +
          "color:var(--text-normal);margin:6px 0 14px;",
      },
    });

    if (this.payment.bill_amount_due !== undefined) {
      this.input.value = String(this.payment.bill_amount_due);
    }

    this.input.focus();
    this.input.select();

    const btnRow    = contentEl.createEl("div", { attr: { style: "display:flex;gap:8px;" } });
    const saveBtn   = btnRow.createEl("button", { text: "Save",   attr: { style: "flex:1;padding:8px;cursor:pointer;" } });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel", attr: { style: "flex:1;padding:8px;cursor:pointer;" } });

    saveBtn.onclick   = () => this.submit();
    cancelBtn.onclick = () => this.close();
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")  this.submit();
      if (e.key === "Escape") this.close();
    });
  }

  private submit(): void {
    const val = parseFloat(this.input.value);
    if (isNaN(val) || val < 0) { new Notice("Please enter a valid amount."); return; }
    this.close();
    this.onSave(val);
  }

  onClose(): void { this.contentEl.empty(); }
}

// ─── Save Payment ─────────────────────────────────────────────────────────────

async function savePayment(
  app: App, payment: PaymentNote, amountPaid: number, masterFolder: string
): Promise<void> {
  const today = todayIso();

  const masterFile = app.vault.getMarkdownFiles().find(f => {
    if (!f.path.startsWith(masterFolder + "/")) return false;
    const rel = f.path.slice(masterFolder.length + 1);
    return !rel.includes("/") && f.basename === `Bill-${payment.bill_name}`;
  });
  const masterFm = masterFile
    ? (app.metadataCache.getFileCache(masterFile)?.frontmatter ?? {})
    : {};

  const amountDue = masterFm.bill_amount_due != null
    ? Number(masterFm.bill_amount_due)
    : payment.bill_amount_due;

  const existingFile = app.vault.getAbstractFileByPath(payment.filePath);

  if (existingFile instanceof TFile) {
    const existing  = await app.vault.read(existingFile);
    const bodyMatch = existing.match(/^---[\s\S]*?---\n+([\s\S]*)$/);
    const body      = bodyMatch ? bodyMatch[1] : `Payment record for ${payment.bill_company}.\n`;
    await app.vault.modify(
      existingFile,
      buildPaymentContent(payment.bill_name, payment.bill_company, payment.bill_type,
        payment.bill_due_date, amountDue, amountPaid, today, "paid", body)
    );
  } else {
    await ensureFolders(app, payment.filePath);
    const dueParts  = payment.bill_due_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dYear     = dueParts ? parseInt(dueParts[1]) : new Date().getFullYear();
    const dMonth    = dueParts ? parseInt(dueParts[2]) - 1 : new Date().getMonth();
    const monthName = new Date(dYear, dMonth, 1).toLocaleString("en-US", { month: "long" });
    const body      = `Payment record for ${payment.bill_company} — ${monthName} ${dYear}.\n`;
    await app.vault.create(
      payment.filePath,
      buildPaymentContent(payment.bill_name, payment.bill_company, payment.bill_type,
        payment.bill_due_date, amountDue, amountPaid, today, "paid", body)
    );
  }

  new Notice(`✓ Payment recorded for ${payment.bill_name}`);
}

// ─── Row Renderer ─────────────────────────────────────────────────────────────

function renderMasterLink(td: HTMLElement, displayText: string, billName: string, masterFolder: string): void {
  const path = normalizePath(`${masterFolder}/Bill-${billName}.md`);
  const a = td.createEl("a", { cls: "internal-link", text: displayText });
  a.setAttribute("href", path);
  a.setAttribute("data-href", path);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer");
}

function renderBillRow(
  app:            App,
  tbody:          HTMLElement,
  payment:        PaymentNote,
  masterFolder:   string,
  visibleCols:    Set<string>,
  linkColumn:     "name" | "company" | null,
  onPaymentSaved: () => void
): void {
  const paid    = payment.bill_status === "paid";
  const overdue = isOverdue(payment);

  const tr = tbody.createEl("tr");
  if (overdue) tr.addClass("tracker-pro-bills-overdue");

  const checkTd  = tr.createEl("td", { cls: "tracker-pro-bills-check" });
  const checkbox = checkTd.createEl("input", { attr: { type: "checkbox" } });
  checkbox.checked  = paid;
  checkbox.disabled = paid;

  if (!paid) {
    checkbox.addEventListener("change", () => {
      checkbox.checked = false;
      new RecordPaymentModal(app, payment, async (amountPaid) => {
        await savePayment(app, payment, amountPaid, masterFolder);
        onPaymentSaved();
      }).open();
    });
  }

  if (visibleCols.has("name")) {
    const td = tr.createEl("td", { cls: "tracker-pro-bills-name" });
    if (linkColumn === "name") renderMasterLink(td, payment.bill_name, payment.bill_name, masterFolder);
    else td.setText(payment.bill_name);
  }
  if (visibleCols.has("company")) {
    const td = tr.createEl("td", { cls: "tracker-pro-bills-company" });
    if (linkColumn === "company") renderMasterLink(td, payment.bill_company, payment.bill_name, masterFolder);
    else td.setText(payment.bill_company);
  }
  if (visibleCols.has("due")) {
    tr.createEl("td", { text: fmtDate(payment.bill_due_date), cls: "tracker-pro-bills-due" });
  }
  if (visibleCols.has("amount_due")) {
    tr.createEl("td", { text: fmtMoney(payment.bill_amount_due), cls: "tracker-pro-bills-amount" });
  }
  if (visibleCols.has("amount_paid")) {
    tr.createEl("td", { text: fmtMoney(payment.bill_amount_paid), cls: "tracker-pro-bills-amount" });
  }
  if (visibleCols.has("paid_date")) {
    tr.createEl("td", { text: payment.bill_paid_date ? fmtDate(payment.bill_paid_date) : "—", cls: "tracker-pro-bills-date" });
  }
}

// ─── Section Renderer ─────────────────────────────────────────────────────────

function renderSection(
  app:            App,
  wrapper:        HTMLElement,
  heading:        string,
  payments:       PaymentNote[],
  masterFolder:   string,
  visibleCols:    Set<string>,
  sortKey:        string | null,
  sortDir:        "asc" | "desc",
  onHeaderClick:  (key: string) => void,
  onPaymentSaved: () => void
): void {
  if (payments.length === 0) return;

  const linkColumn: "name" | "company" | null =
    visibleCols.has("name") ? "name" : visibleCols.has("company") ? "company" : null;

  const sorted = sortKey
    ? [...payments].sort((a, b) => {
        const col = BILL_COLS.find(c => c.key === sortKey)!;
        const av = col.sortVal(a);
        const bv = col.sortVal(b);
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return sortDir === "asc" ? cmp : -cmp;
      })
    : payments;

  wrapper.createEl("div", { cls: "tracker-pro-bills-section-header", text: heading });

  const table = wrapper.createEl("table", { cls: "tracker-pro-table tracker-pro-bills-table" });
  const thead = table.createEl("thead");
  const hr    = thead.createEl("tr");
  hr.createEl("th"); // checkbox column — always visible, never sorted

  for (const col of BILL_COLS) {
    if (!visibleCols.has(col.key)) continue;
    const th = hr.createEl("th", { cls: "tracker-pro-bills-sortable" });
    th.createEl("span", { text: col.label });
    if (sortKey === col.key) {
      th.createEl("span", {
        text: sortDir === "asc" ? " ↑" : " ↓",
        cls: "tracker-pro-bills-sort-icon",
      });
      th.addClass("tracker-pro-bills-sorted");
    }
    th.addEventListener("click", () => onHeaderClick(col.key));
  }

  const tbody = table.createEl("tbody");
  for (const p of sorted) {
    renderBillRow(app, tbody, p, masterFolder, visibleCols, linkColumn, onPaymentSaved);
  }
}

// ─── Main Renderer ─────────────────────────────────────────────────────────────

export async function renderBillsChart(
  container: HTMLElement,
  app:       App,
  config:    TrackerConfig,
  settings?: TrackerSettings
): Promise<void> {
  const { masterFolder, paymentTemplate } = getBillPaths(settings);

  // State persists across navigation via localStorage, scoped by bill_type filter.
  const stateKey = `tracker-pro-bills-${config.bill_type ?? "all"}`;

  function loadState(): { visibleCols: Set<string>; sortKey: string | null; sortDir: "asc" | "desc" } {
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) {
        const s = JSON.parse(raw);
        return {
          visibleCols: new Set(Array.isArray(s.visibleCols) ? s.visibleCols : BILL_COLS.map(c => c.key)),
          sortKey:     typeof s.sortKey === "string" ? s.sortKey : null,
          sortDir:     s.sortDir === "desc" ? "desc" : "asc",
        };
      }
    } catch { /* corrupt or unavailable */ }
    return { visibleCols: new Set(BILL_COLS.map(c => c.key)), sortKey: null, sortDir: "asc" };
  }

  function saveState(): void {
    try {
      localStorage.setItem(stateKey, JSON.stringify({
        visibleCols: [...visibleCols],
        sortKey,
        sortDir,
      }));
    } catch { /* storage unavailable */ }
  }

  const initial = loadState();
  const visibleCols = initial.visibleCols;
  let sortKey: string | null = initial.sortKey;
  let sortDir: "asc" | "desc" = initial.sortDir;

  function onHeaderClick(key: string): void {
    if (sortKey === key) {
      if (sortDir === "asc") { sortDir = "desc"; }
      else { sortKey = null; sortDir = "asc"; }
    } else {
      sortKey = key;
      sortDir = "asc";
    }
    saveState();
    render();
  }

  async function render(): Promise<void> {
    container.empty();
    container.addClass("tracker-pro-container");

    const now       = new Date();
    const thisYear  = now.getFullYear();
    const thisMonth = now.getMonth();
    const nextMonth = thisMonth === 11 ? 0  : thisMonth + 1;
    const nextYear  = thisMonth === 11 ? thisYear + 1 : thisYear;

    const typeFilter = config.bill_type?.toLowerCase();

    let masters = readMasterBills(app, masterFolder);
    if (typeFilter) masters = masters.filter(m => m.bill_type.toLowerCase() === typeFilter);
    masters.sort((a, b) => a.fileName.localeCompare(b.fileName));

    const thisMonthPayments: PaymentNote[] = [];
    const nextMonthPayments: PaymentNote[] = [];

    for (const master of masters) {
      const thisDue = calculateDueDateForMonth(master.bill_due_date, master.bill_frequency, thisYear, thisMonth);
      if (thisDue) {
        thisMonthPayments.push(
          readPaymentNote(app, master.fileName, thisYear, thisMonth, paymentTemplate)
          ?? syntheticPayment(master, thisDue, thisYear, thisMonth, paymentTemplate)
        );
      }

      const nextDue = calculateDueDateForMonth(master.bill_due_date, master.bill_frequency, nextYear, nextMonth);
      if (nextDue) {
        nextMonthPayments.push(
          readPaymentNote(app, master.fileName, nextYear, nextMonth, paymentTemplate)
          ?? await createPaymentNote(app, master, nextDue, nextYear, nextMonth, paymentTemplate)
        );
      }
    }

    const wrapper = container.createEl("div", { cls: "tracker-pro-bills-wrapper" });

    // ── Header ────────────────────────────────────────────────────────────────
    const headerEl = wrapper.createEl("div", { cls: "tracker-pro-bills-header" });
    if (config.title) headerEl.createEl("div", { cls: "tracker-pro-table-title", text: config.title });

    const controls = headerEl.createEl("div", { cls: "tracker-pro-bills-controls" });

    // Columns dropdown
    const colsWrap  = controls.createEl("div", { cls: "tracker-pro-bills-cols-wrap" });
    const colsBtn   = colsWrap.createEl("button", { cls: "tracker-pro-bills-cols-btn", text: "Columns ▾" });
    const colsPanel = colsWrap.createEl("div", { cls: "tracker-pro-bills-cols-panel" });
    colsPanel.style.display = "none";

    for (const col of BILL_COLS) {
      const item = colsPanel.createEl("label", { cls: "tracker-pro-bills-col-item" });
      const cb   = item.createEl("input", { attr: { type: "checkbox" } }) as HTMLInputElement;
      cb.checked = visibleCols.has(col.key);
      item.appendText(col.label);
      cb.addEventListener("change", () => {
        if (cb.checked) visibleCols.add(col.key);
        else visibleCols.delete(col.key);
        saveState();
        render();
      });
    }

    colsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      colsPanel.style.display = colsPanel.style.display === "none" ? "block" : "none";
    });
    colsPanel.addEventListener("click", (e) => e.stopPropagation());

    // Close panel when clicking anywhere outside the columns widget
    wrapper.addEventListener("click", (e) => {
      if (!colsWrap.contains(e.target as Node)) {
        colsPanel.style.display = "none";
      }
    });

    // Refresh button
    const refreshBtn = controls.createEl("button", { cls: "tracker-pro-bills-refresh", text: "↻ Refresh" });
    refreshBtn.addEventListener("click", () => render());

    // ── Sections ──────────────────────────────────────────────────────────────
    const thisMon = new Date(thisYear, thisMonth, 1).toLocaleString("en-US", { month: "long" });
    const nextMon = new Date(nextYear,  nextMonth,  1).toLocaleString("en-US", { month: "long" });

    renderSection(app, wrapper, `This Month — ${thisMon} ${thisYear}`,
      thisMonthPayments, masterFolder, visibleCols, sortKey, sortDir, onHeaderClick, render);
    renderSection(app, wrapper, `Next Month — ${nextMon} ${nextYear}`,
      nextMonthPayments, masterFolder, visibleCols, sortKey, sortDir, onHeaderClick, render);

    if (thisMonthPayments.length === 0 && nextMonthPayments.length === 0) {
      const empty = wrapper.createEl("div", { cls: "tracker-pro-empty" });
      empty.createEl("span", { text: "📋 No bills found" });
      empty.createEl("small", { text: `No active master notes found in ${masterFolder}/` });
    }
  }

  await render();
}

// ─── Generate Monthly Bills Command ──────────────────────────────────────────

export async function generateMonthlyBills(app: App, settings?: TrackerSettings): Promise<void> {
  const { masterFolder, paymentTemplate } = getBillPaths(settings);

  const now       = new Date();
  const year      = now.getFullYear();
  const month     = now.getMonth();
  const monthName = now.toLocaleString("en-US", { month: "long" });

  const masters = readMasterBills(app, masterFolder);
  let created = 0;

  for (const master of masters) {
    const dueDate = calculateDueDateForMonth(master.bill_due_date, master.bill_frequency, year, month);
    if (!dueDate) continue;

    const path = paymentNotePath(master.fileName, year, month, paymentTemplate);
    if (app.vault.getAbstractFileByPath(path) instanceof TFile) continue;

    await createPaymentNote(app, master, dueDate, year, month, paymentTemplate);
    created++;
  }

  new Notice(`Generated ${created} bill${created !== 1 ? "s" : ""} for ${monthName} ${year}`);
}
