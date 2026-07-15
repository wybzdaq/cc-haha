import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { checkConnection, initBaseUrl } from '../api/client'
import { filesystemApi, type RemoteFilesystemEntry } from '../api/filesystem'
import { sessionsApi } from '../api/sessions'
import { DEFAULT_WORK_DIR } from '../constants/config'
import { canBrowseParent, directoryEntriesOnly } from '../lib/folderPicker'
import {
  chooseDefaultWorkDir,
  runForegroundConnection,
  shouldConnectForAppState,
  type ForegroundConnectionStatus,
  type MobileAppState,
} from '../lib/foregroundConnection'
import { groupSessionsByProject, projectNameFromPath } from '../lib/serverEvents'
import { useSessionStore } from '../stores/sessionStore'
import type { RecentProject, SessionListItem } from '../types/session'

type RootStackParamList = {
  SessionList: undefined
  Chat: undefined
  ServerConfig: undefined
  QrScanner: undefined
}

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SessionList'>
type IconName = React.ComponentProps<typeof Ionicons>['name']
type FilterOption = {
  key: string
  label: string
  icon: IconName
  disabled?: boolean
}

export default function SessionListScreen() {
  const navigation = useNavigation<NavigationProp>()
  const {
    sessions,
    isLoading,
    fetchSessions,
    loadSession,
    createSession,
    deleteSession,
  } = useSessionStore()
  const groups = useMemo(() => groupSessionsByProject(sessions), [sessions])
  const [selectedFilterKey, setSelectedFilterKey] = useState('all')
  const [menuOpen, setMenuOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [workDirDraft, setWorkDirDraft] = useState(DEFAULT_WORK_DIR)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [recentProjectsLoading, setRecentProjectsLoading] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [folderCurrentPath, setFolderCurrentPath] = useState('')
  const [folderParentPath, setFolderParentPath] = useState('')
  const [folderEntries, setFolderEntries] = useState<RemoteFilesystemEntry[]>([])
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<ForegroundConnectionStatus>('checking')
  const [connectionMessage, setConnectionMessage] = useState('Connecting to Windows desktop...')
  const appStateRef = useRef<MobileAppState | null>(null)
  const connectingRef = useRef(false)
  const mountedRef = useRef(true)

  const connectToDesktop = useCallback(async () => {
    if (connectingRef.current) return
    connectingRef.current = true
    setConnectionStatus('checking')
    setConnectionMessage('Connecting to Windows desktop...')

    try {
      const result = await runForegroundConnection({
        initBaseUrl,
        testConnection: checkConnection,
        fetchSessions: () => fetchSessions(),
      })

      if (!mountedRef.current) return
      setConnectionStatus(result.status)
      setConnectionMessage(result.message)
    } catch (error) {
      if (!mountedRef.current) return
      setConnectionStatus('failed')
      setConnectionMessage((error as Error).message || 'Windows desktop is not reachable')
    } finally {
      connectingRef.current = false
    }
  }, [fetchSessions])

  useEffect(() => {
    mountedRef.current = true
    const currentState = AppState.currentState as MobileAppState
    appStateRef.current = currentState

    if (shouldConnectForAppState(null, currentState)) {
      void connectToDesktop()
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      const typedNextState = nextState as MobileAppState
      if (shouldConnectForAppState(appStateRef.current, typedNextState)) {
        void connectToDesktop()
      }
      appStateRef.current = typedNextState
    })

    return () => {
      mountedRef.current = false
      subscription.remove()
    }
  }, [connectToDesktop])

  useEffect(() => {
    if (
      selectedFilterKey.startsWith('project:')
      && !groups.some((group) => `project:${group.key}` === selectedFilterKey)
    ) {
      setSelectedFilterKey('all')
    }
  }, [groups, selectedFilterKey])

  const filterOptions = useMemo<FilterOption[]>(() => [
    { key: 'all', label: 'All sessions', icon: 'grid-outline' },
    { key: 'cloud', label: 'Cloud', icon: 'cloud-outline' },
    ...groups.map((group) => ({
      key: `project:${group.key}`,
      label: group.name,
      icon: 'laptop-outline' as const,
      disabled: group.sessions.length === 0,
    })),
  ], [groups])
  const selectedFilter = filterOptions.find((option) => option.key === selectedFilterKey) ?? filterOptions[0]!
  const selectedProject = selectedFilterKey.startsWith('project:')
    ? groups.find((group) => `project:${group.key}` === selectedFilterKey)
    : null
  const visibleSessions = selectedProject?.sessions ?? sessions

  const loadRecentProjects = async () => {
    setRecentProjectsLoading(true)
    try {
      const response = await sessionsApi.getRecentProjects(12)
      setRecentProjects(response.projects)
      return response.projects
    } catch {
      setRecentProjects([])
      return []
    } finally {
      setRecentProjectsLoading(false)
    }
  }

  const openNewSession = async () => {
    setNewSessionOpen(true)
    setFolderPickerOpen(false)
    setFolderError('')
    const projects = await loadRecentProjects()
    setWorkDirDraft(chooseDefaultWorkDir({
      selectedProjectPath: selectedProject?.path,
      recentProjects: projects,
      fallbackWorkDir: DEFAULT_WORK_DIR,
    }))
  }

  const loadFolder = async (path?: string) => {
    setFolderLoading(true)
    setFolderError('')
    try {
      const listing = await filesystemApi.browse(path)
      setFolderCurrentPath(listing.currentPath)
      setFolderParentPath(listing.parentPath)
      setFolderEntries(directoryEntriesOnly(listing.entries))
    } catch (error) {
      setFolderEntries([])
      setFolderError((error as Error).message || 'Failed to read this folder')
    } finally {
      setFolderLoading(false)
    }
  }

  const openFolderPicker = () => {
    setFolderPickerOpen(true)
    void loadFolder(workDirDraft)
  }

  const handleUseCurrentFolder = () => {
    if (!folderCurrentPath) return
    setWorkDirDraft(folderCurrentPath)
    setFolderPickerOpen(false)
  }

  const handleCreateSession = async (workDir = workDirDraft) => {
    const trimmed = workDir.trim()
    if (!trimmed) {
      Alert.alert('Missing folder', 'Enter a Windows folder path first.')
      return
    }

    setCreatingSession(true)
    try {
      await createSession(trimmed)
      setNewSessionOpen(false)
      navigation.navigate('Chat')
    } catch (error) {
      Alert.alert('Create failed', (error as Error).message || 'Failed to create session')
    } finally {
      setCreatingSession(false)
    }
  }

  const handleSessionPress = async (sessionId: string) => {
    try {
      await loadSession(sessionId)
      navigation.navigate('Chat')
    } catch {
      Alert.alert('Error', 'Failed to load session')
    }
  }

  const handleDeleteSession = (sessionId: string) => {
    Alert.alert('Delete Session', 'Delete this remote session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSession(sessionId)
          } catch {
            Alert.alert('Error', 'Failed to delete session')
          }
        },
      },
    ])
  }

  const handleSelectFilter = (option: FilterOption) => {
    if (option.disabled) return
    setSelectedFilterKey(option.key)
    setMenuOpen(false)
  }

  const handleManualRefresh = () => {
    if (connectionStatus === 'failed') {
      void connectToDesktop()
      return
    }
    void fetchSessions()
  }

  const renderSession = ({ item }: { item: SessionListItem }) => (
    <TouchableOpacity
      onPress={() => handleSessionPress(item.id)}
      onLongPress={() => handleDeleteSession(item.id)}
      style={styles.sessionRow}
    >
      <View style={styles.sessionIconWrap}>
        <Ionicons name={iconForSession(item)} size={23} color="#222222" />
      </View>
      <View style={styles.sessionBody}>
        <View style={styles.sessionTitleRow}>
          <Text style={styles.sessionTitle} numberOfLines={1}>{item.title || 'Untitled session'}</Text>
          <Text style={styles.sessionDate}>{formatTaskDate(item.modifiedAt)}</Text>
        </View>
        <View style={styles.sessionMetaRow}>
          <Ionicons name={item.workDirExists ? 'git-branch-outline' : 'warning-outline'} size={13} color="#8D8D8D" />
          <Text style={styles.sessionMeta} numberOfLines={1}>{formatTaskMeta(item)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.titleButton} onPress={() => setMenuOpen((open) => !open)}>
          <Text style={styles.title}>{selectedFilter.label}</Text>
          <Ionicons name={menuOpen ? 'caret-up' : 'caret-down'} size={14} color="#111111" />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity
            accessibilityLabel="Refresh sessions"
            style={styles.toolButton}
            onPress={handleManualRefresh}
          >
            <Ionicons name="refresh-outline" size={22} color="#172033" />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Scan desktop QR"
            style={styles.toolButton}
            onPress={() => navigation.navigate('QrScanner')}
          >
            <Ionicons name="qr-code-outline" size={22} color="#172033" />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Connection settings"
            style={styles.toolButton}
            onPress={() => navigation.navigate('ServerConfig')}
          >
            <Ionicons name="settings-outline" size={22} color="#172033" />
          </TouchableOpacity>
        </View>

        {menuOpen ? (
          <View style={styles.filterMenu}>
            {filterOptions.slice(0, 8).map((option) => {
              const selected = option.key === selectedFilter.key
              return (
                <Pressable
                  key={option.key}
                  onPress={() => handleSelectFilter(option)}
                  style={[styles.filterOption, option.disabled && styles.filterOptionDisabled]}
                >
                  <Ionicons name={option.icon} size={22} color={option.disabled ? '#A5A5A5' : '#222222'} />
                  <Text
                    style={[styles.filterLabel, option.disabled && styles.filterLabelDisabled]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark-circle-outline" size={22} color="#37308D" />
                  ) : null}
                </Pressable>
              )
            })}
          </View>
        ) : null}
      </View>

      {menuOpen ? (
        <Pressable style={styles.menuScrim} onPress={() => setMenuOpen(false)} />
      ) : null}

      <View style={styles.body}>
        <View style={[
          styles.connectionBanner,
          connectionStatus === 'connected' && styles.connectionBannerConnected,
          connectionStatus === 'failed' && styles.connectionBannerFailed,
        ]}>
          {connectionStatus === 'checking' ? (
            <ActivityIndicator size="small" color="#52627A" />
          ) : (
            <Ionicons
              name={connectionStatus === 'connected' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={connectionStatus === 'connected' ? '#237A4B' : '#A33A2E'}
            />
          )}
          <Text style={[
            styles.connectionText,
            connectionStatus === 'connected' && styles.connectionTextConnected,
            connectionStatus === 'failed' && styles.connectionTextFailed,
          ]} numberOfLines={1}>
            {connectionMessage}
          </Text>
          {connectionStatus === 'failed' ? (
            <TouchableOpacity style={styles.retryButton} onPress={() => void connectToDesktop()}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {isLoading && sessions.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6D4BD8" />
            <Text style={styles.loadingText}>Loading sessions...</Text>
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.emptyContainer}>
            {connectionStatus === 'failed' ? (
              <>
                <Ionicons name="wifi-outline" size={56} color="#BBBBBB" />
                <Text style={styles.emptyText}>Not connected</Text>
                <Text style={styles.emptySubtext}>
                  Scan the Windows QR code, check the IP/token, or retry the desktop connection.
                </Text>
                <View style={styles.emptyActions}>
                  <TouchableOpacity
                    style={[styles.emptyPrimaryButton, styles.emptyActionButton]}
                    onPress={() => navigation.navigate('QrScanner')}
                  >
                    <Text style={styles.emptyPrimaryButtonText}>Scan QR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.emptySecondaryButton, styles.emptyActionButton]}
                    onPress={() => void connectToDesktop()}
                  >
                    <Text style={styles.emptySecondaryButtonText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Ionicons name="document-text-outline" size={56} color="#BBBBBB" />
                <Text style={styles.emptyText}>No sessions yet</Text>
                <Text style={styles.emptySubtext}>
                  Windows is connected. Create a remote session from a recent project.
                </Text>
                <TouchableOpacity style={styles.emptyPrimaryButton} onPress={() => void openNewSession()}>
                  <Text style={styles.emptyPrimaryButtonText}>New session</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <FlatList
            data={visibleSessions}
            keyExtractor={(item) => item.id}
            renderItem={renderSession}
            contentContainerStyle={styles.sessionList}
            refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => fetchSessions()} tintColor="#6D4BD8" />}
            showsVerticalScrollIndicator={false}
          />
        )}

        <TouchableOpacity style={styles.floatingButton} onPress={() => void openNewSession()}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <Modal
        visible={newSessionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNewSessionOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setNewSessionOpen(false)}>
          <Pressable style={styles.newSessionPanel}>
            <Text style={styles.modalTitle}>New remote session</Text>
            <Text style={styles.modalSubtitle}>
              Choose a Windows folder. Android sends this path to the desktop server.
            </Text>

            <Text style={styles.inputLabel}>Windows folder path</Text>
            <View style={styles.pathInputRow}>
              <TextInput
                value={workDirDraft}
                onChangeText={setWorkDirDraft}
                placeholder="D:\\Code\\Ai\\cc-haha"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.pathInput}
              />
              <TouchableOpacity
                accessibilityLabel="Browse Windows folders"
                style={styles.browseButton}
                onPress={openFolderPicker}
              >
                <Ionicons name="folder-open-outline" size={21} color="#172033" />
              </TouchableOpacity>
            </View>

            {folderPickerOpen ? (
              <View style={styles.folderPickerPanel}>
                <View style={styles.folderPickerHeader}>
                  <View style={styles.folderPathBlock}>
                    <Text style={styles.folderPickerTitle}>Computer folders</Text>
                    <Text style={styles.folderPathText} numberOfLines={1}>
                      {folderCurrentPath || workDirDraft || 'Windows home'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityLabel="Close folder picker"
                    style={styles.folderIconButton}
                    onPress={() => setFolderPickerOpen(false)}
                  >
                    <Ionicons name="close-outline" size={22} color="#52627A" />
                  </TouchableOpacity>
                </View>

                <View style={styles.folderToolbar}>
                  <TouchableOpacity
                    style={[
                      styles.folderToolbarButton,
                      !canBrowseParent(folderCurrentPath, folderParentPath) && styles.folderToolbarButtonDisabled,
                    ]}
                    disabled={!canBrowseParent(folderCurrentPath, folderParentPath) || folderLoading}
                    onPress={() => loadFolder(folderParentPath)}
                  >
                    <Ionicons name="arrow-up-outline" size={16} color="#172033" />
                    <Text style={styles.folderToolbarText}>Parent</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.folderToolbarButton}
                    disabled={folderLoading}
                    onPress={() => loadFolder(folderCurrentPath || workDirDraft)}
                  >
                    <Ionicons name="refresh-outline" size={16} color="#172033" />
                    <Text style={styles.folderToolbarText}>Refresh</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.folderToolbarButton, styles.folderUseButton]}
                    disabled={!folderCurrentPath}
                    onPress={handleUseCurrentFolder}
                  >
                    <Ionicons name="checkmark-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.folderUseButtonText}>Use</Text>
                  </TouchableOpacity>
                </View>

                {folderLoading ? (
                  <View style={styles.folderLoadingRow}>
                    <ActivityIndicator size="small" color="#6539C9" />
                    <Text style={styles.folderHintText}>Reading this folder...</Text>
                  </View>
                ) : folderError ? (
                  <View style={styles.folderErrorBox}>
                    <Text style={styles.folderErrorText}>{folderError}</Text>
                    <TouchableOpacity onPress={() => loadFolder(undefined)}>
                      <Text style={styles.folderErrorAction}>Open Windows home</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ScrollView style={styles.folderList} keyboardShouldPersistTaps="handled">
                    {folderEntries.length === 0 ? (
                      <Text style={styles.folderHintText}>No child folders here.</Text>
                    ) : null}
                    {folderEntries.map((entry) => (
                      <TouchableOpacity
                        key={entry.path}
                        style={styles.folderRow}
                        onPress={() => loadFolder(entry.path)}
                      >
                        <Ionicons name="folder-outline" size={18} color="#52627A" />
                        <Text style={styles.folderRowText} numberOfLines={1}>{entry.name}</Text>
                        <Ionicons name="chevron-forward-outline" size={18} color="#9BA8B7" />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : null}

            <View style={styles.modalSectionHeader}>
              <Text style={styles.recentTitle}>Recent projects</Text>
              {recentProjectsLoading ? <ActivityIndicator size="small" color="#6539C9" /> : null}
            </View>

            <ScrollView
              style={[styles.recentList, folderPickerOpen && styles.recentListCompact]}
              keyboardShouldPersistTaps="handled"
            >
              {recentProjects.length === 0 && !recentProjectsLoading ? (
                <Text style={styles.noRecentText}>No recent projects from Windows yet.</Text>
              ) : null}
              {recentProjects.map((project) => (
                <TouchableOpacity
                  key={project.projectPath}
                  style={styles.recentProjectRow}
                  onPress={() => setWorkDirDraft(project.projectPath)}
                >
                  <Ionicons name="folder-outline" size={18} color="#52627A" />
                  <View style={styles.recentProjectText}>
                    <Text style={styles.recentProjectName} numberOfLines={1}>
                      {projectNameFromPath(project.projectPath)}
                    </Text>
                    <Text style={styles.recentProjectPath} numberOfLines={1}>
                      {project.projectPath}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                disabled={creatingSession}
                onPress={() => setNewSessionOpen(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.createButton, creatingSession && styles.createButtonDisabled]}
                disabled={creatingSession}
                onPress={() => handleCreateSession()}
              >
                <Text style={styles.createButtonText}>
                  {creatingSession ? 'Creating...' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

function iconForSession(item: SessionListItem): IconName {
  const text = `${item.title} ${item.workDir || item.projectPath}`.toLowerCase()
  if (text.includes('game') || text.includes('smartpanel') || text.includes('kpi')) {
    return 'bar-chart-outline'
  }
  if (text.includes('scene') || text.includes('doc') || text.includes('readme')) {
    return 'book-outline'
  }
  if (text.includes('android') || text.includes('mobile')) {
    return 'phone-portrait-outline'
  }
  return 'document-text-outline'
}

function formatTaskMeta(item: SessionListItem) {
  const path = item.workDir || item.projectPath || ''
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  const projectParts = parts.slice(-2)
  const location = projectParts.length > 0 ? projectParts.join(' / ') : 'Cloud'
  return `${item.messageCount} messages / ${location}`
}

function formatTaskDate(dateString: string) {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    position: 'relative',
    zIndex: 20,
    minHeight: 92,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
  },
  titleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '54%',
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '900',
    color: '#111111',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#EEF3F8',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DDE6EF',
  },
  filterMenu: {
    position: 'absolute',
    top: 78,
    left: 28,
    right: 28,
    zIndex: 30,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  filterOption: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECECEC',
  },
  filterOptionDisabled: {
    opacity: 0.58,
  },
  filterLabel: {
    flex: 1,
    color: '#222222',
    fontSize: 17,
    fontWeight: '500',
  },
  filterLabelDisabled: {
    color: '#8F8F8F',
  },
  menuScrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: 'transparent',
  },
  body: {
    flex: 1,
    zIndex: 1,
  },
  connectionBanner: {
    minHeight: 42,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDE6EF',
    backgroundColor: '#F7FAFD',
  },
  connectionBannerConnected: {
    borderColor: '#CDEBDD',
    backgroundColor: '#F3FBF7',
  },
  connectionBannerFailed: {
    borderColor: '#F2D2CC',
    backgroundColor: '#FFF7F5',
  },
  connectionText: {
    flex: 1,
    color: '#52627A',
    fontSize: 13,
    fontWeight: '700',
  },
  connectionTextConnected: {
    color: '#237A4B',
  },
  connectionTextFailed: {
    color: '#A33A2E',
  },
  retryButton: {
    minWidth: 54,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#172033',
    paddingHorizontal: 10,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  sessionList: {
    paddingBottom: 92,
  },
  sessionRow: {
    minHeight: 91,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 31,
    paddingRight: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEAEA',
  },
  sessionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: 15,
    backgroundColor: '#F3F3F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionBody: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  sessionTitle: {
    flex: 1,
    color: '#151515',
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
  },
  sessionDate: {
    color: '#858585',
    fontSize: 14,
    lineHeight: 21,
  },
  sessionMetaRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sessionMeta: {
    flex: 1,
    color: '#898989',
    fontSize: 13,
    lineHeight: 18,
  },
  floatingButton: {
    position: 'absolute',
    right: 28,
    bottom: 27,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#6539C9',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#777777',
  },
  emptyContainer: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 16,
    color: '#151515',
    fontSize: 20,
    fontWeight: '800',
  },
  emptySubtext: {
    marginTop: 8,
    color: '#777777',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyActions: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 10,
  },
  emptyPrimaryButton: {
    marginTop: 18,
    minWidth: 128,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#172033',
    paddingHorizontal: 16,
  },
  emptyPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  emptySecondaryButton: {
    minWidth: 108,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7EDF4',
    paddingHorizontal: 16,
  },
  emptyActionButton: {
    marginTop: 0,
  },
  emptySecondaryButtonText: {
    color: '#172033',
    fontSize: 14,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  newSessionPanel: {
    maxHeight: '82%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  modalTitle: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '900',
  },
  modalSubtitle: {
    marginTop: 6,
    color: '#607089',
    fontSize: 13,
    lineHeight: 19,
  },
  inputLabel: {
    marginTop: 18,
    marginBottom: 8,
    color: '#172033',
    fontSize: 13,
    fontWeight: '800',
  },
  pathInput: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    backgroundColor: '#F9FBFC',
    paddingHorizontal: 12,
    color: '#172033',
    fontSize: 14,
  },
  pathInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  browseButton: {
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    backgroundColor: '#EEF3F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderPickerPanel: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDE6EF',
    backgroundColor: '#F8FBFD',
    padding: 12,
  },
  folderPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  folderPathBlock: {
    flex: 1,
    minWidth: 0,
  },
  folderPickerTitle: {
    color: '#172033',
    fontSize: 13,
    fontWeight: '900',
  },
  folderPathText: {
    marginTop: 3,
    color: '#607089',
    fontSize: 12,
  },
  folderIconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8EFF6',
  },
  folderToolbar: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  folderToolbarButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 8,
    backgroundColor: '#E8EFF6',
    paddingHorizontal: 10,
  },
  folderToolbarButtonDisabled: {
    opacity: 0.45,
  },
  folderToolbarText: {
    color: '#172033',
    fontSize: 12,
    fontWeight: '800',
  },
  folderUseButton: {
    marginLeft: 'auto',
    backgroundColor: '#172033',
  },
  folderUseButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  folderLoadingRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  folderList: {
    marginTop: 8,
    maxHeight: 180,
  },
  folderRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DFE8F1',
  },
  folderRowText: {
    flex: 1,
    color: '#172033',
    fontSize: 14,
    fontWeight: '700',
  },
  folderHintText: {
    color: '#607089',
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 10,
  },
  folderErrorBox: {
    marginTop: 10,
    borderRadius: 8,
    backgroundColor: '#FFF7F5',
    padding: 10,
  },
  folderErrorText: {
    color: '#A33A2E',
    fontSize: 12,
    lineHeight: 18,
  },
  folderErrorAction: {
    marginTop: 6,
    color: '#172033',
    fontSize: 12,
    fontWeight: '900',
  },
  modalSectionHeader: {
    marginTop: 16,
    marginBottom: 8,
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentTitle: {
    color: '#172033',
    fontSize: 13,
    fontWeight: '800',
  },
  recentList: {
    maxHeight: 240,
  },
  recentListCompact: {
    maxHeight: 120,
  },
  noRecentText: {
    color: '#607089',
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 10,
  },
  recentProjectRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6EDF4',
  },
  recentProjectText: {
    flex: 1,
    minWidth: 0,
  },
  recentProjectName: {
    color: '#172033',
    fontSize: 14,
    fontWeight: '800',
  },
  recentProjectPath: {
    marginTop: 2,
    color: '#607089',
    fontSize: 12,
  },
  modalActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#E7EDF4',
  },
  cancelButtonText: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '800',
  },
  createButton: {
    backgroundColor: '#172033',
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
})
