export class Widget {
  open(): void {}

  private hiddenHelper(): void {
    // private; deslop should skip even if unused
  }

  #brandPrivate(): void {
    // also skipped
  }
}
