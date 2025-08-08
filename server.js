const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = 3000;

// Ensure an 'uploads' directory exists for temporary file storage
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer setup for handling file uploads
const upload = multer({ dest: uploadDir });

// Serve static files (HTML, CSS, etc.) from the root directory
app.use(express.static(path.join(__dirname)));
app.use(express.json()); // for parsing application/json

console.log(`Serving static files from: ${path.join(__dirname)}`);

/**
 * MOCK API ENDPOINTS
 * These are placeholders. You need to implement the actual image conversion
 * logic using libraries like Sharp and ImageMagick here.
 */

// Mock endpoint for single file conversion
app.post('/api/convert', upload.single('file'), (req, res) => {
    console.log('Received single file conversion request for:', req.file.originalname);
    console.log('Target format:', req.body.targetFormat);

    // Simulate a delay and success
    setTimeout(() => {
        res.json({ downloadUrl: `/fake/converted-file.${req.body.targetFormat}` });
    }, 1500);
});

// Mock endpoint for batch file conversion
app.post('/api/convert-batch', upload.array('files'), (req, res) => {
    console.log(`Received batch conversion request for ${req.files.length} files.`);
    console.log('Target format:', req.body.targetFormat);

    const results = {
        total: req.files.length,
        successful: req.files.length - (req.files.length > 1 ? 1 : 0),
        success: req.files.slice(0, -1).map(f => ({
            originalName: f.originalname,
            downloadUrl: `/fake/${f.originalname}.${req.body.targetFormat}`
        })),
        errors: req.files.length > 1 ? [{
            originalName: req.files[req.files.length - 1].originalname,
            error: 'Unsupported format'
        }] : []
    };

    setTimeout(() => {
        res.json(results);
    }, 2500);
});

// Mock endpoint for creating and downloading a ZIP file
app.post('/api/download-batch-zip', (req, res) => {
    console.log('Received request to ZIP files:', req.body.fileUrls);
    res.json({ downloadUrl: '/fake/batch-converted.zip' });
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop.');
});