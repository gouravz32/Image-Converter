const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const compression = require('compression');
const archiver = require('archiver');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(compression());
app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

const uploadDir = 'uploads';
const outputDir = 'converted';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

app.use('/downloads', express.static(path.join(__dirname, 'converted'), {
  maxAge: '2h'
}));

// Check ImageMagick delegates
async function checkImageMagickSupport() {
  try {
    const { stdout } = await execPromise('magick -list format');
    const formats = stdout.toLowerCase();
    return {
      heif: formats.includes('heif'),
      heic: formats.includes('heic'),
      svg: formats.includes('svg'),
      eps: formats.includes('eps'),
      psd: formats.includes('psd'),
      djvu: formats.includes('djvu'),
      ico: formats.includes('ico')
    };
  } catch (error) {
    console.error('Could not check ImageMagick support:', error);
    return {};
  }
}

// Initialize and check supported formats
let supportedFormats = {};
checkImageMagickSupport().then(formats => {
  supportedFormats = formats;
  console.log('ImageMagick format support:', supportedFormats);
});

// Enhanced conversion function
async function processFileConversion(inputFile, outputFile, targetFormat, fileInfo) {
  targetFormat = targetFormat.toLowerCase();
  
  // First, try to convert input to a standard format if it's exotic
  let processedInput = inputFile;
  const inputExt = path.extname(fileInfo.originalname).toLowerCase().slice(1);
  
  // List of formats that need pre-processing
  const needsPreprocessing = ['heif', 'heic', 'psd', 'xcf', 'cdr', 'djvu'];
  
  if (needsPreprocessing.includes(inputExt)) {
    console.log(`Pre-processing ${inputExt} to PNG first...`);
    const tempFile = inputFile + '_temp.png';
    try {
      await convertToIntermediateFormat(inputFile, tempFile, inputExt);
      processedInput = tempFile;
    } catch (error) {
      console.log('Pre-processing failed, trying direct conversion...');
    }
  }

  return new Promise(async (resolve, reject) => {
    try {
      // PDF handling
      if (targetFormat === 'pdf') {
        await convertToPDF(processedInput, outputFile);
        cleanup(inputFile, processedInput);
        resolve();
        return;
      }

      // Try Sharp first for supported formats
      const sharpFormats = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'avif'];
      
      if (sharpFormats.includes(targetFormat)) {
        try {
          await processWithSharp(processedInput, outputFile, targetFormat);
          cleanup(inputFile, processedInput);
          resolve();
          return;
        } catch (sharpError) {
          console.log('Sharp failed, trying ImageMagick...');
        }
      }

      // Use ImageMagick for everything else
      await processWithImageMagick(processedInput, outputFile, targetFormat);
      cleanup(inputFile, processedInput);
      resolve();
      
    } catch (error) {
      cleanup(inputFile, processedInput);
      reject(error);
    }
  });
}

// Convert exotic formats to intermediate PNG
async function convertToIntermediateFormat(input, output, inputFormat) {
  let command = '';
  
  switch (inputFormat) {
    case 'heif':
    case 'heic':
      // Try multiple methods for HEIF/HEIC
      command = `magick "${input}" "${output}" || magick convert "${input}" "${output}"`;
      break;
    case 'psd':
      command = `magick "${input}[0]" -flatten "${output}"`;
      break;
    case 'xcf':
      command = `magick "${input}" -flatten "${output}"`;
      break;
    case 'djvu':
      // DJVU might need special handling
      command = `magick "${input}" "${output}"`;
      break;
    case 'cdr':
      // CDR has very limited support
      command = `magick "${input}" "${output}"`;
      break;
    default:
      command = `magick "${input}" "${output}"`;
  }
  
  const { stdout, stderr } = await execPromise(command);
  if (stderr && !stderr.includes('Warning')) {
    throw new Error(stderr);
  }
}

// Sharp processing
async function processWithSharp(input, output, format) {
  let sharpInstance = sharp(input);

  switch (format) {
    case 'jpg':
    case 'jpeg':
      await sharpInstance.jpeg({ quality: 90, progressive: true }).toFile(output);
      break;
    case 'png':
      await sharpInstance.png({ compressionLevel: 6, progressive: true }).toFile(output);
      break;
    case 'webp':
      await sharpInstance.webp({ quality: 90 }).toFile(output);
      break;
    case 'tiff':
    case 'tif':
      await sharpInstance.tiff({ compression: 'lzw' }).toFile(output);
      break;
    case 'avif':
      await sharpInstance.avif({ quality: 90 }).toFile(output);
      break;
    case 'gif':
      // Convert to PNG first, then rename
      const tempPath = output.replace('.gif', '_temp.png');
      await sharpInstance.png().toFile(tempPath);
      fs.renameSync(tempPath, output);
      break;
    default:
      await sharpInstance.toFile(output);
  }
}

