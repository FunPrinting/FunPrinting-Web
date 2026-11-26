import PizZip from 'pizzip';

/**
 * Sanitize a form value before inserting into DOCX template.
 * Strips XML-unsafe control characters (except newlines/tabs) and trims whitespace.
 */
function sanitizeFormValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // Remove XML-unsafe control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) but keep \t \n \r
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

/** Sanitize all string values in a form data object. */
function sanitizeFormData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    sanitized[key] = sanitizeFormValue(value);
  }
  return sanitized;
}

/**
 * Normalize placeholder name (collapse spaces to underscores) for flexible matching.
 */
function normalizePlaceholderName(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

/** Escape special XML characters in replacement text. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Convert plain text (including newlines) into valid WordprocessingML inner `<w:t>` content. */
function formatReplacementXml(value: string): string {
  const escaped = escapeXml(value);
  if (!/[\r\n]/.test(escaped)) return escaped;
  return escaped.replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
}

/** Build a case- and whitespace-normalized lookup map from form data. */
function buildDataLookup(data: Record<string, unknown>): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [key, rawValue] of Object.entries(data)) {
    if (rawValue === undefined || rawValue === null) continue;
    const val = String(rawValue);
    const trimmed = key.trim();
    const normalized = normalizePlaceholderName(trimmed);
    lookup.set(trimmed, val);
    lookup.set(trimmed.toLowerCase(), val);
    lookup.set(normalized, val);
    lookup.set(normalized.toLowerCase(), val);
  }
  return lookup;
}

interface TextNodeSpan {
  fullMatchStart: number;
  fullMatchEnd: number;
  openTag: string;
  rawInner: string;
  textStart: number;
  textEnd: number;
}

interface SpanReplacement {
  start: number;
  end: number;
  replacementXml: string;
}

/**
 * Inspect all `<w:t>` nodes inside a single `<w:p>` paragraph, concatenate their text
 * to detect placeholders even when Word splits them across multiple `<w:r>` runs,
 * and apply replacements while preserving the `<w:rPr>` formatting of the first run.
 */
function replaceParagraphRuns(
  pXml: string,
  findReplacements: (paragraphText: string) => SpanReplacement[] | null
): string {
  const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const nodes: TextNodeSpan[] = [];
  let match: RegExpExecArray | null;
  let fullText = '';

  while ((match = tRegex.exec(pXml)) !== null) {
    const rawInner = match[1];
    const textStart = fullText.length;
    fullText += rawInner;
    nodes.push({
      fullMatchStart: match.index,
      fullMatchEnd: match.index + match[0].length,
      openTag: match[0].slice(0, match[0].indexOf('>') + 1),
      rawInner,
      textStart,
      textEnd: fullText.length,
    });
  }

  if (nodes.length === 0) return pXml;

  const replacements = findReplacements(fullText);
  if (!replacements || replacements.length === 0) return pXml;

  const nodeTexts = nodes.map((n) => n.rawInner);

  // Apply right-to-left so character offsets remain valid for earlier spans
  for (let r = replacements.length - 1; r >= 0; r--) {
    const { start, end, replacementXml } = replacements[r];
    let isFirstRun = true;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.textEnd <= start || node.textStart >= end) continue;
      const localStart = Math.max(0, start - node.textStart);
      const localEnd = Math.min(node.rawInner.length, end - node.textStart);
      const current = nodeTexts[i];
      const before = current.slice(0, localStart);
      const after = current.slice(localEnd);
      if (isFirstRun) {
        nodeTexts[i] = before + replacementXml + after;
        isFirstRun = false;
      } else {
        nodeTexts[i] = before + after;
      }
    }
  }

  let output = '';
  let cursor = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    output += pXml.slice(cursor, node.fullMatchStart);
    let openTag = node.openTag;
    const updatedText = nodeTexts[i];
    if ((updatedText.startsWith(' ') || updatedText.endsWith(' ')) && !openTag.includes('xml:space')) {
      openTag = openTag.replace('<w:t', '<w:t xml:space="preserve"');
    }
    output += openTag + updatedText + '</w:t>';
    cursor = node.fullMatchEnd;
  }
  output += pXml.slice(cursor);
  return output;
}

/** Collect all WordprocessingML story XML paths (body, headers, footers, notes). */
function getTargetXmlPaths(zip: PizZip): string[] {
  return Object.keys(zip.files).filter(
    (filePath) =>
      filePath === 'word/document.xml' ||
      /^word\/(header|footer)\d*\.xml$/.test(filePath) ||
      filePath === 'word/footnotes.xml' ||
      filePath === 'word/endnotes.xml'
  );
}

