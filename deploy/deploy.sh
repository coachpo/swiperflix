#!/bin/bash

# Swiperflix Deployment Script
# Deploys gateway (FastAPI) and player (Next.js) using Docker Compose with GHCR images
# Images are built and pushed by GitHub Actions CI/CD pipeline

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="docker-compose.prod.yml"
PROJECT_NAME="swiperflix"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        print_error "Required command '$1' not found in PATH."
        exit 1
    fi
}

# Optional gateway env: if you need OPENLIST_* secrets, create deploy/gateway.env (player config is baked at build time)
if [ ! -f gateway.env ]; then
    print_warning "gateway.env not found. If gateway needs OPENLIST_* secrets, create deploy/gateway.env."
fi

require_cmd docker
docker compose version >/dev/null 2>&1 || {
    print_error "Docker Compose plugin is not available. Please install Docker Desktop or the compose plugin."
    exit 1
}

print_status "Deploying Swiperflix"
print_status "Stack: swiperflix (gateway + player)"

# Pull latest images
print_status "Pulling latest images..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" pull

# Stop existing containers
print_status "Stopping existing containers..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down

# Ensure data dir for SQLite persistence
if [ ! -d "data" ]; then
    print_status "Creating data directory..."
    mkdir -p data
    print_status "Data directory created successfully"
else
    print_status "Data directory already exists"
fi

# Start services
print_status "Starting services..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d

print_status "✅ Deployment steps finished."
print_status "Application expected at: http://localhost:8066"

# Show running containers
print_status "Running containers:"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" ps
