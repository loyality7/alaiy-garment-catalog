FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN npm install

# Copy source
COPY . .

# Expose port
EXPOSE 3000

# Use hostname 0.0.0.0 so Docker can access it from outside the container
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
