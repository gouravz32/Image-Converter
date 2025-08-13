# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Install all required dependencies including potrace
RUN apk update && apk add --no-cache \
    imagemagick \
    imagemagick-dev \
    imagemagick-libs \
    potrace \
    libheif \
    libwebp \
    libwebp-tools \
    libjpeg-turbo \
    libjpeg-turbo-utils \
    libpng \
    tiff \
    giflib \
    librsvg \
    ghostscript \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    fontconfig \
    ttf-dejavu

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create required directories
RUN mkdir -p uploads converted

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]