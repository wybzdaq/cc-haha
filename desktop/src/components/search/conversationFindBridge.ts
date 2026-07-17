export type ConversationFindController = {
  search: (query: string) => number
  navigate: (index: number) => void
  clear: () => void
}

let activeController: ConversationFindController | null = null
const listeners = new Set<() => void>()

function notifyControllerChanged() {
  for (const listener of listeners) listener()
}

export function registerConversationFindController(controller: ConversationFindController) {
  activeController = controller
  notifyControllerChanged()
  return () => {
    if (activeController !== controller) return
    activeController = null
    notifyControllerChanged()
  }
}

export function getConversationFindController() {
  return activeController
}

export function subscribeConversationFindController(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
