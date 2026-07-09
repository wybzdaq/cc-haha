import React, { useEffect, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import Button from '../components/shared/Button'
import { getAccessToken, getBaseUrl, setAccessToken, setBaseUrl, testConnection } from '../api/client'

export default function ServerConfigScreen() {
  const [serverUrl, setServerUrlInput] = useState('')
  const [accessToken, setAccessTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'success' | 'failed'>('unknown')
  const navigation = useNavigation<any>()

  useEffect(() => {
    setServerUrlInput(getBaseUrl())
    setAccessTokenInput(getAccessToken())
  }, [])

  const handleTestConnection = async () => {
    if (!serverUrl.trim()) {
      Alert.alert('Error', 'Please enter a server URL')
      return
    }

    setIsLoading(true)
    setConnectionStatus('unknown')

    const originalUrl = getBaseUrl()
    const originalToken = getAccessToken()

    try {
      setBaseUrl(serverUrl.trim())
      await setAccessToken(accessToken.trim())

      const success = await testConnection()

      if (success) {
        setConnectionStatus('success')
        Alert.alert('Success', 'Connection successful!')
      } else {
        setConnectionStatus('failed')
        setBaseUrl(originalUrl)
        await setAccessToken(originalToken)
        Alert.alert('Error', 'Connection failed. Please check the URL and access token.')
      }
    } catch (error) {
      setConnectionStatus('failed')
      setBaseUrl(originalUrl)
      await setAccessToken(originalToken)
      Alert.alert('Error', 'Connection failed: ' + (error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!serverUrl.trim()) {
      Alert.alert('Error', 'Please enter a server URL')
      return
    }

    try {
      setBaseUrl(serverUrl.trim())
      await setAccessToken(accessToken.trim())
      Alert.alert('Success', 'Configuration saved!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ])
    } catch {
      Alert.alert('Error', 'Failed to save configuration')
    }
  }

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'success':
        return 'Connected'
      case 'failed':
        return 'Connection Failed'
      default:
        return 'Not Tested'
    }
  }

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'success':
        return '#34C759'
      case 'failed':
        return '#FF3B30'
      default:
        return '#8E8E93'
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.title}>Server Configuration</Text>
        <Text style={styles.subtitle}>
          Pair Android with the Windows desktop server
        </Text>

        <View style={styles.form}>
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => navigation.navigate('QrScanner')}
          >
            <Text style={styles.scanButtonText}>Scan Desktop QR</Text>
          </TouchableOpacity>

          <View style={styles.field}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrlInput}
              placeholder="http://172.21.96.1:3456"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.hint}>
              Scan the desktop H5 QR code to fill this automatically.
            </Text>
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>H5 Token</Text>
              <Switch
                value={showToken}
                onValueChange={setShowToken}
                trackColor={{ false: '#ddd', true: '#007AFF30' }}
                thumbColor={showToken ? '#007AFF' : '#fff'}
              />
            </View>
            <TextInput
              style={styles.input}
              value={accessToken}
              onChangeText={setAccessTokenInput}
              placeholder="Scan QR or paste H5 token"
              secureTextEntry={!showToken}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>
              This is the desktop H5 access token, not the old SERVER_ACCESS_TOKEN unless they are the same value.
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status: </Text>
            <Text style={[styles.statusText, { color: getStatusColor() }]}>
              {getStatusText()}
            </Text>
          </View>

          <View style={styles.buttonGroup}>
            <Button
              title="Test Connection"
              onPress={handleTestConnection}
              disabled={isLoading}
              style={styles.testButton}
            />
            <Button
              title="Save Configuration"
              onPress={handleSave}
              style={styles.saveButton}
            />
          </View>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Quick Setup Guide</Text>
          <Text style={styles.infoText}>
            1. Open Windows desktop Settings and enable H5 access
          </Text>
          <Text style={styles.infoText}>
            2. Scan the H5 access QR code from Android
          </Text>
          <Text style={styles.infoText}>
            3. Android saves the server URL and H5 token
          </Text>
          <Text style={styles.infoText}>
            4. Confirm Windows Firewall allows TCP 3456
          </Text>
          <Text style={styles.infoText}>
            5. Keep Android and Windows on the same LAN
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
  scrollView: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
    paddingHorizontal: 20,
  },
  form: {
    paddingHorizontal: 20,
  },
  scanButton: {
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#172033',
    marginBottom: 24,
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  field: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#f8f8f8',
  },
  hint: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  statusLabel: {
    fontSize: 16,
    color: '#333',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonGroup: {
    gap: 12,
    marginBottom: 30,
  },
  testButton: {
    backgroundColor: '#8E8E93',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  infoBox: {
    margin: 20,
    padding: 20,
    backgroundColor: '#f0f8ff',
    borderRadius: 12,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: '#007AFF',
  },
  infoText: {
    fontSize: 15,
    color: '#333',
    marginBottom: 10,
    lineHeight: 22,
  },
})
