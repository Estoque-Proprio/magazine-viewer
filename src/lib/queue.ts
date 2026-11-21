export type Job = (signal: AbortSignal) => Promise<void>;

export type JobHandle = {
  cancel(): void;
  setPriority(priority: number): void;
};

type Task = { priority: number; job: Job; controller: AbortController };

/** Prioridade 0: página na tela. Acima disso: vizinhas, miniaturas. */
const URGENT = 0;

/**
 * As páginas disputam um único worker do PDF.js e a mesma banda. A fila roda
 * primeiro o que é mais urgente (número menor) e não deixa pré-carregamento
 * rodar ao lado de uma página da tela: senão a vizinha baixa junto e atrasa
 * justamente a página que a pessoa está esperando.
 */
export class RenderQueue {
  private pending = new Set<Task>();
  private running = new Set<Task>();

  constructor(private readonly concurrency: number) {}

  add(priority: number, job: Job): JobHandle {
    const task: Task = { priority, job, controller: new AbortController() };
    this.pending.add(task);
    queueMicrotask(() => this.pump());
    return {
      cancel: () => {
        task.controller.abort();
        this.pending.delete(task);
      },
      setPriority: (next) => {
        task.priority = next;
      },
    };
  }

  private pump() {
    while (this.running.size < this.concurrency && this.pending.size > 0) {
      let next: Task | undefined;
      for (const task of this.pending) if (!next || task.priority < next.priority) next = task;
      if (!next) return;
      const urgentRunning = [...this.running].some((task) => task.priority <= URGENT);
      if (urgentRunning && next.priority > URGENT) return;
      this.pending.delete(next);
      this.running.add(next);
      const task = next;
      task
        .job(task.controller.signal)
        .catch(() => {})
        .finally(() => {
          this.running.delete(task);
          this.pump();
        });
    }
  }
}

export const renderQueue = new RenderQueue(2);