/**
 * Fill a DOCX template using the Full Run-Aware XML Pipeline.
 *
 * Coalesces split `<w:r><w:t>` runs per paragraph so fragmented tags like
 * `<w:t>{</w:t><w:t>{Assistant Professor}}</w:t>` are matched cleanly, preserves all
 * Word formatting/borders/images, XML-escapes values, and leaves non-placeholder
 * double-braces (such as React JSX `style={{ ... }}` in lab manuals) untouched.
 */
export async function fillDocxTemplate(docxBuffer: Buffer, data: Record<string, unknown>): Promise<Buffer> {
  if (!docxBuffer || docxBuffer.length === 0) {
    throw new Error('Invalid DOCX buffer: buffer is empty or null');
  }
  if (docxBuffer.length < 4 || docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4b) {
    throw new Error('Invalid DOCX file: file does not appear to be a valid ZIP/DOCX file');
  }

  const cleanData = sanitizeFormData(data || {});
  const lookup = buildDataLookup(cleanData);

  const zip = new PizZip(docxBuffer);
  const targetPaths = getTargetXmlPaths(zip);
  if (!zip.file('word/document.xml')) {
    throw new Error('Document XML not found in DOCX file');
  }

  for (const xmlPath of targetPaths) {
    const file = zip.file(xmlPath);
    if (!file) continue;
    let xmlContent = file.asText();
    if (!xmlContent.includes('{')) continue;

    xmlContent = xmlContent.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (pXml) =>
      replaceParagraphRuns(pXml, (paragraphText) => {
        if (!paragraphText.includes('{{')) return null;
        const replacements: SpanReplacement[] = [];
        const tagRegex = /\{\{([^{}]+)\}\}/g;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = tagRegex.exec(paragraphText)) !== null) {
          const rawKey = tagMatch[1].trim();
          const normalizedKey = normalizePlaceholderName(rawKey);
          const value =
            lookup.get(rawKey) ??
            lookup.get(rawKey.toLowerCase()) ??
            lookup.get(normalizedKey) ??
            lookup.get(normalizedKey.toLowerCase());

          if (value !== undefined) {
            replacements.push({
              start: tagMatch.index,
              end: tagMatch.index + tagMatch[0].length,
              replacementXml: formatReplacementXml(value),
            });
          }
        }
        return replacements;
      })
    );

    zip.file(xmlPath, xmlContent);
  }

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Extract unique `{{placeholder}}` names from a DOCX document across body, headers,
 * and footers, handling placeholders split across `<w:r><w:t>` XML runs.
 */
export async function extractPlaceholders(docxBuffer: Buffer): Promise<string[]> {
  try {
    const zip = new PizZip(docxBuffer);
    if (!zip.file('word/document.xml')) {
      throw new Error('Document XML not found in DOCX file');
    }

    const found = new Set<string>();
    const placeholderRegex = /\{\{([A-Za-z][A-Za-z0-9_\s]*)\}\}/g;

    for (const xmlPath of getTargetXmlPaths(zip)) {
      const file = zip.file(xmlPath);
      if (!file) continue;
      const xmlContent = file.asText();
      const paragraphs = xmlContent.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
      for (const pXml of paragraphs) {
        const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;
        let paragraphText = '';
        let tMatch: RegExpExecArray | null;
        while ((tMatch = tRegex.exec(pXml)) !== null) {
          paragraphText += tMatch[1];
        }
        if (!paragraphText.includes('{{')) continue;
        let pMatch: RegExpExecArray | null;
        placeholderRegex.lastIndex = 0;
        while ((pMatch = placeholderRegex.exec(paragraphText)) !== null) {
          const name = pMatch[1].trim();
          if (name) found.add(name);
        }
      }
    }

    return Array.from(found);
  } catch (error) {
    console.error('Error extracting placeholders:', error);
    throw new Error('Failed to extract placeholders from DOCX');
  }
}

/**
 * Generate form schema from placeholders
 * @param placeholders - Array of placeholder names
 * @returns Object - Form schema for dynamic form generation
 */
export function generateFormSchema(placeholders: string[]): Record<string, any> {
  const schema: Record<string, any> = {};

  placeholders.forEach((placeholder) => {
    const defaultPlaceholder = `Enter ${placeholder}`;
    schema[placeholder] = {
      type: 'string',
      label: placeholder.charAt(0).toUpperCase() + placeholder.slice(1),
      required: true,
      placeholder: defaultPlaceholder,
      defaultPlaceholder,
    };
  });

  return schema;
}

/**
 * Validate form data against schema
 * @param formData - Form data to validate
 * @param schema - Form schema
 * @returns Object - Validation result
 */
export function validateFormData(formData: Record<string, any>, schema: any[]): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  schema.forEach((field) => {
    if (field.required && (!formData[field.key] || String(formData[field.key]).trim() === '')) {
      errors.push(`${field.key} is required`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}
