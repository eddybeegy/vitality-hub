import { EventEmitter } from 'events';

// Simple in-memory queue manager
class TaskQueue extends EventEmitter {
  private queue: any[] = [];
  private isProcessing = false;

  async enqueue(task: any) {
    this.queue.push(task);
    this.process();
  }

  private async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    const task = this.queue.shift();
    
    try {
      await task.execute();
    } catch (error) {
      console.error('Task execution failed:', error);
    } finally {
      this.isProcessing = false;
      this.process();
    }
  }
}

export const syncQueue = new TaskQueue();
