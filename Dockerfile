FROM node:18-bullseye

# Prevent prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install ImageMagick + delegates (HEIC/AVIF/PSD support)
RUN apt-get update && apt-get install -y \
  imagemagick \
  libheif-dev \
  libavif-dev \
  libjpeg-dev \
  libpng-dev \
  libtiff-dev \
  libwebp-dev \
  ghostscript \
  poppler-utils \
  librsvg2-bin \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]