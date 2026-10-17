export enum DesktopErrorSource {
  Error = "window.error",
  UnhandledRejection = "window.unhandledrejection",
  RouteBoundary = "route-boundary",
}

export interface DesktopErrorReport {
  readonly source: DesktopErrorSource;
  readonly message: string;
  readonly stack?: string | undefined;
  readonly route?: string | undefined;
}

export type DesktopErrorTransport = (report: DesktopErrorReport) => void;

interface DesktopErrorBridge {
  reportError?(report: DesktopErrorReport): Promise<void>;
}

const bridgeTransport: DesktopErrorTransport = (report) => {
  const bridge = (globalThis as { mezan?: DesktopErrorBridge }).mezan;
  if (!bridge?.reportError) return;
  void bridge.reportError(report).catch(() => undefined);
};

let transport: DesktopErrorTransport = bridgeTransport;

export function setDesktopErrorTransport(next: DesktopErrorTransport): void {
  transport = next;
}

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message || reason.name, ...(reason.stack ? { stack: reason.stack } : {}) };
  }
  return { message: typeof reason === "string" ? reason : "non-error value thrown" };
}

export function reportDesktopError(source: DesktopErrorSource, reason: unknown): void {
  try {
    const { message, stack } = describe(reason);
    transport({ source, message, stack, route: globalThis.location?.pathname });
  } catch {
    // Reporting an error must never raise another one.
  }
}

export function installDesktopErrorReporter(target: Window = window): () => void {
  const onError = (event: ErrorEvent): void => {
    reportDesktopError(DesktopErrorSource.Error, event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    reportDesktopError(DesktopErrorSource.UnhandledRejection, event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
