// Snackbar messages and the screen-reader live region.

export type Snack = { id: number; text: string; tone: 'info' | 'error' };

class Notify {
  snack = $state<Snack | null>(null);
  /** Text for the polite aria-live region. */
  live = $state('');
  private queue: Snack[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;

  show(text: string, tone: Snack['tone'] = 'info') {
    this.queue.push({ id: this.nextId++, text, tone });
    this.announce(text);
    if (!this.snack) this.advance();
  }

  error(text: string) {
    this.show(text, 'error');
  }

  dismiss() {
    clearTimeout(this.timer);
    this.snack = null;
    setTimeout(() => this.advance(), 150);
  }

  announce(text: string) {
    // Clearing first makes screen readers repeat identical consecutive messages.
    this.live = '';
    queueMicrotask(() => (this.live = text));
  }

  private advance() {
    const next = this.queue.shift();
    if (!next) return;
    this.snack = next;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), Math.min(10000, 4000 + next.text.length * 40));
  }
}

export const notify = new Notify();
