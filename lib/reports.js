const ExcelJS = require('exceljs');

function columnWidths(summaryRow) {
  return summaryRow.map(() => ({ width: 22 }));
}

async function buildTicketsWorkbook(tickets, filters) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecel AskHR';
  wb.created = new Date();

  const ws = wb.addWorksheet('Tickets');
  ws.columns = [
    { header: 'Ticket Number', key: 'ticketRef' },
    { header: 'Name', key: 'name' },
    { header: 'Email', key: 'email' },
    { header: 'Function', key: 'department' },
    { header: 'Category', key: 'category' },
    { header: 'Subject', key: 'subject' },
    { header: 'Priority', key: 'priority' },
    { header: 'Status', key: 'status' },
    { header: 'Assigned To', key: 'assignedTo' },
    { header: 'Date Created', key: 'createdAt' },
    { header: 'Last Updated', key: 'updatedAt' },
    { header: 'Description', key: 'description' },
    { header: 'Resolution', key: 'resolution' }
  ];
  ws.columns.forEach(c => (c.width = 22));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD92525' } };
  headerRow.alignment = { vertical: 'middle' };

  tickets.forEach(t => {
    const row = ws.addRow({
      ticketRef: t.ticketRef,
      name: t.name,
      email: t.email,
      department: t.department,
      category: t.category,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      assignedTo: t.assignedTo || '',
      createdAt: new Date(t.createdAt).toLocaleString('en-GB'),
      updatedAt: new Date(t.updatedAt).toLocaleString('en-GB'),
      description: t.description,
      resolution: t.resolution || ''
    });
    row.getCell('createdAt').numFmt = '@';
    row.getCell('updatedAt').numFmt = '@';
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: ws.columns.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  if (tickets.length) {
    const summary = wb.addWorksheet('Summary');
    summary.rows = [];
    summary.addRow(['Telecel AskHR - Ticket Report']);
    summary.addRow(['Generated', new Date().toLocaleString('en-GB')]);
    if (filters.status) summary.addRow(['Status Filter', filters.status]);
    if (filters.priority) summary.addRow(['Priority Filter', filters.priority]);
    if (filters.department) summary.addRow(['Function Filter', filters.department]);
    summary.addRow([]);
    summary.addRow(['Metric', 'Count']);
    const title = summary.getRow(1);
    title.font = { bold: true, size: 16, color: { argb: 'FFD92525' } };
    const metricHeader = summary.getRow(summary.rowCount);
    metricHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    metricHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD92525' } };

    const statusCounts = {};
    tickets.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });
    const byStatus = Object.entries(statusCounts);
    const byDepartment = {};
    tickets.forEach(t => { byDepartment[t.department] = (byDepartment[t.department] || 0) + 1; });
    const byPriority = {};
    tickets.forEach(t => { byPriority[t.priority] = (byPriority[t.priority] || 0) + 1; });
    const byCategory = {};
    tickets.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + 1; });

    summary.addRow(['Total Tickets', tickets.length]);
    summary.addRow([]);
    summary.addRow(['Open', byStatus['Open'] || 0]);
    summary.addRow(['In Progress', byStatus['In Progress'] || 0]);
    summary.addRow(['Resolved', byStatus['Resolved'] || 0]);
    summary.addRow(['Closed', byStatus['Closed'] || 0]);
    summary.addRow([]);
    summary.addRow(['Function Breakdown', 'Count']);
    Object.entries(byDepartment).forEach(([k, v]) => summary.addRow([k, v]));
    summary.addRow([]);
    summary.addRow(['Priority Breakdown', 'Count']);
    Object.entries(byPriority).forEach(([k, v]) => summary.addRow([k, v]));
    summary.addRow([]);
    summary.addRow(['Category Breakdown', 'Count']);
    Object.entries(byCategory).forEach(([k, v]) => summary.addRow([k, v]));
  }

  return wb;
}

module.exports = { buildTicketsWorkbook };
