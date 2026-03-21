import {
    AnalyzerSession,
    normalizePath,
    normalizeRoot,
    type TypstAnalyzer,
    type TypstCompiler,
} from "@vedivad/typst-web-service";
import { TypstWorkspaceController } from "./workspace-controller.js";

function sessionConfigKey(options: {
    projectRootPath?: string;
    projectEntryPath?: string;
}): string {
    const root = normalizeRoot(options.projectRootPath ?? "/project");
    const entry = normalizePath(options.projectEntryPath ?? "/main.typ");
    return `${root}|${entry}`;
}

export class WorkspaceRegistry {
    private readonly analyzerSessionCache = new WeakMap<
        TypstAnalyzer,
        Map<string, AnalyzerSession>
    >();

    private readonly workspaceControllerCache = new WeakMap<
        TypstAnalyzer,
        WeakMap<TypstCompiler, Map<string, TypstWorkspaceController>>
    >();

    getSession(options: {
        analyzer: TypstAnalyzer;
        projectRootPath?: string;
        projectEntryPath?: string;
    }): AnalyzerSession {
        const key = sessionConfigKey(options);

        let perAnalyzer = this.analyzerSessionCache.get(options.analyzer);
        if (!perAnalyzer) {
            perAnalyzer = new Map();
            this.analyzerSessionCache.set(options.analyzer, perAnalyzer);
        }

        const cached = perAnalyzer.get(key);
        if (cached) return cached;

        const session = new AnalyzerSession({
            analyzer: options.analyzer,
            rootPath: options.projectRootPath,
            entryPath: options.projectEntryPath,
        });
        perAnalyzer.set(key, session);
        return session;
    }

    getController(options: {
        analyzer: TypstAnalyzer;
        compiler: TypstCompiler;
        projectRootPath?: string;
        projectEntryPath?: string;
    }): TypstWorkspaceController {
        const key = sessionConfigKey(options);

        let perAnalyzer = this.workspaceControllerCache.get(options.analyzer);
        if (!perAnalyzer) {
            perAnalyzer = new WeakMap();
            this.workspaceControllerCache.set(options.analyzer, perAnalyzer);
        }

        let perCompiler = perAnalyzer.get(options.compiler);
        if (!perCompiler) {
            perCompiler = new Map();
            perAnalyzer.set(options.compiler, perCompiler);
        }

        const cached = perCompiler.get(key);
        if (cached) return cached;

        const session = this.getSession({
            analyzer: options.analyzer,
            projectRootPath: options.projectRootPath,
            projectEntryPath: options.projectEntryPath,
        });

        const controller = new TypstWorkspaceController({
            analyzer: options.analyzer,
            compiler: options.compiler,
            projectRootPath: options.projectRootPath,
            projectEntryPath: options.projectEntryPath,
            session,
        });

        perCompiler.set(key, controller);
        return controller;
    }
}