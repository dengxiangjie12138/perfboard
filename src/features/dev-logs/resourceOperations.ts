/** All resource imports finish (including the page save) before navigation/backup/close. */
export class ResourceOperationQueue {
 private tail: Promise<void> = Promise.resolve();
 private pending = new Set<Promise<void>>();
 constructor(private changed: (busy: boolean) => void = () => {}) {}
 get busy(): boolean { return this.pending.size > 0; }
 run(operation: () => Promise<void>): Promise<void> {
  const task = this.tail.then(operation);
  this.tail = task.catch(() => {});
  this.pending.add(task); this.changed(true);
  const finish = () => { this.pending.delete(task); this.changed(this.busy); };
  void task.then(finish, finish);
  return task;
 }
 async flush(): Promise<void> { while (this.pending.size) await Promise.all([...this.pending]); }
}
