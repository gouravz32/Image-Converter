# Base image
FROM node:18-bullseye

# Install ImageMagick + Extra libraries
RUN apt-get update && apt-get install -y \
  imagemagick \
  libheif-examples \
  libheif-dev \
  libraw-dev \
  ghostscript \
  librsvg2-bin \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json & package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Expose port (same as your app)
EXPOSE 3000

# Start command
CMD ["npm", "start"]
