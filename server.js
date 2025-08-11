const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const compression = require('compression');
const archiver = require('archiver');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Enable gzip compression
app.use(compression());

// Add security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Ensure directories exist
const uploadDir = 'uploads';
const outputDir = 'converted';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// IMPORTANT: Serve converted files for download
app.use('/downloads', express.static(path.join(__dirname, 'converted'), {
  maxAge: '2h'
}));

// Helper function for file conversion
async function processFileConversion(inputFile, outputFile, targetFormat, fileInfo) {
  return new Promise((resolve, reject) => {
    // Special handling for PDF
    if (targetFormat === 'pdf') {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(outputFile);
      doc.pipe(stream);
      doc.image(inputFile, { fit: [500, 500], align: 'center', valign: 'center' });
      doc.end();
      stream.on('finish', () => {
        fs.unlinkSync(inputFile);
        resolve();
      });
      stream.on('error', reject);
      return;
    }

    // Use Sharp for common formats
    const supportedBySharp = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'avif'];
    
    if (supportedBySharp.includes(targetFormat)) {
      processWithSharp();
    } else {
      // Try ImageMagick for other formats
      useImageMagick();
    }
    
    async function processWithSharp() {
      try {
        let sharpInstance = sharp(inputFile);
        
        switch (targetFormat) {
          case 'jpg':
          case 'jpeg':
            await sharpInstance.jpeg({ quality: 90, progressive: true }).toFile(outputFile);
            break;
          case 'png':
            await sharpInstance.png({ compressionLevel: 6, progressive: true }).toFile(outputFile);
            break;
          case 'webp':
            await sharpInstance.webp({ quality: 90, lossless: false }).toFile(outputFile);
            break;
          case 'tiff':
          case 'tif':
            await sharpInstance.tiff({ compression: 'lzw' }).toFile(outputFile);
            break;
          case 'avif':
            await sharpInstance.avif({ quality: 90 }).toFile(outputFile);
            break;
          case 'gif':
            // Sharp doesn't support GIF output well, convert to PNG
            await sharpInstance.png().toFile(outputFile);
            break;
          default:
            await sharpInstance.toFile(outputFile);
        }
        
        fs.unlinkSync(inputFile);
        resolve();
      } catch (sharpError) {
        console.error('Sharp conversion error:', sharpError);
        useImageMagick();
      }
    }
    
    function useImageMagick() {
      const command = `magick "${inputFile}" "${outputFile}"`;
      exec(command, (error) => {
        fs.unlinkSync(inputFile);
        
        if (error) {
          console.error('ImageMagick conversion error:', error);
          return reject(new Error(`Conversion to ${targetFormat} failed. Make sure ImageMagick is installed for this format.`));
        }
        resolve();
      });
    }
  });
}

// Single file conversion endpoint
app.post('/api/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const inputFile = req.file.path;
  const targetFormat = req.body.targetFormat.toLowerCase();
  const outputFileName = `output-${Date.now()}.${targetFormat}`;
  const outputFile = path.join(outputDir, outputFileName);

  try {
    await processFileConversion(inputFile, outputFile, targetFormat, req.file);
    res.json({ downloadUrl: `/downloads/${outputFileName}` });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).send('Conversion failed: ' + error.message);
  }
});

// Batch conversion endpoint
app.post('/api/convert-batch', upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const targetFormat = req.body.targetFormat.toLowerCase();
  const results = [];
  const errors = [];

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const inputFile = file.path;
    const outputFileName = `batch-${Date.now()}-${i + 1}.${targetFormat}`;
    const outputFile = path.join(outputDir, outputFileName);

    try {
      await processFileConversion(inputFile, outputFile, targetFormat, file);
      results.push({
        originalName: file.originalname,
        downloadUrl: `/downloads/${outputFileName}`,
        status: 'success'
      });
    } catch (error) {
      console.error(`Batch conversion error for ${file.originalname}:`, error);
      errors.push({
        originalName: file.originalname,
        error: error.message,
        status: 'failed'
      });
    }
  }

  res.json({
    success: results,
    errors: errors,
    total: req.files.length,
    successful: results.length
  });
});

// ZIP download endpoint for batch files
app.post('/api/download-batch-zip', async (req, res) => {
  const { fileUrls, zipName } = req.body;
  const zipFileName = `${zipName}.zip`;
  const zipPath = path.join(outputDir, zipFileName);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    res.json({ downloadUrl: `/downloads/${zipFileName}` });
  });

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    res.status(500).send('Failed to create ZIP file');
  });

  archive.pipe(output);

  // Add files to archive
  fileUrls.forEach((url, index) => {
    const fileName = url.split('/').pop();
    const filePath = path.join(outputDir, fileName);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: `converted-${index + 1}.${fileName.split('.').pop()}` });
    }
  });

  archive.finalize();
});

// Serve other static pages
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});

app.get('/terms.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms.html'));
});

app.get('/contact.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'contact.html'));
});

// Cleanup old files every hour
setInterval(() => {
  const now = Date.now();
  const maxAge = 2 * 60 * 60 * 1000; // 2 hours
  
  [uploadDir, outputDir].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((file) => {
        const filePath = path.join(dir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up old file: ${file}`);
          }
        } catch (error) {
          console.error(`Error cleaning up file ${file}:`, error);
        }
      });
    }
  });
}, 60 * 60 * 1000);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Image Converter running on port ${PORT}`);
  console.log(`📍 Visit http://localhost:${PORT} to start converting images`);
  console.log(`\n✅ Real image conversion enabled with Sharp!`);
  console.log(`📁 Converted files will be saved in: ${path.join(__dirname, 'converted')}`);
});