// ImageMagick processing with better error handling
async function processWithImageMagick(input, output, format) {
  let command = '';
  
  // Build format-specific commands
  switch (format) {
    case 'ico':
      // ICO with multiple resolutions
      command = `magick "${input}" -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 "${output}"`;
      break;
      
    case 'svg':
      // Convert to SVG (limited support for raster to vector)
      command = `magick "${input}" "${output}"`;
      break;
      
    case 'eps':
    case 'ai':
      // PostScript formats
      command = `magick "${input}" -compress lzw "${output}"`;
      break;
      
    case 'heif':
    case 'heic':
      // HEIF/HEIC - might need special handling
      command = `magick "${input}" -quality 90 "${output}"`;
      break;
      
    case 'psd':
      // Photoshop format
      command = `magick "${input}" "${output}"`;
      break;
      
    case 'xcf':
      // GIMP format - very limited write support
      command = `magick "${input}" "${output}"`;
      break;
      
      
    case 'djvu':
      // DJVU - very limited support
      command = `magick "${input}" "${output}"`;
      break;
      
    case 'cdr':
      // CorelDRAW - very limited support
      command = `magick "${input}" "${output}"`;
      break;
      
    case 'bmp':
      command = `magick "${input}" -compress none "${output}"`;
      break;
      
    default:
      command = `magick "${input}" -quality 90 "${output}"`;
  }

  try {
    console.log('Executing:', command);
    const { stdout, stderr } = await execPromise(command);
    
    // Check if output file was created
    if (!fs.existsSync(output)) {
      throw new Error(`Output file was not created. Format ${format} might not be supported for writing.`);
    }
    
    console.log('Conversion successful');
  } catch (error) {
    console.error('ImageMagick error:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('no encode delegate')) {
      throw new Error(`Format ${format.toUpperCase()} is not supported for writing. This format requires additional libraries that are not installed. Try converting to a common format like JPG, PNG, or PDF.`);
    } else if (error.message.includes('no decode delegate')) {
      throw new Error(`Cannot read the input file format. Make sure the file is a valid image.`);
    } else {
      throw error;
    }
  }
}

// PDF conversion
async function convertToPDF(input, output) {
  const doc = new PDFDocument();
  const stream = fs.createWriteStream(output);
  doc.pipe(stream);
  
  try {
    doc.image(input, { 
      fit: [500, 500], 
      align: 'center', 
      valign: 'center' 
    });
  } catch (error) {
    // If PDFKit can't read the image, try converting to PNG first
    const tempPng = input + '_pdf_temp.png';
    await execPromise(`magick "${input}" "${tempPng}"`);
    doc.image(tempPng, { 
      fit: [500, 500], 
      align: 'center', 
      valign: 'center' 
    });
    if (fs.existsSync(tempPng)) {
      fs.unlinkSync(tempPng);
    }
  }
  
  doc.end();
  
  return new Promise((resolve) => {
    stream.on('finish', resolve);
  });
}

// Cleanup temporary files
function cleanup(originalFile, processedFile) {
  if (fs.existsSync(originalFile)) {
    fs.unlinkSync(originalFile);
  }
  if (processedFile !== originalFile && fs.existsSync(processedFile)) {
    fs.unlinkSync(processedFile);
  }
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

  // Check for read-only formats
  const readOnlyFormats = [];
  if (readOnlyFormats.includes(targetFormat)) {
    fs.unlinkSync(inputFile);
    return res.status(400).send(`Cannot convert TO ${targetFormat.toUpperCase()} format. This format is typically read-only. Try converting FROM ${targetFormat.toUpperCase()} to JPG, PNG, or TIFF instead.`);
  }

  // Provide warnings for limited support formats
  const limitedFormats = ['xcf', 'cdr', 'djvu'];
  if (limitedFormats.includes(targetFormat)) {
    console.warn(`Warning: ${targetFormat.toUpperCase()} has limited support and may not work properly.`);
  }

  try {
    await processFileConversion(inputFile, outputFile, targetFormat, req.file);
    res.json({ downloadUrl: `/downloads/${outputFileName}` });
  } catch (error) {
    console.error('Conversion error:', error);
    
    // Provide user-friendly error messages
    let errorMessage = error.message;
    if (errorMessage.includes('no encode delegate')) {
      errorMessage = `Format ${targetFormat.toUpperCase()} is not supported for conversion. This format requires additional software that is not installed. Please try converting to JPG, PNG, PDF, or another common format.`;
    }
    
    res.status(500).send('Conversion failed: ' + errorMessage);
  }
});

// Batch conversion endpoint
app.post('/api/convert-batch', upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const targetFormat = req.body.targetFormat.toLowerCase();
  
  // Check for read-only formats
  const readOnlyFormats = [];
  if (readOnlyFormats.includes(targetFormat)) {
    req.files.forEach(file => fs.unlinkSync(file.path));
    return res.status(400).json({ 
      error: `Cannot convert TO ${targetFormat.toUpperCase()} format. This format is read-only.` 
    });
  }

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

// ZIP download endpoint
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

  fileUrls.forEach((url, index) => {
    const fileName = url.split('/').pop();
    const filePath = path.join(outputDir, fileName);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: `converted-${index + 1}.${fileName.split('.').pop()}` });
    }
  });

  archive.finalize();
});

// Static pages routes
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    supportedFormats: supportedFormats,
    timestamp: new Date().toISOString() 
  });
});

// Cleanup old files
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Snap2Format Image Converter running on port ${PORT}`);
  console.log(`📍 Visit http://localhost:${PORT} to start converting images`);
  console.log(`\n⚠️  Note: Some formats have limitations:`);
  console.log(`   - DJVU, XCF, CDR have limited support`);
  console.log(`   - HEIF/HEIC need additional libraries`);
  console.log(`\n💡 For best results, convert TO common formats like JPG, PNG, PDF, WEBP`);
});
