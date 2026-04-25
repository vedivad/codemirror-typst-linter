import type { Path, TypstProject } from "@vedivad/typst-web-service";
import * as Y from "yjs";

export interface TypstYjsSync {
  readonly ready: Promise<void>;
  flush(): Promise<void>;
  dispose(): void;
}

export interface TypstYjsSyncError {
  error: unknown;
  operation: "setText" | "setMany" | "remove";
  path?: string;
}

export interface SyncYTextToTypstProjectOptions {
  project: TypstProject;
  ytext: Y.Text;
  path: Path | string;
  onError?: (event: TypstYjsSyncError) => void;
}

export interface SyncYMapToTypstProjectOptions {
  project: TypstProject;
  files: Y.Map<Y.Text>;
  onError?: (event: TypstYjsSyncError) => void;
}

type WriteLatest = () => Promise<void>;

class SerializedSync implements TypstYjsSync {
  private dirty = false;
  private disposed = false;
  private running: Promise<void> | undefined;
  readonly ready: Promise<void>;

  constructor(private readonly writeLatest: WriteLatest) {
    this.ready = this.requestSync();
  }

  flush(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
  }

  requestSync(): Promise<void> {
    if (this.disposed) return this.running ?? Promise.resolve();
    this.dirty = true;
    if (!this.running) {
      this.running = this.drain();
    }
    return this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false;
        await this.writeLatest();
      }
    } finally {
      this.running = undefined;
      if (this.dirty && !this.disposed) {
        this.running = this.drain();
      }
    }
  }
}

export function syncYTextToTypstProject(
  options: SyncYTextToTypstProjectOptions,
): TypstYjsSync {
  const { project, ytext, path, onError } = options;
  const p = path.toString();

  const sync = new SerializedSync(async () => {
    try {
      await project.setText(p, ytext.toString());
    } catch (error) {
      onError?.({ error, operation: "setText", path: p });
    }
  });

  const observer = () => {
    void sync.requestSync();
  };

  ytext.observe(observer);

  return {
    ready: sync.ready,
    flush: () => sync.flush(),
    dispose: () => {
      ytext.unobserve(observer);
      sync.dispose();
    },
  };
}

export function syncYMapToTypstProject(
  options: SyncYMapToTypstProjectOptions,
): TypstYjsSync {
  const { project, files, onError } = options;
  const dirtyPaths = new Set<string>();
  const textObservers = new Map<
    string,
    {
      text: Y.Text;
      observer: () => void;
    }
  >();
  let dirtyAll = true;

  const markDirty = (path: string) => {
    dirtyPaths.add(path);
    void sync.requestSync();
  };

  const observeText = (path: string, text: Y.Text) => {
    const existing = textObservers.get(path);
    if (existing?.text === text) return;
    if (existing) {
      existing.text.unobserve(existing.observer);
    }
    const observer = () => markDirty(path);
    text.observe(observer);
    textObservers.set(path, { text, observer });
  };

  const unobserveText = (path: string) => {
    const existing = textObservers.get(path);
    if (!existing) return;
    existing.text.unobserve(existing.observer);
    textObservers.delete(path);
  };

  const observeCurrentTexts = () => {
    for (const [path, text] of files.entries()) {
      observeText(path, text);
    }
  };

  const sync = new SerializedSync(async () => {
    if (dirtyAll) {
      dirtyAll = false;
      dirtyPaths.clear();
      observeCurrentTexts();
      const snapshot = Object.fromEntries(
        Array.from(files.entries(), ([path, text]) => [path, text.toString()]),
      );
      if (Object.keys(snapshot).length === 0) return;
      try {
        await project.setMany(snapshot);
      } catch (error) {
        onError?.({ error, operation: "setMany" });
      }
      return;
    }

    const paths = [...dirtyPaths];
    dirtyPaths.clear();

    const changed: Record<string, string> = {};
    const removed: string[] = [];

    for (const path of paths) {
      const text = files.get(path);
      if (text) {
        observeText(path, text);
        changed[path] = text.toString();
      } else {
        removed.push(path);
      }
    }

    const changedEntries = Object.entries(changed);
    if (changedEntries.length === 1) {
      const [path, content] = changedEntries[0];
      try {
        await project.setText(path, content);
      } catch (error) {
        onError?.({ error, operation: "setText", path });
      }
    } else if (changedEntries.length > 1) {
      try {
        await project.setMany(changed);
      } catch (error) {
        onError?.({ error, operation: "setMany" });
      }
    }

    for (const path of removed) {
      try {
        await project.remove(path);
      } catch (error) {
        onError?.({ error, operation: "remove", path });
      }
    }
  });

  observeCurrentTexts();

  const mapObserver = (event: Y.YMapEvent<Y.Text>) => {
    for (const [path, change] of event.changes.keys) {
      if (change.action === "delete" || change.action === "update") {
        unobserveText(path);
      }

      const text = files.get(path);
      if (text) {
        observeText(path, text);
      }

      dirtyPaths.add(path);
    }
    void sync.requestSync();
  };

  files.observe(mapObserver);

  return {
    ready: sync.ready,
    flush: () => sync.flush(),
    dispose: () => {
      files.unobserve(mapObserver);
      for (const path of [...textObservers.keys()]) {
        unobserveText(path);
      }
      sync.dispose();
    },
  };
}
