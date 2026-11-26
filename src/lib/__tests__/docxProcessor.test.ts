import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { extractPlaceholders, fillDocxTemplate } from '@/lib/docxProcessor';

function makeDocx(
  documentXml: string,
  extraFiles: Record<string, string> = {}
): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file('word/document.xml', documentXml);
  for (const [name, content] of Object.entries(extraFiles)) {
    zip.file(name, content);
  }
  return zip.generate({ type: 'nodebuffer' });
}

function readPlainText(docxBuffer: Buffer, filePath = 'word/document.xml'): string {
  const zip = new PizZip(docxBuffer);
  const xml = zip.file(filePath)?.asText() || '';
  return xml.replace(/<[^>]+>/g, '');
}

describe('docxProcessor (Full Run-Aware XML Pipeline)', () => {
  it('replaces placeholders split across multiple <w:r><w:t> runs and preserves formatting', async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>{</w:t></w:r>
      <w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>{Name}}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>{</w:t></w:r>
      <w:r><w:t>{</w:t></w:r>
      <w:r><w:t>Assistant Professor}}</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const input = makeDocx(docXml);
    const filled = await fillDocxTemplate(input, {
      Name: 'Aditya Pandey',
      'Assistant Professor': 'Dr. Rahul Sharma',
    });

    const plain = readPlainText(filled);
    expect(plain).toContain('Aditya Pandey');
    expect(plain).toContain('Dr. Rahul Sharma');
    expect(plain).not.toContain('{{');

    // Bold & font size formatting of the first run must survive
    const outXml = new PizZip(filled).file('word/document.xml')!.asText();
    expect(outXml).toContain('<w:b/><w:sz w:val="28"/></w:rPr><w:t>Aditya Pandey</w:t>');
  });

  it('matches normalized keys (spaces vs underscores, case-insensitive)', async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{{Assistant Professor}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{roll_no}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const filled = await fillDocxTemplate(makeDocx(docXml), {
      Assistant_Professor: 'Prof. Mehta',
      RollNo: '220111075',
    });

    const plain = readPlainText(filled);
    expect(plain).toContain('Prof. Mehta');
    // Unmatched key remains untouched rather than crashing
    expect(plain).toContain('{{roll_no}}');
  });

  it('leaves React JSX / C / HTML curly braces inside lab manuals completely untouched', async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Submitted by {{Name}} under {{Assistant Professor}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>&lt;div style={{</w:t></w:r><w:r><w:t> textAlign: &quot;center&quot;, marginTop: &quot;50px&quot; }}&gt;</w:t></w:r></w:p>
    <w:p><w:r><w:t>onClick={() =&gt; toggle(i)} style={{</w:t></w:r></w:p>
    <w:p><w:r><w:t>}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const filled = await fillDocxTemplate(makeDocx(docXml), {
      Name: 'Aditya Pandey',
      'Assistant Professor': 'Dr. Rahul Sharma',
    });

    const plain = readPlainText(filled);
    expect(plain).toContain('Submitted by Aditya Pandey under Dr. Rahul Sharma');
    expect(plain).toContain('textAlign: &quot;center&quot;, marginTop: &quot;50px&quot; }}');
    expect(plain).toContain('onClick={() =&gt; toggle(i)} style={{');
  });

  it('XML-escapes special characters and converts newlines to <w:br/>', async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{{CourseTitle}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{Address}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const filled = await fillDocxTemplate(makeDocx(docXml), {
      CourseTitle: 'Data Structures & <Algorithms> "2026"',
      Address: 'Line 1\nLine 2',
    });

    const outXml = new PizZip(filled).file('word/document.xml')!.asText();
    expect(outXml).toContain('Data Structures &amp; &lt;Algorithms&gt; &quot;2026&quot;');
    expect(outXml).toContain('Line 1</w:t><w:br/><w:t xml:space="preserve">Line 2');
  });

  it('fills placeholders in headers and footers as well as document body', async () => {
    const docXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{Name}}</w:t></w:r></w:p></w:body></w:document>`;
    const headerXml = `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Roll: {{RollNo}}</w:t></w:r></w:p></w:hdr>`;
    const footerXml = `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Guide: {{Assistant Professor}}</w:t></w:r></w:p></w:ftr>`;

    const input = makeDocx(docXml, {
      'word/header1.xml': headerXml,
      'word/footer1.xml': footerXml,
    });

    const filled = await fillDocxTemplate(input, {
      Name: 'Aditya',
      RollNo: '220111075',
      'Assistant Professor': 'Dr. Sharma',
    });

    expect(readPlainText(filled, 'word/document.xml')).toBe('Aditya');
    expect(readPlainText(filled, 'word/header1.xml')).toBe('Roll: 220111075');
    expect(readPlainText(filled, 'word/footer1.xml')).toBe('Guide: Dr. Sharma');
  });

  it('extractPlaceholders finds split tags across body/headers and ignores JSX code', async () => {
    const docXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>{</w:t></w:r><w:r><w:t>{Name}}</w:t></w:r></w:p>
      <w:p><w:r><w:t>{</w:t></w:r><w:r><w:t>{Assistant Professor}}</w:t></w:r></w:p>
      <w:p><w:r><w:t>&lt;div style={{ textAlign: &quot;center&quot; }}&gt;</w:t></w:r></w:p>
    </w:body></w:document>`;
    const headerXml = `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>{{RollNo}}</w:t></w:r></w:p></w:hdr>`;

    const placeholders = await extractPlaceholders(makeDocx(docXml, { 'word/header1.xml': headerXml }));
    expect(placeholders).toEqual(['Name', 'Assistant Professor', 'RollNo']);
  });

  it('rejects empty or non-ZIP buffers', async () => {
    await expect(fillDocxTemplate(Buffer.alloc(0), { Name: 'A' })).rejects.toThrow(/empty/);
    await expect(fillDocxTemplate(Buffer.from('not a docx'), { Name: 'A' })).rejects.toThrow(/valid ZIP\/DOCX/);
  });
});

