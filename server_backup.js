const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const compression = require('compression'); // Add compression for better performance
const archiver = require('archiver'); // For creating ZIP files

const app = express();
const upload = multer({ dest: 'uploads/' });

// Enable gzip compression for better SEO and performance
app.use(compression());

// Add security headers for better SEO and security
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

// Serve static files with proper caching headers
app.use('/downloads', express.static(path.join(__dirname, 'converted'), {
  maxAge: '2h' // Cache converted files for 2 hours
}));

// Serve static assets with long-term caching
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
  maxAge: '1y' // Cache static assets for 1 year
}));

// Main routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// About page
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

app.get('/about', (req, res) => {
  res.redirect(301, '/about.html');
});

// Privacy Policy page
app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});

app.get('/privacy', (req, res) => {
  res.redirect(301, '/privacy.html');
});

// Terms of Service page
app.get('/terms.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms.html'));
});

app.get('/terms', (req, res) => {
  res.redirect(301, '/terms.html');
});

// Contact page
app.get('/contact.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'contact.html'));
});

app.get('/contact', (req, res) => {
  res.redirect(301, '/contact.html');
});

// SEO files
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  const robotsContent = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /uploads/
Disallow: /converted/
Crawl-delay: 1

User-agent: Googlebot
Allow: /
Crawl-delay: 0

User-agent: Bingbot
Allow: /
Crawl-delay: 0

