type QueueTask<T> = () => Promise<T>;

interface QueuedItem<T> {
  task: QueueTask<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class ChannelQueue {
  private readonly queues = new Map<string, Array<QueuedItem<unknown>>>();
  private readonly runningChannels = new Set<string>();

  enqueue<T>(channelId: string, task: QueueTask<T>): Promise<T> {
    const queue = this.queues.get(channelId) ?? [];
    this.queues.set(channelId, queue);

    return new Promise<T>((resolve, reject) => {
      queue.push({ task, resolve, reject } as QueuedItem<unknown>);
      this.run(channelId);
    });
  }

  pending(channelId: string): number {
    const queue = this.queues.get(channelId);
    return queue ? queue.length : 0;
  }

  isRunning(channelId: string): boolean {
    return this.runningChannels.has(channelId);
  }

  private async run(channelId: string): Promise<void> {
    if (this.runningChannels.has(channelId)) {
      return;
    }

    this.runningChannels.add(channelId);
    try {
      let queue = this.queues.get(channelId);
      while (queue && queue.length > 0) {
        const item = queue.shift() as QueuedItem<unknown>;
        try {
          const result = await item.task();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
        queue = this.queues.get(channelId);
      }
    } finally {
      this.runningChannels.delete(channelId);
      const queue = this.queues.get(channelId);
      if (!queue || queue.length === 0) {
        this.queues.delete(channelId);
      }
    }
  }
}
