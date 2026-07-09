import type { MessageEntry } from '../types/session'
import type { SessionListItem } from '../types/session'

export type PendingPermission = {
  requestId: string
  toolName: string
  input: unknown
  description?: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk'

export type RemoteMessageState = {
  messages: MessageEntry[]
  streamingAssistantId: string | null
  sending: boolean
  pendingPermission: PendingPermission | null
  permissionMode: PermissionMode
}

export type IdFactory = () => string

export function createMessageId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

export function buildUserMessagePayload(text: string) {
  return {
    type: 'user_message' as const,
    content: text.trim(),
  }
}

export function buildPermissionResponsePayload(
  requestId: string,
  allowed: boolean,
  options?: { rule?: 'always' },
) {
  return {
    type: 'permission_response' as const,
    requestId,
    allowed,
    ...(options?.rule ? { rule: options.rule } : {}),
  }
}

export function buildStopGenerationPayload() {
  return {
    type: 'stop_generation' as const,
  }
}

export function buildPermissionModePayload(mode: PermissionMode) {
  return {
    type: 'set_permission_mode' as const,
    mode,
  }
}

export function buildRuntimeConfigPayload(input: { providerId: string | null; modelId: string }) {
  return {
    type: 'set_runtime_config' as const,
    providerId: input.providerId,
    modelId: input.modelId,
  }
}

export function createLocalUserMessage(text: string, makeId: IdFactory = () => createMessageId('user')): MessageEntry {
  return {
    id: makeId(),
    type: 'user',
    content: text.trim(),
    timestamp: new Date().toISOString(),
  }
}

export function reduceServerEvent(
  state: RemoteMessageState,
  event: Record<string, any>,
  makeId: IdFactory = () => createMessageId('assistant'),
): RemoteMessageState {
  switch (event.type) {
    case 'user_message_received':
      if (typeof event.content !== 'string' || event.content.trim().length === 0) {
        return state
      }
      return {
        ...state,
        sending: true,
        messages: [
          ...state.messages,
          {
            id: createMessageId('user'),
            type: 'user',
            content: event.content.trim(),
            timestamp: new Date().toISOString(),
          },
        ],
      }

    case 'content_delta':
      if (typeof event.text !== 'string' || event.text.length === 0) {
        return state
      }
      return appendAssistantDelta(state, event.text, makeId)

    case 'message_complete':
      return {
        ...state,
        streamingAssistantId: null,
        sending: false,
      }

    case 'status':
      if (event.state === 'idle') {
        return {
          ...state,
          streamingAssistantId: null,
          sending: false,
        }
      }
      if (
        event.state === 'thinking' ||
        event.state === 'streaming' ||
        event.state === 'tool_executing' ||
        event.state === 'compacting'
      ) {
        return {
          ...state,
          sending: true,
        }
      }
      return state

    case 'permission_mode_changed':
      if (isPermissionMode(event.mode)) {
        return {
          ...state,
          permissionMode: event.mode,
        }
      }
      return state

    case 'permission_request':
      return {
        ...state,
        sending: false,
        pendingPermission: {
          requestId: String(event.requestId || ''),
          toolName: String(event.toolName || 'Tool'),
          input: event.input,
          ...(typeof event.description === 'string' ? { description: event.description } : {}),
        },
      }

    case 'error':
      return {
        ...state,
        streamingAssistantId: null,
        sending: false,
        pendingPermission: null,
        messages: [
          ...state.messages,
          {
            id: createMessageId('error'),
            type: 'system',
            content: event.message || 'Remote session error',
            timestamp: new Date().toISOString(),
          },
        ],
      }

    case 'connected':
    case 'content_start':
    case 'tool_use_complete':
    case 'tool_result':
    case 'thinking':
    case 'pong':
      return state

    default:
      return state
  }
}

export function isPermissionMode(mode: unknown): mode is PermissionMode {
  return (
    mode === 'default' ||
    mode === 'acceptEdits' ||
    mode === 'plan' ||
    mode === 'bypassPermissions' ||
    mode === 'dontAsk'
  )
}

export type ProjectSessionGroup = {
  key: string
  name: string
  path: string
  sessions: SessionListItem[]
}

export function groupSessionsByProject(sessions: SessionListItem[]): ProjectSessionGroup[] {
  const groups = new Map<string, ProjectSessionGroup>()

  for (const session of sessions) {
    const path = session.workDir || session.projectPath || 'Unknown project'
    const key = path
    const current = groups.get(key)
    if (current) {
      current.sessions.push(session)
      continue
    }

    groups.set(key, {
      key,
      name: projectNameFromPath(path),
      path,
      sessions: [session],
    })
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function projectNameFromPath(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const name = normalized.split('/').filter(Boolean).pop()
  return name || projectPath || 'Unknown'
}

function appendAssistantDelta(
  state: RemoteMessageState,
  text: string,
  makeId: IdFactory,
): RemoteMessageState {
  const streamingId = state.streamingAssistantId || makeId()
  const existingIndex = state.messages.findIndex((message) => message.id === streamingId)

  if (existingIndex >= 0) {
    const existing = state.messages[existingIndex]!
    const updated: MessageEntry = {
      ...existing,
      content: `${typeof existing.content === 'string' ? existing.content : ''}${text}`,
    }
    return {
      ...state,
      streamingAssistantId: streamingId,
      messages: [
        ...state.messages.slice(0, existingIndex),
        updated,
        ...state.messages.slice(existingIndex + 1),
      ],
    }
  }

  return {
    ...state,
    streamingAssistantId: streamingId,
    messages: [
      ...state.messages,
      {
        id: streamingId,
        type: 'assistant',
        content: text,
        timestamp: new Date().toISOString(),
      },
    ],
  }
}
