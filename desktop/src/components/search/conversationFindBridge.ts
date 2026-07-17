export type ConversationFindController = {
  search: (query: string) => number
  navigate: (index: number) => void
  clear: () => void
}

let activeController: ConversationFindController | null = null

export function registerConversationFindController(controller: ConversationFindController) {
  activeController = controller
  return () => {
    if (activeController === controller) activeController = null
  }
}

export function getConversationFindController() {
  return activeController
}
