import React, { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { setAccessToken, setBaseUrl, testConnection } from '../api/client'
import { parseH5LaunchUrl } from '../lib/h5Launch'
import { useSessionStore } from '../stores/sessionStore'

export default function QrScannerScreen() {
  const navigation = useNavigation<any>()
  const fetchSessions = useSessionStore((state) => state.fetchSessions)
  const [permission, requestPermission] = useCameraPermissions()
  const [isHandlingScan, setIsHandlingScan] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const handleBarcodeScanned = async ({ data }: BarcodeScanningResult) => {
    if (isHandlingScan) return
    setIsHandlingScan(true)
    setLastError(null)

    try {
      const config = parseH5LaunchUrl(data)
      setBaseUrl(config.serverUrl)
      await setAccessToken(config.token)

      const connected = await testConnection()
      if (!connected) {
        throw new Error('The QR code was parsed, but the Windows server did not accept the connection.')
      }

      await fetchSessions()
      navigation.navigate('SessionList')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to use this QR code.'
      setLastError(message)
      Alert.alert('Scan failed', message)
      setIsHandlingScan(false)
    }
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color="#172033" />
      </SafeAreaView>
    )
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="camera-outline" size={42} color="#172033" />
        <Text style={styles.title}>Camera access required</Text>
        <Text style={styles.description}>
          Scan the H5 access QR code shown in the Windows desktop settings.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Allow Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={isHandlingScan ? undefined : handleBarcodeScanned}
      >
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerText}>Scan Desktop QR</Text>
          <View style={styles.iconButtonPlaceholder} />
        </View>

        <View style={styles.scanArea}>
          <View style={styles.scanFrame} />
        </View>

        <View style={styles.bottomPanel}>
          <Text style={styles.bottomTitle}>Point at the H5 access QR code</Text>
          <Text style={styles.bottomText}>
            Windows desktop: Settings, H5 Access, enable access, then scan the QR code.
          </Text>
          {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}
          {isHandlingScan ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={styles.loadingText}>Pairing...</Text>
            </View>
          ) : null}
        </View>
      </CameraView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#F9FBFC',
  },
  camera: {
    flex: 1,
  },
  topBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  iconButtonPlaceholder: {
    width: 42,
    height: 42,
  },
  headerText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  scanArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 238,
    height: 238,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  bottomPanel: {
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  bottomTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  bottomText: {
    marginTop: 8,
    color: '#D6DEE9',
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    marginTop: 12,
    color: '#FDBA74',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  loadingRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    marginTop: 18,
    color: '#172033',
    fontSize: 22,
    fontWeight: '800',
  },
  description: {
    marginTop: 10,
    color: '#607089',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 22,
    minWidth: 180,
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#172033',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: 10,
    minWidth: 180,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7EDF4',
  },
  secondaryButtonText: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '800',
  },
})
