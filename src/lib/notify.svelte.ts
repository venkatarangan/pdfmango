// Snackbar messages and the screen-reader live region.

export type SnackAction = { label: string; run: () => void };
export type Snack = { id: number; text: string; tone: 'info' | 'error'; action?: SnackAction };

class Notify {
  snack = $state<Snack | null>(null);
  /** Text for the polite aria-live region. */
  live = $state('');
  private queue: Snack[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;

  show(text: string, tone: Snack['tone'] = 'info', action?: SnackAction) {
    this.queue.push({ id: this.nextId++, text, tone, ...(action ? { action } : {}) });
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
    // A message with a button stays longer, so there is time to press it.
    this.timer = setTimeout(() => this.dismiss(), next.action ? 12000 : Math.min(10000, 4000 + next.text.length * 40));
  }
}

export const notify = new Notify();
