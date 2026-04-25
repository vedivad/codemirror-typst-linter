# @vedivad/typst-web-yjs

Y.js adapters for syncing shared Typst documents into `TypstProject`.

This package is intentionally separate from `@vedivad/typst-web-service` and
`@vedivad/codemirror-typst`, so collaborative editing support stays opt-in.

## Install

```bash
npm install @vedivad/typst-web-yjs yjs
```

## Single file

```ts
import { syncYTextToTypstProject } from "@vedivad/typst-web-yjs";
import * as Y from "yjs";

const ydoc = new Y.Doc();
const ytext = ydoc.getText("main.typ");

const sync = syncYTextToTypstProject({
  project,
  ytext,
  path: "/main.typ",
  onError: ({ error }) => console.error("[typst-yjs]", error),
});

await sync.ready;
```

Use this with `createTypstSetup({ project, sync: "external" })` so CodeMirror
reads and writes through your Y.js binding while `TypstProject` stays
mirrored for diagnostics, completion, hover, and preview.

## Multi-file project

Use a `Y.Map<Y.Text>` keyed by Typst file path:

```ts
import { syncYMapToTypstProject } from "@vedivad/typst-web-yjs";
import * as Y from "yjs";

const ydoc = new Y.Doc();
const files = ydoc.getMap<Y.Text>("files");

const main = new Y.Text();
main.insert(0, "= Hello");
files.set("/main.typ", main);

const sync = syncYMapToTypstProject({
  project,
  files,
});

await sync.ready;
```

The adapter observes added, removed, replaced, and edited text files. It
serializes async writes into `TypstProject` and always writes the latest Y.js
state after bursts of local or remote edits.

## Lifecycle

```ts
await sync.flush(); // wait for pending project writes before export/save
sync.dispose(); // remove Y.js observers
```

`TypstProject` still owns compile scheduling. Configure debounce and max-wait on
the project:

```ts
const project = new TypstProject({
  compiler,
  analyzer,
  autoCompile: { debounceMs: 500, maxWaitMs: 2000 },
});
```
