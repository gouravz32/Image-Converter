# Node base image with Debian (full, not slim)
FROM node:18-bullseye

# Disable prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install ImageMagick & extra libs for formats like HEIC, AVIF, PDF, SVG, EPS
RUN apt-get update && apt-get install -y \
    imagemagick \
    ghostscript \
    libheif-dev \
    libavif-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libwebp-dev \
    poppler-utils \
    librsvg2-bin \
    && rm -rf /var/lib/apt/lists/*

# Set working dir
WORKDIR /app

# Copy package files & install deps
COPY package*.json ./
RUN npm install --production

# Copy rest of the code
COPY . .

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
# Healthcheck to ensure the app is running
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:3000/health || exit 1