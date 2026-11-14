export class RemnaCircuit {
  state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  failures = 0;
  failedAt = 0;
  succeededAt = 0;
  generation = 0;

  constructor(private readonly now: () => number = Date.now, private readonly cooldownMs = 30_000) {}

  reset() {
    this.state = "CLOSED";
    this.failures = 0;
    this.failedAt = 0;
    this.succeededAt = 0;
    this.generation++;
  }

  acquire(): number | null {
    if (this.state === "HALF_OPEN") return null;
    if (this.state === "OPEN") {
      if (this.now() - this.failedAt < this.cooldownMs) return null;
      this.state = "HALF_OPEN";
    }
    return this.generation;
  }

  success(generation: number) {
    if (generation !== this.generation) return;
    this.state = "CLOSED";
    this.failures = 0;
    this.succeededAt = this.now();
  }

  failure(generation: number) {
    if (generation !== this.generation) return;
    this.failures++;
    this.failedAt = this.now();
    if (this.state === "HALF_OPEN" || this.failures >= 3) {
      this.state = "OPEN";
      this.generation++;
    }
  }
}
