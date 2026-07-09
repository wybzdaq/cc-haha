
import { create } from 'zustand'
import { sessionsApi, type SessionListItem, type MessageEntry } from '../api/sessions'
import { reduceServerEvent, type PendingPermission, type PermissionMode } from '../lib/serverEvents'

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  activeMessages: MessageEntry[]
  isLoading: boolean
  isLoadingMessages: boolean
  isSending: boolean
  streamingAssistantId: string | null
  pendingPermission: PendingPermission | null
  permissionMode: PermissionMode
  error: string | null

  fetchSessions: (project?: string) => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  createSession: (workDir?: string) => Promise<string>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  setActiveSession: (sessionId: string | null) => void
  appendMessage: (message: MessageEntry) => void
  setSending: (sending: boolean) => void
  setActiveMessages: (messages: MessageEntry[]) => void
  handleServerEvent: (event: Record<string, any>) => void
  clearPendingPermission: () => void
  setPermissionMode: (mode: PermissionMode) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeMessages: [],
  isLoading: false,
  isLoadingMessages: false,
  isSending: false,
  streamingAssistantId: null,
  pendingPermission: null,
  permissionMode: 'default',
  error: null,

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessions } = await sessionsApi.list({ project, limit: 100 })
      set({ sessions, isLoading: false })
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
    }
  },

  loadSession: async (sessionId: string) => {
    set({ isLoadingMessages: true, error: null })
    try {
      // First get session metadata
      const session = await sessionsApi.get(sessionId)
      // Then get messages
      const { messages } = await sessionsApi.getMessages(sessionId)
      set({ 
        activeSessionId: sessionId, 
        activeMessages: messages,
        streamingAssistantId: null,
        pendingPermission: null,
        permissionMode: 'default',
        isSending: false,
        isLoadingMessages: false 
      })
    } catch (error) {
      set({ error: (error as Error).message, isLoadingMessages: false })
    }
  },

  createSession: async (workDir?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessionId } = await sessionsApi.create(workDir ? { workDir } : {})

      const now = new Date().toISOString()
      const optimisticSession: SessionListItem = {
        id: sessionId,
        title: 'New Session',
        createdAt: now,
        modifiedAt: now,
        messageCount: 0,
        projectPath: '',
        workDir: workDir || null,
        workDirExists: true,
      }

      set((state) => ({
        sessions: [optimisticSession, ...state.sessions],
        activeSessionId: sessionId,
        activeMessages: [],
        streamingAssistantId: null,
        pendingPermission: null,
        permissionMode: 'default',
        isLoading: false,
      }))

      return sessionId
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
      throw error
    }
  },

  deleteSession: async (sessionId: string) => {
    await sessionsApi.delete(sessionId)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== sessionId),
      activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      activeMessages: state.activeSessionId === sessionId ? [] : state.activeMessages,
      streamingAssistantId: state.activeSessionId === sessionId ? null : state.streamingAssistantId,
      pendingPermission: state.activeSessionId === sessionId ? null : state.pendingPermission,
      permissionMode: state.activeSessionId === sessionId ? 'default' : state.permissionMode,
    }))
  },

  renameSession: async (sessionId: string, title: string) => {
    await sessionsApi.rename(sessionId, title)
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, title } : session
      ),
    }))
  },

  setActiveSession: (sessionId: string | null) => {
    set({ activeSessionId: sessionId })
  },

  appendMessage: (message: MessageEntry) => {
    set((state) => ({
      activeMessages: [...state.activeMessages, message],
      sessions: state.activeSessionId
        ? touchSessionListItem(state.sessions, state.activeSessionId, { messageDelta: 1 })
        : state.sessions,
    }))
  },

  setSending: (sending: boolean) => {
    set({ isSending: sending })
  },

  setActiveMessages: (messages: MessageEntry[]) => {
    set({ activeMessages: messages })
  },

  handleServerEvent: (event: Record<string, any>) => {
    set((state) => {
      const previousMessageCount = state.activeMessages.length
      const next = reduceServerEvent({
        messages: state.activeMessages,
        streamingAssistantId: state.streamingAssistantId,
        sending: state.isSending,
        pendingPermission: state.pendingPermission,
        permissionMode: state.permissionMode,
      }, event)
      const messageDelta = Math.max(0, next.messages.length - previousMessageCount)
      const shouldTouch =
        messageDelta > 0 ||
        event.type === 'message_complete' ||
        event.type === 'user_message_received'

      return {
        activeMessages: next.messages,
        streamingAssistantId: next.streamingAssistantId,
        isSending: next.sending,
        pendingPermission: next.pendingPermission,
        permissionMode: next.permissionMode,
        sessions: state.activeSessionId && shouldTouch
          ? touchSessionListItem(state.sessions, state.activeSessionId, { messageDelta })
          : state.sessions,
      }
    })
  },

  clearPendingPermission: () => {
    set({ pendingPermission: null })
  },

  setPermissionMode: (mode: PermissionMode) => {
    set({ permissionMode: mode })
  },
}))

function touchSessionListItem(
  sessions: SessionListItem[],
  sessionId: string,
  options: { messageDelta?: number } = {},
): SessionListItem[] {
  const messageDelta = options.messageDelta ?? 0
  const now = new Date().toISOString()

  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          modifiedAt: now,
          messageCount: session.messageCount + messageDelta,
        }
      : session,
  )
}
