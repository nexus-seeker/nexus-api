#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting hard database recreation..."

# Stop and remove containers, networks, images, and volumes
echo "📂 Wiping Docker volumes..."
docker-compose down -v

# Start containers in detached mode
echo "🐳 Starting PostgreSQL container..."
docker-compose up -d

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker-compose exec -T postgres pg_isready -U postgres -d nexus; do
  sleep 1
done

echo "✅ PostgreSQL is ready!"

# Run Prisma migrations
echo "🔄 Running Prisma migrations..."
npx prisma migrate dev --name init

# Generate Prisma client
echo "🛠️ Generating Prisma client..."
npx prisma generate

echo "✨ Database recreation complete!"
