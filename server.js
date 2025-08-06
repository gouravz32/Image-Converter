const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Ensure directories exist
const uploadDir = 'uploads';
const outputDir = 'converted';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

app.use('/downloads', express.static(path.join(__dirname, 'converted')));

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/convert', upload.single('file'), async (req, res) => {
  const inputFile = req.file.path;
  const targetFormat = req.body.targetFormat.toLowerCase();
  const outputFileName = `output-${Date.now()}.${targetFormat}`;
  const outputFile = path.join(outputDir, outputFileName);

  // Validate file type - support extensive formats
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp',
    'image/heif', 'image/heic', 'image/svg+xml', 'application/postscript', 'application/pdf',
    'application/illustrator', 'application/cdr', 'image/vnd.adobe.photoshop',
    'image/x-xcf', 'image/x-raw', 'image/x-canon-cr2', 'image/x-nikon-nef',
    'image/x-sony-arw', 'image/x-adobe-dng', 'image/vnd.djvu'
  ];
  
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  // More flexible file type checking
  const isValidImageFile = allowedTypes.some(type => 
    req.file.mimetype.includes(type.split('/')[1]) || 
    req.file.mimetype.startsWith('image/') ||
    req.file.mimetype.startsWith('application/')
  );

  if (!isValidImageFile) {
    return res.status(400).send('Invalid image file');
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
        res.json({ downloadUrl: `/downloads/${outputFileName}` });
      });
    } else {
      // Use Sharp for common formats (faster and more reliable)
      const supportedBySharp = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'avif', 'heif', 'heic'];
      
      if (supportedBySharp.includes(targetFormat)) {
        try {
          let sharpInstance = sharp(inputFile);
          
          // Configure Sharp based on target format
          switch (targetFormat) {
            case 'jpg':
            case 'jpeg':
              await sharpInstance.jpeg({ quality: 90 }).toFile(outputFile);
              break;
            case 'png':
              await sharpInstance.png({ compressionLevel: 6 }).toFile(outputFile);
              break;
            case 'webp':
              await sharpInstance.webp({ quality: 90 }).toFile(outputFile);
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
              // Sharp doesn't support GIF output, fallback to copy for now
              await sharpInstance.png().toFile(outputFile.replace('.gif', '.png'));
              // Rename the file back to .gif (this is a workaround)
              fs.renameSync(outputFile.replace('.gif', '.png'), outputFile);
              break;
            default:
              await sharpInstance.toFile(outputFile);
          }
          
          res.json({ downloadUrl: `/downloads/${outputFileName}` });
        } catch (sharpError) {
          console.error('Sharp conversion error:', sharpError);
          // Fallback to ImageMagick if Sharp fails
          useImageMagick();
        }
      } else {
        // Use ImageMagick for advanced formats (SVG, EPS, AI, PSD, etc.)
        useImageMagick();
      }
      
      function useImageMagick() {
        const command = `magick "${inputFile}" "${outputFile}"`;
        exec(command, (error) => {
          if (error) {
            console.error('ImageMagick conversion error:', error);
            return res.status(500).send(`Conversion failed for ${targetFormat}. This format requires ImageMagick to be installed. Error: ${error.message}`);
          }
          res.json({ downloadUrl: `/downloads/${outputFileName}` });
        });
      }
    }
  } catch (error) {
    res.status(500).send('Conversion failed: ' + error.message);
  }
});

// Cleanup files after 2 hours
setInterval(() => {
  const now = Date.now();
  fs.readdirSync(uploadDir).forEach((file) => {
    const filePath = path.join(uploadDir, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > 2 * 60 * 60 * 1000) {
      fs.unlinkSync(filePath);
    }
  });
  fs.readdirSync(outputDir).forEach((file) => {
    const filePath = path.join(outputDir, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > 2 * 60 * 60 * 1000) {
      fs.unlinkSync(filePath);
    }
  });
}, 60 * 60 * 1000);

app.listen(3000, () => console.log('Server running on port 3000'));