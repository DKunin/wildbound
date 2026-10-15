export class RunControlSystem {
  private requiresShiftRelease = false;

  reset(): void {
    this.requiresShiftRelease = false;
  }

  update(shiftDown: boolean, canRun: boolean): boolean {
    if (!shiftDown) {
      this.requiresShiftRelease = false;
      return false;
    }

    if (!canRun) {
      this.requiresShiftRelease = true;
      return false;
    }

    return !this.requiresShiftRelease;
  }
}
