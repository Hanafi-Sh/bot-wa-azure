# Use Node 22 slim as base
FROM node:22-slim

# Install necessary libraries for Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    procps \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxshmfence1 \
    libxss1 \
    fonts-liberation \
    libnss3 \
    lsb-release \
    xdg-utils \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --ignore-scripts

# Copy application code
COPY . .

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV GOOGLE_CHROME_BIN=/usr/bin/chromium

# The bot code uses path-to-chrome logic, docker image will have it installed
# We will use the default puppeteer install

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "index.js"]
