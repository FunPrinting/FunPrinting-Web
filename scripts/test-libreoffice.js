const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Test LibreOffice CLI integration
async function testLibreOffice() {
  console.log('🧪 Testing LibreOffice CLI Integration...\n');

  try {
    // Test 1: Check if LibreOffice is available
    console.log('1️⃣ Checking LibreOffice CLI availability...');
    
    try {
      const { stdout } = await execAsync('soffice --version');
      console.log('✅ LibreOffice CLI is available');
      console.log('   Version:', stdout.trim());
    } catch (error) {
      console.log('❌ LibreOffice CLI is not available');
      console.log('   Please install LibreOffice: brew install --cask libreoffice');
      console.log('   Error:', error.message);
      return;
    }

    // Test 2: Test with a simple PDF
    console.log('\n2️⃣ Testing PDF conversion...');
    
    // Create a simple PDF buffer for testing
    const simplePdf = Buffer.from(`%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Hello World @testPlaceholder) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
297
%%EOF`);

    // Create temporary files
    const tempDir = path.join(__dirname, '..', 'temp');
    const pdfId = Date.now().toString();
    const pdfPath = path.join(tempDir, `${pdfId}.pdf`);
    const docxPath = path.join(tempDir, `${pdfId}.docx`);

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      // Write PDF buffer to temporary file
      fs.writeFileSync(pdfPath, simplePdf);
      console.log('📄 Created test PDF:', pdfPath);

      // Convert PDF to DOCX using LibreOffice CLI
      console.log('🔄 Converting PDF to DOCX...');
      const command = `soffice --headless --convert-to docx --outdir "${tempDir}" "${pdfPath}"`;
      console.log('   Command:', command);

      const { stdout, stderr } = await execAsync(command);

      if (stderr && !stderr.includes('Warning')) {
        console.log('⚠️  LibreOffice stderr:', stderr);
      }

      console.log('   LibreOffice stdout:', stdout);

      // Check if DOCX file was created
      if (fs.existsSync(docxPath)) {
        const docxBuffer = fs.readFileSync(docxPath);
        console.log('✅ PDF to DOCX conversion successful');
        console.log('   PDF size:', simplePdf.length, 'bytes');
        console.log('   DOCX size:', docxBuffer.length, 'bytes');
        
        // Test DOCX to PDF conversion
        console.log('\n3️⃣ Testing DOCX to PDF conversion...');
        const pdfPath2 = path.join(tempDir, `${pdfId}_converted.pdf`);
        
        const convertCommand = `soffice --headless --convert-to pdf --outdir "${tempDir}" "${docxPath}"`;
        console.log('   Command:', convertCommand);

        const { stdout: convertStdout, stderr: convertStderr } = await execAsync(convertCommand);

        if (convertStderr && !convertStderr.includes('Warning')) {
          console.log('⚠️  LibreOffice stderr:', convertStderr);
        }

        console.log('   LibreOffice stdout:', convertStdout);

        // Check if PDF file was created
        if (fs.existsSync(pdfPath2)) {
          const pdfBuffer2 = fs.readFileSync(pdfPath2);
          console.log('✅ DOCX to PDF conversion successful');
          console.log('   Generated PDF size:', pdfBuffer2.length, 'bytes');
        } else {
          console.log('❌ DOCX to PDF conversion failed - no output file created');
        }
      } else {
        console.log('❌ PDF to DOCX conversion failed - no output file created');
      }

    } finally {
      // Clean up temporary files
      try {
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        if (fs.existsSync(docxPath)) fs.unlinkSync(docxPath);
        if (fs.existsSync(path.join(tempDir, `${pdfId}_converted.pdf`))) {
          fs.unlinkSync(path.join(tempDir, `${pdfId}_converted.pdf`));
        }
        console.log('🧹 Cleaned up temporary files');
      } catch (cleanupError) {
        console.warn('⚠️  Warning: Could not clean up temporary files:', cleanupError.message);
      }
    }

    console.log('\n🎉 LibreOffice CLI integration test completed!');
    console.log('\n📋 Next steps:');
    console.log('1. Test the full integration: npm run test-integration');
    console.log('2. Test the conversion API: npm run dev');
    console.log('3. Test in browser: http://localhost:3000/templates/create');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  testLibreOffice();
}

module.exports = { testLibreOffice };
