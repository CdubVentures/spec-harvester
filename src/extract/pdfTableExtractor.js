/**
 * PDF Table Extraction (IP02-2D).
 *
 * Extracts spec tables from PDF datasheets.
 * Uses pdf-parse for text extraction, then heuristic
 * table detection on the extracted text.
 */

/**
 * Extract text from PDF buffer or return pre-extracted text.
 * If a buffer is provided, uses pdf-parse. Otherwise returns the text as-is.
 */
export async function extractPdfText({ buffer, text } = {}) {
  if (text) return String(text);
  if (!buffer) return '';

  try {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    return '';
  }
}

/**
 * Detect and extract key-value spec tables from PDF text.
 *
 * Heuristic: looks for lines with two or more whitespace-separated columns
 * where the left column is a label and the right is a value.
 */
export function extractTablesFromPdfText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const tables = [];
  let currentTable = null;
  let consecutiveNonTable = 0;

  for (const line of lines) {
    const row = parseTableRow(line);

    if (row) {
      if (!currentTable) {
        currentTable = { rows: [], startLine: line };
      }
      currentTable.rows.push(row);
      consecutiveNonTable = 0;
    } else {
      consecutiveNonTable += 1;
      // If we have a table in progress and hit 2+ non-table lines, close it
      if (currentTable && consecutiveNonTable >= 2) {
        if (currentTable.rows.length >= 3) {
          tables.push(currentTable);
        }
        currentTable = null;
      }
    }
  }

  // Close any remaining table
  if (currentTable && currentTable.rows.length >= 3) {
    tables.push(currentTable);
  }

  return tables;
}

/**
 * Try to parse a line as a key-value table row.
 * Returns { key, value } or null.
 */
function parseTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.length < 5) return null;

  // Skip lines that look like headers, footers, or prose
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('for more') || lower.startsWith('visit') || lower.startsWith('http')) return null;
  if (lower.startsWith('copyright') || lower.startsWith('page ')) return null;

  // Look for lines with significant whitespace gap (table columns)
  const gapMatch = trimmed.match(/^(.{2,40})\s{2,}(.{1,})$/);
  if (!gapMatch) return null;

  const key = gapMatch[1].trim();
  const value = gapMatch[2].trim();

  // Key should look like a label (not all numbers, not too short)
  if (key.length < 2 || /^\d+$/.test(key)) return null;
  // Value should have some content
  if (value.length < 1) return null;

  return { key, value };
}

/**
 * Convert extracted tables into a field map.
 * Normalizes keys to snake_case for field matching.
 */
export function parsePdfSpecTable(tables) {
  const fieldMap = {};

  for (const table of tables) {
    for (const row of table.rows) {
      // Skip header rows (where value looks like another header)
      const lowerValue = row.value.toLowerCase();
      if (lowerValue === 'value' || lowerValue === 'detail' || lowerValue === 'spec' || lowerValue === 'specification') {
        continue;
      }

      const key = String(row.key)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      if (key && !fieldMap[key]) {
        fieldMap[key] = row.value;
      }
    }
  }

  return fieldMap;
}
