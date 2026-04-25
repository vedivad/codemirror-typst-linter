build-service:
    cd packages/typst-web-service && bun run build

build-yjs: build-service
    cd packages/typst-web-yjs && bun run build

build-codemirror: build-yjs
    cd packages/codemirror-typst && bun run build

build: build-codemirror

install:
    bun install

dev: build
    rm -rf demo/node_modules/.vite
    cd demo && bun run dev & \
    wait

test:
    bun run test

test-watch:
    bun run test:watch

format:
    bun run format

lint:
    bun run lint

check:
    bun run check

release-check-clean:
    git diff --quiet || (echo "Working tree has unstaged changes. Commit/stash first:" && git status --short && exit 1)
    git diff --cached --quiet || (echo "Working tree has staged-but-uncommitted changes. Commit/stash first:" && git status --short && exit 1)

release-bump version:
    npm pkg set version={{ version }} --workspace packages/typst-web-service --workspace packages/typst-web-yjs --workspace packages/codemirror-typst
    npm pkg set "peerDependencies.@vedivad/typst-web-service=^{{ version }}" --workspace packages/typst-web-yjs

release-tag version:
    git add packages/typst-web-service/package.json packages/typst-web-yjs/package.json packages/codemirror-typst/package.json
    git commit -m "chore(release): v{{ version }}"
    git tag -a v{{ version }} -m "Release v{{ version }}"
    git push
    git push origin v{{ version }}

release version: release-check-clean test build
    just release-bump {{ version }}
    just release-tag {{ version }}
