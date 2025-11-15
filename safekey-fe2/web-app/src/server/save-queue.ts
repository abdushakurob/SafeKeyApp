/**
 * Save Queue
 * Queues credential save requests that need signing
 * The React app will poll this queue and process items
 */

export interface QueuedSave {
  id: string
  domain: string
  username: string
  password: string
  createdAt: number
}

const saveQueue: QueuedSave[] = []

/**
 * Add a save request to the queue
 */
export function queueSave(credential: { domain: string; username: string; password: string }): string {
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const queued: QueuedSave = {
    id,
    ...credential,
    createdAt: Date.now(),
  }
  saveQueue.push(queued)
  console.log('[Save Queue] Queued save request:', id)
  return id
}

/**
 * Get all pending saves
 */
export function getPendingSaves(): QueuedSave[] {
  return [...saveQueue]
}

/**
 * Remove a save from the queue (after processing)
 */
export function removeFromQueue(id: string): boolean {
  const index = saveQueue.findIndex((item) => item.id === id)
  if (index >= 0) {
    saveQueue.splice(index, 1)
    console.log('[Save Queue] Removed from queue:', id)
    return true
  }
  return false
}

/**
 * Clear old items (older than 1 hour)
 */
export function clearOldItems(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  const initialLength = saveQueue.length
  for (let i = saveQueue.length - 1; i >= 0; i--) {
    if (saveQueue[i].createdAt < oneHourAgo) {
      saveQueue.splice(i, 1)
    }
  }
  const removed = initialLength - saveQueue.length
  if (removed > 0) {
    console.log(`[Save Queue] 🧹 Cleared ${removed} old items`)
  }
}

