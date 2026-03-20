build-service:
    cd packages/typst-web-service && bun run build

build-codemirror: build-service
    cd packages/codemirror-typst && bun run build

build: build-codemirror

install:
    bun install

dev: build
    rm -rf demo/node_modules/.vite
    cd demo && bun run dev & \
    wait

test:
    bunx vitest run

test-watch:
    bunx vitest

format:
    npx biome check --write .
