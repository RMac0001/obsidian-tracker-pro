/**
 * Resolves {{DATE:FORMAT}} tokens in a template string using moment.js.
 * If a date is provided it is used; otherwise the current date is used.
 * FORMAT is any moment.js format string (e.g. YYYY, MM, YYYY-MM, MMMM).
 */
export function resolveDateTemplate(template: string, date?: Date): string {
    const m = date
        ? (window as any).moment(date)
        : (window as any).moment();
    return template.replace(/\{\{DATE:([^}]+)\}\}/g, (_, fmt) => m.format(fmt));
}
