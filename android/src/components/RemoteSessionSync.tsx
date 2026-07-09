import { useEffect } from 'react'
import { wsManager } from '../api/websocket'
import { useSessionStore } from '../stores/sessionStore'

export default function RemoteSessionSync() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const handleServerEvent = useSessionStore((state) => state.handleServerEvent)

  useEffect(() => {
    if (!activeSessionId) {
      return
    }

    wsManager.connect(activeSessionId)
    const unsubscribe = wsManager.onMessage(activeSessionId, (message) => {
      handleServerEvent(message)
      if (message.type === 'error') {
        console.error('WebSocket error:', message)
      }
    })

    return () => {
      unsubscribe()
      wsManager.disconnect(activeSessionId)
    }
  }, [activeSessionId, handleServerEvent])

  return null
}
