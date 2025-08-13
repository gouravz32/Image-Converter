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
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 20 // Maximum 20 files for batch
  }
});

app.use(compression());
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Ensure directories exist
const uploadDir = 'uploads';
const outputDir = 'converted';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Serve converted files
app.use('/downloads', express.static(path.join(__dirname, 'converted'), {
  maxAge: '2h',
  setHeaders: (res, path) => {
    res.setHeader('Content-Disposition', 'attachment');
  }
}));

// Check ImageMagick installation
let imageMagickAvailable = false;
let imageMagickCommand = 'magick'; // Default to newer syntax

async function checkImageMagick() {
  try {
    // Try newer ImageMagick syntax
    await execPromise('magick -version');
    imageMagickAvailable = true;
    imageMagickCommand = 'magick';
    console.log('✅ ImageMagick 7.x found');
  } catch (error) {
    try {
      // Try older ImageMagick syntax
      await execPromise('convert -version');
      imageMagickAvailable = true;
      imageMagickCommand = 'convert';
      console.log('✅ ImageMagick 6.x found (using convert command)');
    } catch (error2) {
      console.warn('⚠️ ImageMagick not found! Some conversions may fail.');
      console.warn('  Sharp will handle common formats (JPG, PNG, WEBP)');
    }
  }
  
  // Check for potrace (needed for SVG)
  try {
    await execPromise('potrace -v');
    console.log('✅ Potrace found (SVG conversion supported)');
  } catch (error) {
    console.warn('⚠️ Potrace not found! SVG conversion may not work properly.');
  }
}

// Initialize checks
checkImageMagick();

// Check supported formats
async function checkImageMagickSupport() {
  if (!imageMagickAvailable) return {};
  
  try {
    const { stdout } = await execPromise(`${imageMagickCommand} -list format`);
    const formats = stdout.toLowerCase();
    return {
      heif: formats.includes('heif'),
      heic: formats.includes('heic'),
      svg: formats.includes('svg'),
      eps: formats.includes('eps'),
      psd: formats.includes('psd'),
      djvu: formats.includes('djvu'),
      ico: formats.includes('ico'),
      potrace: formats.includes('potrace')
    };
  } catch (error) {
    console.error('Could not check ImageMagick support:', error.message);
    return {};
  }
}

// Initialize supported formats
let supportedFormats = {};
checkImageMagickSupport().then(formats => {
  supportedFormats = formats;
  console.log('ImageMagick format support:', supportedFormats);
});

// Enhanced conversion function
async function processFileConversion(inputFile, outputFile, targetFormat, fileInfo) {
  targetFormat = targetFormat.toLowerCase();
  
  // Validate input file exists
  if (!fs.existsSync(inputFile)) {
    throw new Error('Input file not found');
  }
  
  // Pre-process exotic formats
  let processedInput = inputFile;
  const inputExt = path.extname(fileInfo.originalname).toLowerCase().slice(1);
  
  // List of formats that need pre-processing
  const needsPreprocessing = ['heif', 'heic', 'psd', 'xcf', 'cdr', 'djvu'];
  
  if (needsPreprocessing.includes(inputExt) && targetFormat !== inputExt) {
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
          if (!imageMagickAvailable) {
            throw new Error(`Format ${targetFormat} requires ImageMagick which is not available`);
          }
        }
      }

      // Use ImageMagick for everything else
      if (!imageMagickAvailable) {
        throw new Error(`Format ${targetFormat} requires ImageMagick which is not installed`);
      }
      
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
  if (!imageMagickAvailable) {
    throw new Error('ImageMagick is required for this format');
  }
  
  let command = '';
  
  switch (inputFormat) {
    case 'heif':
    case 'heic':
      command = `${imageMagickCommand} "${input}" "${output}"`;
      break;
    case 'psd':
      command = `${imageMagickCommand} "${input}[0]" -flatten "${output}"`;
      break;
    case 'xcf':
      command = `${imageMagickCommand} "${input}" -flatten "${output}"`;
      break;
    case 'djvu':
      command = `${imageMagickCommand} "${input}" "${output}"`;
      break;
    case 'cdr':
      command = `${imageMagickCommand} "${input}" "${output}"`;
      break;
    default:
      command = `${imageMagickCommand} "${input}" "${output}"`;
  }
  
  const { stdout, stderr } = await execPromise(command);
  if (stderr && !stderr.includes('Warning')) {
    throw new Error(stderr);
  }
}

