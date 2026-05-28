export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

export class BridgeDisposedError extends BridgeError {
  constructor(message = "Bridge has been disposed") {
    super(message);
    this.name = "BridgeDisposedError";
  }
}

export class BridgeResetError extends BridgeError {
  constructor(message = "Bridge has been reset") {
    super(message);
    this.name = "BridgeResetError";
  }
}

export class BridgeTimeoutError extends BridgeError {
  constructor(message = "Bridge call timed out") {
    super(message);
    this.name = "BridgeTimeoutError";
  }
}

export class BridgeRemoteError extends BridgeError {
  readonly code: string;
  readonly detail: unknown;

  constructor(message: string, code: string, detail?: unknown) {
    super(message);
    this.name = "BridgeRemoteError";
    this.code = code;
    this.detail = detail;
  }
}
