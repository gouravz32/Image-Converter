# Image Converter Setup Instructions

## 🚀 Quick Start

### 1. Dependencies Installation Complete ✅
- Node.js dependencies are already installed
- Express, Multer, and PDFKit are ready

### 2. ImageMagick Installation (Required for Windows)

#### Option A: Using Chocolatey (Recommended)
```powershell
# Install Chocolatey if not already installed
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install ImageMagick with all delegates
choco install imagemagick -y
```

#### Option B: Manual Installation
1. Download ImageMagick from: https://imagemagick.org/script/download.php#windows
2. Choose: ImageMagick-7.x.x-Q16-HDRI-x64-dll.exe
3. During installation, check ALL delegate options:
   - ✅ Install HEIF support
   - ✅ Install RAW support  
   - ✅ Install SVG support
   - ✅ Install PostScript support
   - ✅ Add to system PATH

### 3. Start the Server
```powershell
node server.js
```

### 4. Open in Browser
Navigate to: http://localhost:3000

## 📋 Supported Formats

### ✅ Native Support (No extra setup needed)
- **Common**: JPG, JPEG, PNG, GIF, BMP, WEBP
- **PDF**: Handled by PDFKit
- **High Quality**: TIFF, TIF

### 🔧 Requires ImageMagick + Delegates
- **Modern**: HEIF, HEIC, AVIF
- **Vector**: SVG, EPS, AI
- **Professional**: PSD (basic), XCF (basic), CDR (basic)
- **Camera RAW**: CR2, NEF, ARW, DNG, RAW
- **Specialized**: DJVU, ICO

## 🛠️ Troubleshooting

### If conversion fails:
1. **Check ImageMagick installation**:
   ```powershell
   magick -version
   ```

2. **Install additional delegates** (if needed):
   ```powershell
   # For HEIF/HEIC support
   choco install libheif -y
   
   # For RAW support
   choco install libraw -y
   ```

3. **Verify specific format support**:
   ```powershell
   magick identify -list format | findstr "HEIC"
   magick identify -list format | findstr "SVG"
   ```

## 🎨 Features

- **20+ Format Support**: From common JPG/PNG to professional RAW/PSD
- **Drag & Drop Interface**: Modern, responsive design
- **Real-time Progress**: Visual feedback during conversion
- **Auto Cleanup**: Files deleted after 2 hours for privacy
- **Error Handling**: Clear messages for unsupported formats
- **Professional UI**: Categorized format selection

## 📁 Project Structure
```
Image Converter/
├── index.html          # Frontend UI (React-based)
├── server.js           # Backend API (Express)
├── package.json        # Dependencies
├── uploads/            # Temporary upload storage
├── converted/          # Converted files output
└── README.md          # This file
```

## 🔒 Security Notes
- Files are automatically cleaned up after 2 hours
- Only image files are accepted
- File validation on both frontend and backend
- Secure file handling with proper error management

## 🚀 Advanced Usage

### Custom ImageMagick Policy (Optional)
If you encounter policy errors, edit the ImageMagick policy file:

**Windows**: `C:\Program Files\ImageMagick-7.x.x-Q16-HDRI\policy.xml`

Add these lines before `</policymap>`:
```xml
<policy domain="coder" rights="read|write" pattern="PDF" />
<policy domain="coder" rights="read|write" pattern="SVG" />
<policy domain="coder" rights="read|write" pattern="HEIC" />
<policy domain="coder" rights="read|write" pattern="EPS" />
<policy domain="coder" rights="read|write" pattern="PS" />
```

### Environment Variables
```powershell
# Optional: Set custom port
$env:PORT = "8080"
node server.js
```

## 📞 Support
If you encounter issues with specific formats, the application will show detailed error messages to help you identify missing dependencies.

Happy converting! 🎉