// Sharp processing
async function processWithSharp(input, output, format) {
  let sharpInstance = sharp(input);

  // Get image metadata for better processing
  const metadata = await sharpInstance.metadata();
  
  switch (format) {
    case 'jpg':
    case 'jpeg':
      await sharpInstance
        .jpeg({ 
          quality: 90, 
          progressive: true,
          mozjpeg: true 
        })
        .toFile(output);
      break;
      
    case 'png':
      await sharpInstance
        .png({ 
          compressionLevel: 6, 
          progressive: true,
          palette: metadata.channels === 3 
        })
        .toFile(output);
      break;
      
    case 'webp':
      await sharpInstance
        .webp({ 
          quality: 90,
          lossless: false,
          nearLossless: false,
          smartSubsample: true,
          effort: 4
        })
        .toFile(output);
      break;
      
    case 'tiff':
    case 'tif':
      await sharpInstance
        .tiff({ 
          compression: 'lzw',
          predictor: 'horizontal' 
        })
        .toFile(output);
      break;
      
    case 'avif':
      await sharpInstance
        .avif({ 
          quality: 80,
          lossless: false,
          effort: 4
        })
        .toFile(output);
      break;
      
    case 'gif':
      // Sharp doesn't support GIF output well, convert to PNG and rename
      const tempPath = output.replace('.gif', '_temp.png');
      await sharpInstance.png().toFile(tempPath);
      fs.renameSync(tempPath, output);
      break;
      
    default:
      await sharpInstance.toFile(output);
  }
}

// Enhanced ImageMagick processing
async function processWithImageMagick(input, output, format) {
  let command = '';
  const inputExt = path.extname(input).toLowerCase();
  
  switch (format) {
    case 'ico':
      // ICO with multiple resolutions
      command = `${imageMagickCommand} "${input}" -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 "${output}"`;
      break;
      
    case 'svg':
      // Enhanced SVG conversion with smart detection
      if (['.svg', '.eps', '.ai', '.pdf'].includes(inputExt)) {
        // Vector to vector conversion
        command = `${imageMagickCommand} "${input}" "${output}"`;
      } else {
        // Raster to vector conversion
        console.log('Converting raster image to SVG vector format...');
        
        // Try Option 1: Direct potrace for better quality
        const pbmTemp = input + '.pbm';
        const pgmTemp = input + '.pgm';
        
        try {
          // First try with PGM for grayscale
          await execPromise(`${imageMagickCommand} "${input}" -colorspace Gray -threshold 50% "${pgmTemp}"`);
          
          // Use potrace to create SVG
          await execPromise(`potrace -s "${pgmTemp}" -o "${output}"`);
          
          // Clean up temp files
          if (fs.existsSync(pgmTemp)) fs.unlinkSync(pgmTemp);
          
          console.log('SVG conversion successful using potrace');
          return;
        } catch (potraceError) {
          console.log('Potrace with PGM failed, trying PBM...');
          
          try {
            // Try with PBM for black and white
            await execPromise(`${imageMagickCommand} "${input}" -monochrome "${pbmTemp}"`);
            await execPromise(`potrace -s "${pbmTemp}" -o "${output}"`);
            
            if (fs.existsSync(pbmTemp)) fs.unlinkSync(pbmTemp);
            console.log('SVG conversion successful using potrace with PBM');
            return;
          } catch (pbmError) {
            console.log('Potrace failed completely, using ImageMagick fallback...');
            
            // Final fallback to ImageMagick
            command = `${imageMagickCommand} "${input}" "${output}"`;
          }
        }
      }
      break;
      
    case 'eps':
    case 'ai':
      // PostScript formats
      command = `${imageMagickCommand} "${input}" -compress lzw "${output}"`;
      break;
      
    case 'heif':
    case 'heic':
      // HEIF/HEIC formats
      command = `${imageMagickCommand} "${input}" -quality 90 "${output}"`;
      break;
      
    case 'psd':
      // Photoshop format
      command = `${imageMagickCommand} "${input}" -compress rle "${output}"`;
      break;
      
    case 'xcf':
      // GIMP format - very limited write support
      command = `${imageMagickCommand} "${input}" "${output}"`;
      break;
      
    case 'djvu':
      // DJVU - very limited support
      command = `${imageMagickCommand} "${input}" "${output}"`;
      break;
      
    case 'cdr':
      // CorelDRAW - very limited support
      command = `${imageMagickCommand} "${input}" "${output}"`;
      break;
      
    case 'bmp':
      command = `${imageMagickCommand} "${input}" -type TrueColor -compress none "${output}"`;
      break;
      
    default:
      command = `${imageMagickCommand} "${input}" -quality 90 "${output}"`;
  }

  try {
    console.log('Executing:', command);
    const { stdout, stderr } = await execPromise(command);
    
    // Check if output file was created
    if (!fs.existsSync(output)) {
      throw new Error(`Output file was not created. Format ${format} might not be supported for writing.`);
    }
    
    // Check file size
    const stats = fs.statSync(output);
    if (stats.size === 0) {
      throw new Error(`Output file is empty. Conversion to ${format} may have failed.`);
    }
    
    console.log('Conversion successful');
  } catch (error) {
    console.error('ImageMagick error:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('no encode delegate')) {
      throw new Error(`Format ${format.toUpperCase()} is not supported for writing. Try converting to JPG, PNG, or PDF instead.`);
    } else if (error.message.includes('no decode delegate')) {
      throw new Error(`Cannot read the input file format. Make sure the file is a valid image.`);
    } else if (format === 'svg' && (error.message.includes('potrace') || error.message.includes('not found'))) {
      throw new Error(`SVG conversion requires potrace to be installed. For now, try converting simple black and white images only.`);
    } else if (error.message.includes('memory') || error.message.includes('cache')) {
      throw new Error(`File too large or complex for processing. Try a smaller image or simpler format.`);
    } else {
      throw error;
    }
  }
}

