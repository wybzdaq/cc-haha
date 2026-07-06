
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator } from 'react-native'
import Button from '../components/shared/Button'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { initBaseUrl, testConnection } from '../api/client'
import { useSessionStore } from '../stores/sessionStore'

type RootStackParamList = {
  Home: undefined
  SessionList: undefined
  Chat: undefined
  ServerConfig: undefined
}

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp>()
  const fetchSessions = useSessionStore((state) => state.fetchSessions)
  const [autoConnectStatus, setAutoConnectStatus] = useState<'checking' | 'connected' | 'failed'>('checking')
  const [autoConnectMessage, setAutoConnectMessage] = useState('Connecting to desktop server...')

  useEffect(() => {
    let cancelled = false

    async function connectOnLaunch() {
      setAutoConnectStatus('checking')
      setAutoConnectMessage('Connecting to desktop server...')
      await initBaseUrl()

      const connected = await testConnection()
      if (cancelled) return

      if (!connected) {
        setAutoConnectStatus('failed')
        setAutoConnectMessage('Desktop server is not reachable. Check the server URL, token, Wi-Fi, and firewall.')
        return
      }

      setAutoConnectStatus('connected')
      setAutoConnectMessage('Connected. Loading sessions...')
      await fetchSessions()
      if (!cancelled) {
        navigation.navigate('SessionList')
      }
    }

    void connectOnLaunch()

    return () => {
      cancelled = true
    }
  }, [fetchSessions, navigation])

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content}>
        <Text style={styles.title}>Claude Haha</Text>
        <Text style={styles.subtitle}>Remote AI Assistant</Text>
        
        <View style={styles.buttonContainer}>
          <View style={styles.statusCard}>
            {autoConnectStatus === 'checking' ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : null}
            <Text style={[
              styles.statusText,
              autoConnectStatus === 'connected' && styles.statusConnected,
              autoConnectStatus === 'failed' && styles.statusFailed,
            ]}>
              {autoConnectMessage}
            </Text>
          </View>
          <Button
            title="View Sessions"
            onPress={() => navigation.navigate('SessionList')}
            style={styles.primaryButton}
          />
          <Button
            title="New Chat"
            onPress={() => navigation.navigate('SessionList')}
            style={styles.secondaryButton}
          />
          <Button
            title="Server Configuration"
            onPress={() => navigation.navigate('ServerConfig')}
            style={styles.tertiaryButton}
          />
        </View>

        <View style={styles.infoContainer}>
          <Text style={styles.infoTitle}>How It Works</Text>
          <Text style={styles.infoText}>
            1. Ensure your phone and computer are on the same Wi-Fi network
          </Text>
          <Text style={styles.infoText}>
            2. Start the Claude Haha server on your computer
          </Text>
          <Text style={styles.infoText}>
            3. Configure the server URL and test the connection
          </Text>
          <Text style={styles.infoText}>
            4. Start chatting! Your sessions sync across devices
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
  },
  buttonContainer: {
    gap: 16,
    marginBottom: 40,
  },
  statusCard: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2E2E2',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F8F8F8',
  },
  statusText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#666666',
  },
  statusConnected: {
    color: '#248A3D',
  },
  statusFailed: {
    color: '#C7352E',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
  },
  secondaryButton: {
    backgroundColor: '#34C759',
  },
  tertiaryButton: {
    backgroundColor: '#8E8E93',
  },
  infoContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 20,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 15,
    color: '#333',
    marginBottom: 8,
    lineHeight: 22,
  },
})