Sitemap: ${req.protocol}://${req.get('host')}/sitemap.xml`;
  res.send(robotsContent);
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/about.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/terms.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/contact.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`;
  res.send(sitemapContent);
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API endpoint for batch conversion
app.post('/api/convert-batch', upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const targetFormat = req.body.targetFormat.toLowerCase();
  const results = [];
  const errors = [];

  // Process each file
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
      
      // Clean up failed file
      if (fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
      }
    }
  }

  res.json({
    success: results,
    errors: errors,
    total: req.files.length,
    successful: results.length,
    failed: errors.length
  });
});

// API endpoint for conversion
app.post('/api/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const inputFile = req.file.path;
  const targetFormat = req.body.targetFormat.toLowerCase();
  const outputFileName = `output-${Date.now()}.${targetFormat}`;
  const outputFile = path.join(outputDir, outputFileName);

// Helper function for file conversion (used by both single and batch conversion)
async function processFileConversion(inputFile, outputFile, targetFormat, fileInfo) {
  return new Promise((resolve, reject) => {
    // Validate file type - support extensive formats
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp',
      'image/heif', 'image/heic', 'image/svg+xml', 'application/postscript', 'application/pdf',
      'application/illustrator', 'application/cdr', 'image/vnd.adobe.photoshop',
      'image/x-xcf', 'image/x-raw', 'image/x-canon-cr2', 'image/x-nikon-nef',
      'image/x-sony-arw', 'image/x-adobe-dng', 'image/vnd.djvu', 'image/avif'
    ];
    
    // More flexible file type checking
    const isValidImageFile = allowedTypes.some(type => 
      fileInfo.mimetype.includes(type.split('/')[1]) || 
      fileInfo.mimetype.startsWith('image/') ||
      fileInfo.mimetype.startsWith('application/')
    );

    if (!isValidImageFile) {
      fs.unlinkSync(inputFile); // Clean up uploaded file
      return reject(new Error('Invalid image file type'));
    }

    try {
      if (targetFormat === 'pdf') {
        // Convert image to PDF using pdfkit
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(outputFile);
        doc.pipe(stream);
        doc.image(inputFile, { fit: [500, 500], align: 'center', valign: 'center' });
        doc.end();
        stream.on('finish', () => {
          fs.unlinkSync(inputFile); // Clean up uploaded file
          resolve();
        });
        stream.on('error', reject);
      } else {
        // Use Sharp for common formats (faster and more reliable)
        const supportedBySharp = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'avif', 'heif', 'heic'];
        
        if (supportedBySharp.includes(targetFormat)) {
          processWithSharp();
        } else {
          // Use ImageMagick for advanced formats (SVG, EPS, AI, PSD, etc.)
          useImageMagick();
        }
        
        async function processWithSharp() {
          try {
            let sharpInstance = sharp(inputFile);
            
            // Configure Sharp based on target format
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
              case 'heif':
              case 'heic':
                await sharpInstance.heif({ quality: 90 }).toFile(outputFile);
                break;
              case 'gif':
                // Sharp doesn't support GIF output, fallback to PNG
                await sharpInstance.png().toFile(outputFile.replace('.gif', '.png'));
                fs.renameSync(outputFile.replace('.gif', '.png'), outputFile);
                break;
              default:
                await sharpInstance.toFile(outputFile);
            }
            
            fs.unlinkSync(inputFile); // Clean up uploaded file
            resolve();
          } catch (sharpError) {
            console.error('Sharp conversion error:', sharpError);
            // Fallback to ImageMagick if Sharp fails
            useImageMagick();
          }
        }
        
        function useImageMagick() {
          const command = `magick "${inputFile}" "${outputFile}"`;
          exec(command, (error) => {
            fs.unlinkSync(inputFile); // Always clean up uploaded file
            
            if (error) {
              console.error('ImageMagick conversion error:', error);
              return reject(new Error(`Conversion failed for ${targetFormat}. This format requires ImageMagick to be installed. Error: ${error.message}`));
            }
            resolve();
          });
        }
      }
    } catch (error) {
      // Clean up uploaded file on error
      if (fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
      }
      reject(error);
    }
  });
}

// API endpoint for batch conversion
app.post('/api/convert-batch', upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const targetFormat = req.body.targetFormat.toLowerCase();
  const results = [];
  const errors = [];

  // Process each file
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
      
      // Clean up failed file
      if (fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
      }
    }
  }

  res.json({
    success: results,
    errors: errors,
    total: req.files.length,
    successful: results.length,
    failed: errors.length
  });
});

// API endpoint for conversion
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
    console.error('Single file conversion error:', error);
    res.status(500).send('Conversion failed: ' + error.message);
  }
});
});

// Format-specific conversion pages for SEO
const formats = ['jpg', 'png', 'gif', 'webp', 'pdf', 'heic', 'tiff', 'bmp'];
formats.forEach(from => {
  formats.forEach(to => {
    if (from !== to) {
      app.get(`/${from}-to-${to}`, (req, res) => {
        // You can create specific landing pages for each conversion
        // For now, redirect to main page with format pre-selected
        res.redirect(`/?from=${from}&to=${to}`);
      });
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - Page Not Found | Universal Image Converter</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        h1 { font-size: 72px; margin: 0; }
        p { font-size: 20px; margin: 20px 0; }
        a { color: white; text-decoration: none; background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 5px; display: inline-block; margin-top: 20px; }
        a:hover { background: rgba(255,255,255,0.3); }
      </style>
    </head>
    <body>
      <h1>404</h1>
      <p>Oops! The page you're looking for doesn't exist.</p>
      <p>Let's get you back to converting images!</p>
      <a href="/">← Back to Image Converter</a>
    </body>
    </html>
  `);
});

// Cleanup files after 2 hours
setInterval(() => {
  const now = Date.now();
  const maxAge = 2 * 60 * 60 * 1000; // 2 hours
  
  [uploadDir, outputDir].forEach(dir => {
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
  });
}, 60 * 60 * 1000); // Run every hour

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal Server Error');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Universal Image Converter running on port ${PORT}`);
  console.log(`📍 Visit http://localhost:${PORT} to start converting images`);
  console.log(`\n📄 Available Pages:`);
  console.log(`   • Home: http://localhost:${PORT}/`);
  console.log(`   • About: http://localhost:${PORT}/about.html`);
  console.log(`   • Privacy: http://localhost:${PORT}/privacy.html`);
  console.log(`   • Terms: http://localhost:${PORT}/terms.html`);
  console.log(`   • Contact: http://localhost:${PORT}/contact.html`);
  console.log(`   • Sitemap: http://localhost:${PORT}/sitemap.xml`);
});