// PDF conversion
async function convertToPDF(input, output) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const stream = fs.createWriteStream(output);
  doc.pipe(stream);
  
  try {
    // Get image dimensions
    const metadata = await sharp(input).metadata();
    const width = metadata.width;
    const height = metadata.height;
    
    // Add page with appropriate size
    doc.addPage({ size: [width, height] });
    
    // Add image to fill the page
    doc.image(input, 0, 0, { width: width, height: height });
  } catch (error) {
    // If Sharp can't read it, try with default sizing
    doc.addPage();
    try {
      doc.image(input, { 
        fit: [500, 700], 
        align: 'center', 
        valign: 'center' 
      });
    } catch (pdfError) {
      // If PDFKit can't read the image, try converting to PNG first
      const tempPng = input + '_pdf_temp.png';
      
      if (imageMagickAvailable) {
        await execPromise(`${imageMagickCommand} "${input}" "${tempPng}"`);
        doc.image(tempPng, { 
          fit: [500, 700], 
          align: 'center', 
          valign: 'center' 
        });
        if (fs.existsSync(tempPng)) {
          fs.unlinkSync(tempPng);
        }
      } else {
        throw new Error('Cannot convert this image to PDF');
      }
    }
  }
  
  doc.end();
  
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// Cleanup temporary files
function cleanup(originalFile, processedFile) {
  try {
    if (fs.existsSync(originalFile)) {
      fs.unlinkSync(originalFile);
    }
    if (processedFile !== originalFile && fs.existsSync(processedFile)) {
      fs.unlinkSync(processedFile);
    }
    
    // Clean up any other temp files
    const tempExtensions = ['.pbm', '.pgm', '_temp.png', '_pdf_temp.png'];
    tempExtensions.forEach(ext => {
      const tempFile = originalFile + ext;
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
  } catch (error) {
    console.error('Cleanup error:', error.message);
  }
}

// Single file conversion endpoint
app.post('/api/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const inputFile = req.file.path;
  const targetFormat = req.body.targetFormat?.toLowerCase();
  
  if (!targetFormat) {
    fs.unlinkSync(inputFile);
    return res.status(400).send('No target format specified');
  }
  
  const outputFileName = `output-${Date.now()}.${targetFormat}`;
  const outputFile = path.join(outputDir, outputFileName);

  // Check for formats with known issues
  const limitedFormats = ['xcf', 'cdr', 'djvu'];
  if (limitedFormats.includes(targetFormat)) {
    console.warn(`Warning: ${targetFormat.toUpperCase()} has limited support`);
  }

  try {
    await processFileConversion(inputFile, outputFile, targetFormat, req.file);
    
    // Verify output exists and has content
    if (!fs.existsSync(outputFile)) {
      throw new Error('Conversion failed - no output file created');
    }
    
    const stats = fs.statSync(outputFile);
    if (stats.size === 0) {
      throw new Error('Conversion failed - output file is empty');
    }
    
    res.json({ downloadUrl: `/downloads/${outputFileName}` });
  } catch (error) {
    console.error('Conversion error:', error);
    
    // Clean up any partial output
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
    
    // User-friendly error messages
    let errorMessage = error.message;
    
    if (errorMessage.includes('not installed') || errorMessage.includes('not found')) {
      errorMessage = `This format requires additional software that is not available. Please try converting to JPG, PNG, or PDF.`;
    } else if (errorMessage.includes('SVG')) {
      errorMessage = `SVG conversion works best with simple graphics. Complex images may not convert well. Try converting logos or simple icons instead.`;
    }
    
    res.status(500).send(errorMessage);
  }
});

// Batch conversion endpoint
app.post('/api/convert-batch', upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const targetFormat = req.body.targetFormat?.toLowerCase();
  
  if (!targetFormat) {
    req.files.forEach(file => fs.unlinkSync(file.path));
    return res.status(400).json({ error: 'No target format specified' });
  }
  
  const results = [];
  const errors = [];

  // Process files sequentially to avoid overload
  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const inputFile = file.path;
    const outputFileName = `batch-${Date.now()}-${i + 1}.${targetFormat}`;
    const outputFile = path.join(outputDir, outputFileName);

    try {
      await processFileConversion(inputFile, outputFile, targetFormat, file);
      
      // Verify output
      if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0) {
        results.push({
          originalName: file.originalname,
          downloadUrl: `/downloads/${outputFileName}`,
          status: 'success'
        });
      } else {
        throw new Error('Output file is invalid');
      }
    } catch (error) {
      console.error(`Batch conversion error for ${file.originalname}:`, error);
      errors.push({
        originalName: file.originalname,
        error: error.message.substring(0, 100), // Limit error message length
        status: 'failed'
      });
      
      // Clean up failed output
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
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
  
  if (!fileUrls || !Array.isArray(fileUrls) || fileUrls.length === 0) {
    return res.status(400).json({ error: 'No files to zip' });
  }
  
  const zipFileName = `${zipName || 'batch-' + Date.now()}.zip`;
  const zipPath = path.join(outputDir, zipFileName);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { 
    zlib: { level: 9 } // Maximum compression
  });

  output.on('close', () => {
    console.log(`ZIP created: ${archive.pointer()} bytes`);
    res.json({ downloadUrl: `/downloads/${zipFileName}` });
  });

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    res.status(500).json({ error: 'Failed to create ZIP file' });
  });

  archive.pipe(output);

  // Add files to ZIP
  let fileCount = 0;
  fileUrls.forEach((url, index) => {
    const fileName = url.split('/').pop();
    const filePath = path.join(outputDir, fileName);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(fileName);
      archive.file(filePath, { name: `converted-${index + 1}${ext}` });
      fileCount++;
    }
  });

  if (fileCount === 0) {
    archive.abort();
    return res.status(400).json({ error: 'No valid files found to zip' });
  }

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

// Robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /uploads/
Disallow: /converted/
Crawl-delay: 1

Sitemap: https://snap2format.com/sitemap.xml`);
});

// Sitemap
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://snap2format.com/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://snap2format.com/about.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://snap2format.com/privacy.html</loc>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://snap2format.com/terms.html</loc>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://snap2format.com/contact.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    imageMagick: imageMagickAvailable,
    supportedFormats: supportedFormats,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal Server Error');
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
          console.error(`Error cleaning up file ${file}:`, error.message);
        }
      });
    }
  });
}, 60 * 60 * 1000); // Run every hour

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Snap2Format Image Converter running on port ${PORT}`);
  console.log(`📍 Visit http://localhost:${PORT} to start converting images`);
  console.log(`\n⚠️  Note: Some formats have limitations:`);
  console.log(`   - SVG works best with simple graphics`);
  console.log(`   - DJVU, XCF, CDR have limited support`);
  console.log(`   - HEIF/HEIC need additional libraries`);
  console.log(`\n💡 For best results, convert TO common formats like JPG, PNG, PDF, WEBP`);
});