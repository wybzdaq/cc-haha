import React, { useEffect, useState } from 'react'
import {
  View,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  ScrollView,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { useSessionStore } from '../stores/sessionStore'
import MessageList from '../components/chat/MessageList'
import ChatInput from '../components/chat/ChatInput'
import { modelsApi } from '../api/models'
import { wsManager } from '../api/websocket'
import {
  buildPermissionModePayload,
  buildPermissionResponsePayload,
  buildRuntimeConfigPayload,
  buildStopGenerationPayload,
  buildUserMessagePayload,
  createLocalUserMessage,
  type PermissionMode,
  projectNameFromPath,
} from '../lib/serverEvents'
import type { ModelInfo } from '../types/model'

const PERMISSION_MODES: Array<{ mode: PermissionMode; label: string }> = [
  { mode: 'default', label: 'Default' },
  { mode: 'acceptEdits', label: 'Accept' },
  { mode: 'plan', label: 'Plan' },
  { mode: 'bypassPermissions', label: 'Bypass' },
]

export default function ChatScreen() {
  const navigation = useNavigation()
  const {
    activeSessionId,
    activeMessages,
    sessions,
    appendMessage,
    setSending,
    clearPendingPermission,
    permissionMode,
    setPermissionMode,
    pendingPermission,
    isSending,
    isLoadingMessages,
    loadSession,
  } = useSessionStore()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const projectPath = activeSession?.workDir || activeSession?.projectPath || ''
  const projectName = projectPath ? projectNameFromPath(projectPath) : 'Remote project'

  useEffect(() => {
    if (!activeSessionId) {
      navigation.goBack()
    }
  }, [activeSessionId, navigation])

  useEffect(() => {
    let cancelled = false

    async function loadModels() {
      setModelsLoading(true)
      try {
        const [list, current] = await Promise.all([
          modelsApi.list(),
          modelsApi.getCurrent(),
        ])
        if (cancelled) return
        setModels(list.models)
        setActiveProviderId(list.provider?.id ?? null)
        setSelectedModelId(current.model?.id ?? list.models[0]?.id ?? null)
      } catch {
        if (!cancelled) {
          setModels([])
          setActiveProviderId(null)
          setSelectedModelId(null)
        }
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    }

    void loadModels()

    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  const handleSend = async (text: string) => {
    if (!activeSessionId || !text.trim()) return

    appendMessage(createLocalUserMessage(text))
    setSending(true)
    wsManager.send(activeSessionId, buildUserMessagePayload(text))
  }

  const handleStopGeneration = () => {
    if (!activeSessionId) return
    wsManager.send(activeSessionId, buildStopGenerationPayload())
    setSending(false)
  }

  const handlePermissionModeChange = (mode: PermissionMode) => {
    if (!activeSessionId) return
    setPermissionMode(mode)
    wsManager.send(activeSessionId, buildPermissionModePayload(mode))
  }

  const handleModelChange = (model: ModelInfo) => {
    if (!activeSessionId) return
    setSelectedModelId(model.id)
    wsManager.send(
      activeSessionId,
      buildRuntimeConfigPayload({
        providerId: activeProviderId,
        modelId: model.id,
      }),
    )
  }

  const respondToPermission = (allowed: boolean, allowForSession = false) => {
    if (!activeSessionId || !pendingPermission) return
    wsManager.send(
      activeSessionId,
      buildPermissionResponsePayload(
        pendingPermission.requestId,
        allowed,
        allowForSession ? { rule: 'always' } : undefined,
      ),
    )
    clearPendingPermission()
    setSending(allowed)
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#172033" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.projectName} numberOfLines={1}>{projectName}</Text>
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {activeSession?.title || 'Remote session'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => {
            if (activeSessionId) {
              loadSession(activeSessionId)
            }
          }}
        >
          <Ionicons name="refresh" size={21} color="#172033" />
        </TouchableOpacity>
      </View>

      {projectPath ? (
        <View style={styles.pathStrip}>
          <Ionicons name="folder-outline" size={14} color="#52627A" />
          <Text style={styles.pathText} numberOfLines={1}>{projectPath}</Text>
        </View>
      ) : null}

      <View style={styles.modelStrip}>
        <View style={styles.modelHeader}>
          <Text style={styles.modelLabel}>Model</Text>
          {modelsLoading ? <ActivityIndicator size="small" color="#607089" /> : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modelScroller}
        >
          {models.length === 0 && !modelsLoading ? (
            <Text style={styles.modelEmpty}>No models available</Text>
          ) : null}
          {models.map((model) => {
            const active = selectedModelId === model.id
            return (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelChip, active && styles.modelChipActive]}
                onPress={() => handleModelChange(model)}
              >
                <Text style={[styles.modelChipText, active && styles.modelChipTextActive]} numberOfLines={1}>
                  {model.name || model.id}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>

      <View style={styles.controlStrip}>
        <TouchableOpacity
          style={[styles.stopButton, !isSending && styles.controlDisabled]}
          disabled={!isSending}
          onPress={handleStopGeneration}
        >
          <Ionicons name="stop" size={15} color={isSending ? '#FFFFFF' : '#7A8798'} />
          <Text style={[styles.stopButtonText, !isSending && styles.controlDisabledText]}>
            Stop
          </Text>
        </TouchableOpacity>
        <View style={styles.modeGroup}>
          {PERMISSION_MODES.map((item) => {
            const active = permissionMode === item.mode
            return (
              <TouchableOpacity
                key={item.mode}
                style={[styles.modeButton, active && styles.modeButtonActive]}
                onPress={() => handlePermissionModeChange(item.mode)}
              >
                <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      {isLoadingMessages ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#172033" />
          <Text style={styles.loadingText}>Loading conversation...</Text>
        </View>
      ) : (
        <View style={styles.content}>
          <MessageList messages={activeMessages} isLoading={isSending} />
          {pendingPermission ? (
            <View style={styles.permissionPanel}>
              <View style={styles.permissionIcon}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#172033" />
              </View>
              <View style={styles.permissionBody}>
                <Text style={styles.permissionTitle}>
                  Allow {pendingPermission.toolName}?
                </Text>
                <Text style={styles.permissionText} numberOfLines={3}>
                  {pendingPermission.description || summarizePermissionInput(pendingPermission.input)}
                </Text>
                <View style={styles.permissionActions}>
                  <TouchableOpacity
                    style={[styles.permissionButton, styles.denyButton]}
                    onPress={() => respondToPermission(false)}
                  >
                    <Text style={styles.denyButtonText}>Deny</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.permissionButton, styles.sessionAllowButton]}
                    onPress={() => respondToPermission(true, true)}
                  >
                    <Text style={styles.sessionAllowButtonText}>Allow Session</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.permissionButton, styles.allowButton]}
                    onPress={() => respondToPermission(true)}
                  >
                    <Text style={styles.allowButtonText}>Allow</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : null}
          <ChatInput onSend={handleSend} disabled={isSending || !!pendingPermission} />
        </View>
      )}
    </SafeAreaView>
  )
}

function summarizePermissionInput(input: unknown): string {
  if (!input || typeof input !== 'object') return 'The assistant wants to run a protected action.'
  const record = input as Record<string, unknown>
  const path = record.file_path || record.path || record.command
  return typeof path === 'string'
    ? `The assistant wants permission for ${path}.`
    : 'The assistant wants to run a protected action.'
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EEF2F6',
  },
  header: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F9FBFC',
    borderBottomWidth: 1,
    borderBottomColor: '#DDE5EE',
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#E7EDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
  },
  projectName: {
    color: '#172033',
    fontSize: 17,
    fontWeight: '800',
  },
  sessionTitle: {
    marginTop: 2,
    color: '#607089',
    fontSize: 12,
    fontWeight: '700',
  },
  pathStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#DCE7F3',
  },
  pathText: {
    flex: 1,
    color: '#52627A',
    fontSize: 12,
    fontWeight: '600',
  },
  modelStrip: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: '#F9FBFC',
    borderBottomWidth: 1,
    borderBottomColor: '#DDE5EE',
  },
  modelHeader: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelLabel: {
    color: '#52627A',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  modelScroller: {
    gap: 8,
    paddingTop: 7,
  },
  modelEmpty: {
    color: '#7A8798',
    fontSize: 12,
    fontWeight: '700',
    paddingVertical: 5,
  },
  modelChip: {
    maxWidth: 180,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#E7EDF4',
    borderWidth: 1,
    borderColor: '#D7E0EA',
  },
  modelChipActive: {
    backgroundColor: '#172033',
    borderColor: '#172033',
  },
  modelChipText: {
    color: '#52627A',
    fontSize: 12,
    fontWeight: '800',
  },
  modelChipTextActive: {
    color: '#FFFFFF',
  },
  controlStrip: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F9FBFC',
    borderBottomWidth: 1,
    borderBottomColor: '#DDE5EE',
  },
  stopButton: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#C2410C',
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  controlDisabled: {
    backgroundColor: '#E7EDF4',
  },
  controlDisabledText: {
    color: '#7A8798',
  },
  modeGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeButton: {
    flex: 1,
    minWidth: 0,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7EDF4',
    borderWidth: 1,
    borderColor: '#D7E0EA',
  },
  modeButtonActive: {
    backgroundColor: '#172033',
    borderColor: '#172033',
  },
  modeButtonText: {
    color: '#52627A',
    fontSize: 11,
    fontWeight: '800',
  },
  modeButtonTextActive: {
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
    backgroundColor: '#EEF2F6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#607089',
  },
  permissionPanel: {
    marginHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  permissionIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FED7AA',
  },
  permissionBody: {
    flex: 1,
  },
  permissionTitle: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '800',
  },
  permissionText: {
    marginTop: 4,
    color: '#7C4A1D',
    fontSize: 12,
    lineHeight: 17,
  },
  permissionActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  permissionButton: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  denyButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  allowButton: {
    backgroundColor: '#172033',
  },
  sessionAllowButton: {
    backgroundColor: '#FED7AA',
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  denyButtonText: {
    color: '#9A3412',
    fontSize: 14,
    fontWeight: '800',
  },
  allowButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  sessionAllowButtonText: {
    color: '#9A3412',
    fontSize: 13,
    fontWeight: '800',
  },
})
