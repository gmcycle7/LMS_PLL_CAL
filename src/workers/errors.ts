/** run() 因 cancel() / 新的 run（restartOnRun）/ dispose 而中止時丟出的錯誤 */
export class WorkerCancelledError extends Error {
  constructor(message = '模擬已取消') {
    super(message)
    this.name = 'WorkerCancelledError'
  }
}

export function isWorkerCancelled(err: unknown): err is WorkerCancelledError {
  return err instanceof WorkerCancelledError || (err instanceof Error && err.name === 'WorkerCancelledError')
}
