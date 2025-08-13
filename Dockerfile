# Official Node.js image
FROM node:18

# Install dependencies (including ImageMagick)
RUN apt-get update && apt-get install -y \
    imagemagick \
    libheif-examples \
    libheif-dev \
    libavif-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy all files
COPY . .

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "server.js"]
