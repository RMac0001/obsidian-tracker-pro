import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import { TrackerConfig } from "../types";
import { TrackerSettings } from "../settings";

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_MASTER_FOLDER  = "Data/Bills";
const DEFAULT_PAYMENT_FOLDER = "Data/Bills/Payments/BP-{YYYY}/BP-{YYYY-MM}";

// ─── Internal Types ────────────────────────────────────────────────────────────

interface MasterBill {
  fileName:        string;   // e.g. "Hydro" stripped from "Bill-Hydro"
  bill_active:     boolean;
  bill_amount_due?: number;
  bill_company:    string;
  bill_due_date:   string;   // ISO anchor date
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
  filePath:          string; // runtime only — never written to the note
}

// ─── Path Resolution ───────────────────────────────────────────────────────────
//
// Supported variables: {YYYY} {YY} {MMMM} {MMM} {MM} {M}
// Replace longest patterns first to avoid partial matches.

export function resolveBillPath(template: string, date: Date): string {
  const yyyy = String(date.getFullYear());
  const yy   = yyyy.slice(-2);
  const mm   = String(date.getMonth() + 1).padStart(2, "0");
  const mNum = String(date.getMonth() + 1);
  const mmmm = date.toLocaleString("en-US", { month: "long" });
  const mmm  = date.toLocaleString("en-US", { month: "short" });
  return template
    .replace(/\{MMMM\}/g, mmmm)
    .replace(/\{MMM\}/g,  mmm)
    .replace(/\{MM\}/g,   mm)
    .replace(/\{M\}/g,    mNum)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g,   yy);
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
  const folder = resolveBillPath(paymentTemplate, new Date(year, month, 1)).replace(/\/$/, "");
  const ym     = `${year}-${String(month + 1).padStart(2, "0")}`;
  return normalizePath(`${folder}/BP-${billName}-${ym}.md`);
}

// Advance from the anchor date by the frequency step until the target year/month is reached.
// Returns the ISO due date for that month, or null if the bill does not occur that month.
function calculateDueDateForMonth(
  anchor:     string,
  frequency:  "monthly" | "quarterly" | "annual",
  targetYear: number,
  targetMon:  number  // 0-indexed (Jan=0)
): string | null {
  const parts = anchor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;

  const anchorYear = parseInt(parts[1]);
  const anchorMon  = parseInt(parts[2]) - 1; // 0-indexed
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

// Master notes are direct children of masterFolder (not in any subfolder).
function readMasterBills(app: App, masterFolder: string): MasterBill[] {
  return app.vault.getMarkdownFiles()
    .filter(f => {
      if (!f.path.startsWith(masterFolder + "/")) return false;
      const rel = f.path.slice(masterFolder.length + 1);
      return !rel.includes("/") && f.basename.startsWith("Bill-");
    })
    .map(f => {
      const fm   = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const freq = fm.bill_frequency;
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

// Synthetic PaymentNote from master when no file exists yet (this-month display).
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

// ─── Date Formatting ───────────────────────────────────────────────────────────

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

    const btnRow  = contentEl.createEl("div", { attr: { style: "display:flex;gap:8px;" } });
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

  // Re-read master for source-of-truth values
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

function renderBillRow(
  app:            App,
  tbody:          HTMLElement,
  payment:        PaymentNote,
  masterFolder:   string,
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

  tr.createEl("td", { text: payment.bill_name,    cls: "tracker-pro-bills-name" });
  tr.createEl("td", { text: payment.bill_company, cls: "tracker-pro-bills-company" });
  tr.createEl("td", { text: fmtDate(payment.bill_due_date),    cls: "tracker-pro-bills-due" });
  tr.createEl("td", { text: fmtMoney(payment.bill_amount_due),  cls: "tracker-pro-bills-amount" });
  tr.createEl("td", { text: fmtMoney(payment.bill_amount_paid), cls: "tracker-pro-bills-amount" });
  tr.createEl("td", { text: payment.bill_paid_date ? fmtDate(payment.bill_paid_date) : "—", cls: "tracker-pro-bills-date" });
}

// ─── Section Renderer ─────────────────────────────────────────────────────────

function renderSection(
  app:            App,
  wrapper:        HTMLElement,
  heading:        string,
  payments:       PaymentNote[],
  masterFolder:   string,
  onPaymentSaved: () => void
): void {
  if (payments.length === 0) return;

  wrapper.createEl("div", { cls: "tracker-pro-bills-section-header", text: heading });

  const table = wrapper.createEl("table", { cls: "tracker-pro-table tracker-pro-bills-table" });
  const thead = table.createEl("thead");
  const hr    = thead.createEl("tr");
  for (const col of ["", "Bill", "Company", "Due Date", "Amount Due", "Amount Paid", "Paid Date"]) {
    hr.createEl("th", { text: col });
  }

  const tbody = table.createEl("tbody");
  for (const p of payments) {
    renderBillRow(app, tbody, p, masterFolder, onPaymentSaved);
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

    const wrapper  = container.createEl("div", { cls: "tracker-pro-bills-wrapper" });
    if (config.title) wrapper.createEl("div", { cls: "tracker-pro-table-title", text: config.title });

    const thisMon = new Date(thisYear, thisMonth, 1).toLocaleString("en-US", { month: "long" });
    const nextMon = new Date(nextYear,  nextMonth,  1).toLocaleString("en-US", { month: "long" });

    renderSection(app, wrapper, `This Month — ${thisMon} ${thisYear}`,  thisMonthPayments, masterFolder, render);
    renderSection(app, wrapper, `Next Month — ${nextMon} ${nextYear}`, nextMonthPayments, masterFolder, render);

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
