export class CustomError {
  message = "boom";
  name = "CustomError";
  toJSON(): unknown {
    return { message: this.message };
  }
  toString(): string {
    return this.message;
  }
}

export class Disposable {
  dispose(): void {}
  destroy(): void {}
}
