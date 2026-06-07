import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, FlatList, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Users, Plus, X, Globe, AlertTriangle, CheckCircle, RefreshCw, Copy, ShieldAlert, Award } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, query, orderBy, limit, onSnapshot, doc, setDoc, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestore, functions } from '../services/firebase';
import Toast from 'react-native-toast-message';

interface Creator {
  id: string;
  name: string;
  referralCode: string;
  totalInstalls?: number;
  validInstalls?: number;
  totalSignups?: number;
}

interface InstallLog {
  id: string;
  creatorId?: string;
  referralCode?: string;
  deviceId: string;
  os: string;
  ip: string;
  userAgent: string;
  status: 'pending' | 'confirmed' | 'invalid';
  reason?: string;
  timestamp: any;
  deviceDetails?: {
    brand?: string;
    model?: string;
    osVersion?: string;
    isDevice?: boolean;
  };
}

export const AdminReferralsScreen = () => {
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<'creators' | 'logs' | 'sim'>('creators');
  const [creators, setCreators] = useState<Creator[]>([]);
  const [installLogs, setInstallLogs] = useState<InstallLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // New Creator Modal State
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newCreatorId, setNewCreatorId] = useState('');
  const [newCreatorName, setNewCreatorName] = useState('');
  const [newCreatorCode, setNewCreatorCode] = useState('');

  // Simulation State
  const [selectedSimCreator, setSelectedSimCreator] = useState<Creator | null>(null);
  const [simPlatform, setSimPlatform] = useState<'android' | 'ios'>('android');
  const [simIp, setSimIp] = useState('192.168.10.15');
  const [simUserAgent, setSimUserAgent] = useState('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15');
  const [simDeviceId, setSimDeviceId] = useState('');
  const [simIsDevice, setSimIsDevice] = useState(true);
  const [isSimulatingClick, setIsSimulatingClick] = useState(false);
  const [isSimulatingOpen, setIsSimulatingOpen] = useState(false);
  const [isSimulatingSignup, setIsSimulatingSignup] = useState(false);

  // Load Real-time Data
  useEffect(() => {
    setIsLoading(true);

    // Subscribe to Creators
    const creatorsQuery = query(collection(firestore, 'creators'), orderBy('createdAt', 'desc'));
    const unsubCreators = onSnapshot(creatorsQuery, (snap) => {
      const creatorsList: Creator[] = [];
      snap.forEach((doc) => {
        creatorsList.push({ id: doc.id, ...doc.data() } as Creator);
      });
      setCreators(creatorsList);
      setIsLoading(false);
    }, (error) => {
      console.error("Error subscribing to creators:", error);
      setIsLoading(false);
    });

    // Subscribe to Install Logs
    const logsQuery = query(collection(firestore, 'installs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(logsQuery, (snap) => {
      const logsList: InstallLog[] = [];
      snap.forEach((doc) => {
        logsList.push({ id: doc.id, ...doc.data() } as InstallLog);
      });
      setInstallLogs(logsList);
    }, (error) => {
      console.error("Error subscribing to installs:", error);
    });

    // Prefill random Device ID for simulator ease
    generateRandomSimDeviceId();

    return () => {
      unsubCreators();
      unsubLogs();
    };
  }, []);

  const generateRandomSimDeviceId = () => {
    // Basic mock UUID format
    const randomHex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    const mockUuid = `${randomHex()}${randomHex()}-${randomHex()}-${randomHex()}-${randomHex()}-${randomHex()}${randomHex()}${randomHex()}`;
    setSimDeviceId(mockUuid);
  };

  const handleCopyLink = (code: string) => {
    const link = `https://eventas.live/invite/${code}`;
    Clipboard.setString(link);
    Toast.show({
      type: 'success',
      text1: 'Link Copied',
      text2: `${link} copied to clipboard.`
    });
  };

  const handleCreateCreator = async () => {
    if (!newCreatorId || !newCreatorName || !newCreatorCode) {
      Toast.show({ type: 'error', text1: 'Missing Fields', text2: 'Please fill in all fields.' });
      return;
    }

    const cleanId = newCreatorId.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    const cleanCode = newCreatorCode.toUpperCase().trim().replace(/[^A-Z0-9_-]/g, '');

    try {
      const creatorRef = doc(firestore, 'creators', cleanId);
      await setDoc(creatorRef, {
        name: newCreatorName.trim(),
        referralCode: cleanCode,
        totalInstalls: 0,
        validInstalls: 0,
        totalSignups: 0,
        createdAt: serverTimestamp()
      });

      Toast.show({ type: 'success', text1: 'Creator Added', text2: `Creator ${newCreatorName} registered!` });
      setIsModalVisible(false);
      setNewCreatorId('');
      setNewCreatorName('');
      setNewCreatorCode('');
    } catch (error) {
      console.error("Error creating creator:", error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to create creator.' });
    }
  };

  const handleDeleteCreator = (creator: Creator) => {
    Alert.alert(
      'Delete Creator',
      `Are you sure you want to delete ${creator.name}? This will remove their record from Firestore.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(firestore, 'creators', creator.id));
              Toast.show({ type: 'success', text1: 'Deleted', text2: `${creator.name} deleted successfully.` });
            } catch (error) {
              console.error("Error deleting creator:", error);
              Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to delete creator.' });
            }
          }
        }
      ]
    );
  };

  // Simulation Suite Functions
  const handleSimulateClick = async () => {
    if (!selectedSimCreator) {
      Toast.show({ type: 'error', text1: 'Selection Required', text2: 'Please select a creator to simulate click.' });
      return;
    }

    setIsSimulatingClick(true);
    try {
      // Simulate invite redirect click: write to 'pending_clicks' collection directly
      await addDoc(collection(firestore, 'pending_clicks'), {
        referralCode: selectedSimCreator.referralCode,
        ip: simIp,
        userAgent: simUserAgent,
        timestamp: new Date()
      });

      // Update creator aggregate stats simulation (totalClicks is stored on server but can be incremented here)
      Toast.show({
        type: 'success',
        text1: 'Click Registered!',
        text2: `Logged click for IP ${simIp} and referral ${selectedSimCreator.referralCode}.`
      });
    } catch (error) {
      console.error("Simulation click error:", error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to simulate link click.' });
    } finally {
      setIsSimulatingClick(false);
    }
  };

  const handleSimulateAppOpen = async () => {
    setIsSimulatingOpen(true);
    try {
      const registerInstallFn = httpsCallable(functions, 'registerInstall');
      
      // For Android, we send the code in payload (Google Play Install Referrer)
      // For iOS, we send empty referralCode to force IP + User-Agent matching
      const payloadReferralCode = simPlatform === 'android' && selectedSimCreator ? selectedSimCreator.referralCode : null;

      const response = await registerInstallFn({
        deviceId: simDeviceId,
        referralCode: payloadReferralCode,
        simulatedIp: simIp,
        simulatedUserAgent: simUserAgent,
        deviceDetails: {
          brand: simPlatform === 'ios' ? 'Apple' : 'Google',
          model: simPlatform === 'ios' ? 'iPhone Simulator' : 'Android SDK built for x86',
          osName: simPlatform === 'ios' ? 'iOS' : 'Android',
          osVersion: '17.4',
          isDevice: simIsDevice
        }
      });

      const result = response.data as { success: boolean; status: string; reason?: string };

      if (result.status === 'confirmed') {
        Toast.show({
          type: 'success',
          text1: 'Install Confirmed!',
          text2: 'Passed validation successfully.'
        });
      } else {
        Toast.show({
          type: 'error',
          text1: 'Install Invalid',
          text2: `Rejected: ${result.reason || 'Unknown reason'}`
        });
      }

    } catch (error: any) {
      console.error("Simulation open error:", error);
      Toast.show({
        type: 'error',
        text1: 'Callable Failed',
        text2: error.message || 'Verification function error.'
      });
    } finally {
      setIsSimulatingOpen(false);
    }
  };

  const handleSimulateSignup = async () => {
    setIsSimulatingSignup(true);
    try {
      const simulateUserSignupFn = httpsCallable(functions, 'simulateUserSignup');
      const response = await simulateUserSignupFn({
        deviceId: simDeviceId
      });
      const result = response.data as { success: boolean; userId: string };
      if (result.success) {
        Toast.show({
          type: 'success',
          text1: 'User Profile Created!',
          text2: `Mock user created with ID ${result.userId.substring(0, 10)}...`
        });
      }
    } catch (error: any) {
      console.error("Simulation signup error:", error);
      Toast.show({
        type: 'error',
        text1: 'Callable Failed',
        text2: error.message || 'Simulation signup error.'
      });
    } finally {
      setIsSimulatingSignup(false);
    }
  };

  const handleSeedDemoData = async () => {
    try {
      // 1. Seed Creators
      const demoCreators = [
        { id: 'creator_brian', name: 'Brian Kelly', referralCode: 'BRIAN25' },
        { id: 'creator_sara', name: 'Sara Miller', referralCode: 'SARA_FEST' },
        { id: 'creator_alex', name: 'Alex Rogers', referralCode: 'ALEX_VIP' }
      ];

      for (const creator of demoCreators) {
        await setDoc(doc(firestore, 'creators', creator.id), {
          name: creator.name,
          referralCode: creator.referralCode,
          totalInstalls: 0,
          validInstalls: 0,
          totalSignups: 0,
          createdAt: serverTimestamp()
        });
      }

      Toast.show({
        type: 'success',
        text1: 'Demo Creators Seeded',
        text2: 'BRIAN25, SARA_FEST, and ALEX_VIP are ready!'
      });
    } catch (error) {
      console.error("Error seeding data:", error);
      Toast.show({ type: 'error', text1: 'Seeding Failed', text2: 'Could not seed database.' });
    }
  };

  // Helper formatting values
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'confirmed':
        return styles.statusConfirmed;
      case 'invalid':
        return styles.statusInvalid;
      default:
        return styles.statusPending;
    }
  };

  const getStatusText = (status: string) => {
    return status.toUpperCase();
  };

  // Calculate aggregates
  const aggTotalInstalls = creators.reduce((acc, c) => acc + (c.totalInstalls || 0), 0);
  const aggValidInstalls = creators.reduce((acc, c) => acc + (c.validInstalls || 0), 0);
  const aggTotalSignups = creators.reduce((acc, c) => acc + (c.totalSignups || 0), 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Affiliate & Referrals</Text>
        <TouchableOpacity onPress={() => setIsModalVisible(true)} style={styles.addButton}>
          <Plus color="#00FFCC" size={24} />
        </TouchableOpacity>
      </View>

      {/* Aggregate Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{creators.length}</Text>
          <Text style={styles.statLabel}>Creators</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statVal, { color: '#FF00CC' }]}>{aggTotalInstalls}</Text>
          <Text style={styles.statLabel}>Attempts</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statVal, { color: '#00FFCC' }]}>{aggValidInstalls}</Text>
          <Text style={styles.statLabel}>Valid</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statVal, { color: '#3399FF' }]}>{aggTotalSignups}</Text>
          <Text style={styles.statLabel}>Signups</Text>
        </View>
      </View>

      {/* Tabs Menu */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'creators' && styles.tabButtonActive]}
          onPress={() => setActiveTab('creators')}
        >
          <Award size={18} color={activeTab === 'creators' ? '#00FFCC' : '#888'} />
          <Text style={[styles.tabText, activeTab === 'creators' && styles.tabTextActive]}>Creators</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'logs' && styles.tabButtonActive]}
          onPress={() => setActiveTab('logs')}
        >
          <Globe size={18} color={activeTab === 'logs' ? '#00FFCC' : '#888'} />
          <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>Install Logs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'sim' && styles.tabButtonActive]}
          onPress={() => setActiveTab('sim')}
        >
          <RefreshCw size={18} color={activeTab === 'sim' ? '#00FFCC' : '#888'} />
          <Text style={[styles.tabText, activeTab === 'sim' && styles.tabTextActive]}>Simulation</Text>
        </TouchableOpacity>
      </View>

      {/* Content Area */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00FFCC" />
          <Text style={styles.loadingText}>Fetching referral data...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {activeTab === 'creators' && (
            <View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Registered Creator Affiliates</Text>
              </View>

              {creators.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Users color="#555" size={40} style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyText}>No creators found.</Text>
                  <TouchableOpacity style={styles.seedButton} onPress={handleSeedDemoData}>
                    <Text style={styles.seedButtonText}>Seed Demo Creators</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                creators.map((creator) => (
                  <View key={creator.id} style={styles.creatorCard}>
                    <View style={styles.creatorInfo}>
                      <Text style={styles.creatorName}>{creator.name}</Text>
                      <Text style={styles.creatorCode}>Code: {creator.referralCode}</Text>
                      <TouchableOpacity 
                        style={styles.copyButton}
                        onPress={() => handleCopyLink(creator.referralCode)}
                      >
                        <Copy size={12} color="#00FFCC" />
                        <Text style={styles.copyText} numberOfLines={1}>
                          eventas.live/invite/{creator.referralCode}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.creatorMetrics}>
                      <View style={styles.metricItem}>
                        <Text style={styles.metricVal}>{creator.totalSignups || 0}</Text>
                        <Text style={styles.metricLabel}>Signups</Text>
                      </View>
                      <View style={styles.metricDivider} />
                      <View style={styles.metricItem}>
                        <Text style={styles.metricVal}>{creator.validInstalls || 0}</Text>
                        <Text style={styles.metricLabel}>Valid</Text>
                      </View>
                      <View style={styles.metricDivider} />
                      <View style={styles.metricItem}>
                        <Text style={styles.metricVal}>{creator.totalInstalls || 0}</Text>
                        <Text style={styles.metricLabel}>Total</Text>
                      </View>
                      <TouchableOpacity 
                        style={styles.deleteButton}
                        onPress={() => handleDeleteCreator(creator)}
                      >
                        <X size={14} color="#FF3333" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {activeTab === 'logs' && (
            <View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>First-Open Install Audits</Text>
              </View>

              {installLogs.length === 0 ? (
                <View style={styles.emptyCard}>
                  <ShieldAlert color="#555" size={40} style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyText}>No installation logs registered yet.</Text>
                  <Text style={styles.emptySubtext}>Use the Simulation tab to generate first-open logs.</Text>
                </View>
              ) : (
                installLogs.map((log) => {
                  const dateStr = log.timestamp?.seconds 
                    ? new Date(log.timestamp.seconds * 1000).toLocaleTimeString() 
                    : new Date().toLocaleTimeString();
                  
                  return (
                    <View key={log.id} style={styles.logCard}>
                      <View style={styles.logHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.logCreator}>
                            {log.referralCode ? `@${log.referralCode}` : 'NO REFERRAL'}
                          </Text>
                          <Text style={styles.logOS}>{log.os?.toUpperCase()}</Text>
                        </View>
                        <View style={[styles.statusBadge, getStatusStyle(log.status)]}>
                          <Text style={styles.statusBadgeText}>
                            {getStatusText(log.status)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.logDetails}>
                        <Text style={styles.detailText}>
                          Device: <Text style={styles.detailVal}>{log.deviceDetails?.model || log.deviceId.substring(0, 12)}...</Text>
                        </Text>
                        <Text style={styles.detailText}>
                          IP Address: <Text style={styles.detailVal}>{log.ip}</Text>
                        </Text>
                        <Text style={styles.detailText}>
                          Time: <Text style={styles.detailVal}>{dateStr}</Text>
                        </Text>
                        {log.reason && (
                          <View style={styles.fraudAlert}>
                            <AlertTriangle size={14} color="#FF3333" />
                            <Text style={styles.fraudText}>Reason: {log.reason}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {activeTab === 'sim' && (
            <View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Attribution & Fraud Simulator</Text>
              </View>

              {/* Seed Button */}
              <TouchableOpacity style={[styles.seedButton, { marginBottom: 24 }]} onPress={handleSeedDemoData}>
                <Text style={styles.seedButtonText}>Seed Demo Creators (Brian, Sara, Alex)</Text>
              </TouchableOpacity>

              {/* Config Panel */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>1. Configure Client Environment</Text>
                
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Select Creator for Invite Link</Text>
                  <View style={styles.dropdown}>
                    {creators.length === 0 ? (
                      <Text style={{ color: '#888' }}>Please seed creators first</Text>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        {creators.map(c => (
                          <TouchableOpacity
                            key={c.id}
                            style={[styles.simCreatorPill, selectedSimCreator?.id === c.id && styles.simCreatorPillActive]}
                            onPress={() => setSelectedSimCreator(c)}
                          >
                            <Text style={[styles.simCreatorPillText, selectedSimCreator?.id === c.id && styles.simCreatorPillTextActive]}>
                              {c.name} ({c.referralCode})
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                </View>

                <View style={styles.rowFormGroup}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.label}>Simulation OS</Text>
                    <View style={styles.osRow}>
                      <TouchableOpacity
                        style={[styles.osButton, simPlatform === 'android' && styles.osButtonActive]}
                        onPress={() => setSimPlatform('android')}
                      >
                        <Text style={[styles.osButtonText, simPlatform === 'android' && styles.osButtonTextActive]}>Android</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.osButton, simPlatform === 'ios' && styles.osButtonActive]}
                        onPress={() => setSimPlatform('ios')}
                      >
                        <Text style={[styles.osButtonText, simPlatform === 'ios' && styles.osButtonTextActive]}>iOS</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.label}>Device Type</Text>
                    <View style={styles.osRow}>
                      <TouchableOpacity
                        style={[styles.osButton, simIsDevice === true && styles.osButtonActive]}
                        onPress={() => setSimIsDevice(true)}
                      >
                        <Text style={[styles.osButtonText, simIsDevice === true && styles.osButtonTextActive]}>Device</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.osButton, simIsDevice === false && styles.osButtonActive]}
                        onPress={() => setSimIsDevice(false)}
                      >
                        <Text style={[styles.osButtonText, simIsDevice === false && styles.osButtonTextActive]}>Emulator</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Mock Client IP</Text>
                  <TextInput
                    style={styles.input}
                    value={simIp}
                    onChangeText={setSimIp}
                    placeholder="e.g. 192.168.1.1"
                    placeholderTextColor="#666"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Mock User-Agent</Text>
                  <TextInput
                    style={[styles.input, { fontSize: 12 }]}
                    value={simUserAgent}
                    onChangeText={setSimUserAgent}
                    placeholder="e.g. Mozilla iPhone"
                    placeholderTextColor="#666"
                    multiline
                    numberOfLines={2}
                  />
                </View>

                <View style={styles.formGroup}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={styles.label}>Device Unique ID</Text>
                    <TouchableOpacity onPress={generateRandomSimDeviceId}>
                      <Text style={styles.randomizeText}>Randomize</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={[styles.input, { color: '#00FFCC' }]}
                    value={simDeviceId}
                    onChangeText={setSimDeviceId}
                    placeholder="Auto-generated device UUID"
                    placeholderTextColor="#666"
                  />
                </View>
              </View>

              {/* Simulation Actions */}
              <View style={[styles.card, { marginTop: 16 }]}>
                <Text style={styles.cardTitle}>2. Run Simulation Steps</Text>
                
                <View style={styles.simFlowCard}>
                  <Text style={styles.simStepTitle}>Step A: Simulate Web Redirect (Click)</Text>
                  <Text style={styles.simStepDesc}>
                    Required for iOS first-open IP mapping. Logs IP and User-Agent in Firestore before redirecting.
                  </Text>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#FF00CC' }]}
                    onPress={handleSimulateClick}
                    disabled={isSimulatingClick}
                  >
                    {isSimulatingClick ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Globe color="#FFF" size={16} />
                        <Text style={styles.actionButtonText}>Simulate Link Click</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.simFlowCard}>
                  <Text style={styles.simStepTitle}>Step B: Simulate First Open (Install)</Text>
                  <Text style={styles.simStepDesc}>
                    Simulates the app starting for the first time. Invokes the `registerInstall` Cloud Function directly.
                  </Text>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#00FFCC' }]}
                    onPress={handleSimulateAppOpen}
                    disabled={isSimulatingOpen}
                  >
                    {isSimulatingOpen ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <CheckCircle color="#000" size={16} />
                        <Text style={[styles.actionButtonText, { color: '#000' }]}>Simulate App Install Open</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.simFlowCard}>
                  <Text style={styles.simStepTitle}>Step C: Simulate User Sign Up (Account Created)</Text>
                  <Text style={styles.simStepDesc}>
                    Simulates the user completing onboarding terms and creating a profile. Invokes the signup trigger.
                  </Text>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#3399FF' }]}
                    onPress={handleSimulateSignup}
                    disabled={isSimulatingSignup}
                  >
                    {isSimulatingSignup ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Users color="#FFF" size={16} />
                        <Text style={styles.actionButtonText}>Simulate User Sign Up</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Rule Verification Table */}
              <View style={[styles.card, { marginTop: 16, marginBottom: 40 }]}>
                <Text style={styles.cardTitle}>How to Verify Anti-Fraud Rules:</Text>
                
                <View style={styles.ruleHelpItem}>
                  <Text style={styles.ruleHelpTitle}>✓ iOS First-Open Attribution</Text>
                  <Text style={styles.ruleHelpDesc}>
                    Configure platform to iOS. Press "Simulate Link Click" to log your mock IP. Then, without modifying details, press "Simulate App Install Open". The backend will match IP & User-Agent and confirm the referral!
                  </Text>
                </View>

                <View style={styles.ruleHelpItem}>
                  <Text style={styles.ruleHelpTitle}>✓ Android Install Referrer</Text>
                  <Text style={styles.ruleHelpDesc}>
                    Configure platform to Android. Trigger "Simulate App Install Open". The app simulates Google Play referrer injection directly into the payload. The install will be validated instantly.
                  </Text>
                </View>

                <View style={styles.ruleHelpItem}>
                  <Text style={styles.ruleHelpTitle}>✗ Emulator Blocker</Text>
                  <Text style={styles.ruleHelpDesc}>
                    Set Device Type to Emulator. Run the App Install simulation. The install log will be flagged as INVALID with reason `emulator_detected`.
                  </Text>
                </View>

                <View style={styles.ruleHelpItem}>
                  <Text style={styles.ruleHelpTitle}>✗ Re-install / Duplicate Device</Text>
                  <Text style={styles.ruleHelpDesc}>
                    Trigger a successful install. Then, press "Simulate App Install Open" again *without* randomizing the Device Unique ID. It will log as INVALID with reason `duplicate_device` (preventing payout spoofing).
                  </Text>
                </View>

                <View style={styles.ruleHelpItem}>
                  <Text style={styles.ruleHelpTitle}>✗ IP Velocity Limit</Text>
                  <Text style={styles.ruleHelpDesc}>
                    Leave IP unchanged. Rapidly trigger App Installs, clicking "Randomize Device ID" before each install. On the 4th install within 10 minutes from that IP, it will be flagged as INVALID with `ip_velocity_limit`.
                  </Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Add Creator Modal */}
      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Creator Affiliate</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                <X color="#FFFFFF" size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Creator ID (Unique, alphanumeric)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. creator_brian"
                  placeholderTextColor="#666"
                  value={newCreatorId}
                  onChangeText={setNewCreatorId}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Creator Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Brian Kelly"
                  placeholderTextColor="#666"
                  value={newCreatorName}
                  onChangeText={setNewCreatorName}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Referral Code (Uppercase, e.g., BRIAN25)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. BRIAN25"
                  placeholderTextColor="#666"
                  value={newCreatorCode}
                  onChangeText={setNewCreatorCode}
                  autoCapitalize="characters"
                />
              </View>

              <TouchableOpacity style={styles.createButton} onPress={handleCreateCreator}>
                <Text style={styles.createButtonText}>Add Creator</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  addButton: {
    padding: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
  },
  statVal: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#00FFCC',
  },
  tabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#00FFCC',
  },
  content: {
    padding: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  creatorCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  creatorInfo: {
    flex: 1,
    marginRight: 16,
  },
  creatorName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  creatorCode: {
    color: '#FF00CC',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start',
    maxWidth: '90%',
  },
  copyText: {
    color: '#00FFCC',
    fontSize: 11,
    fontWeight: '500',
  },
  creatorMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricVal: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  metricLabel: {
    color: '#888',
    fontSize: 10,
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#333',
  },
  deleteButton: {
    padding: 4,
    marginLeft: 4,
  },
  emptyCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginTop: 10,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  seedButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF00CC',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  seedButtonText: {
    color: '#FF00CC',
    fontWeight: '600',
    fontSize: 13,
  },
  logCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    paddingBottom: 8,
    marginBottom: 8,
  },
  logCreator: {
    color: '#00FFCC',
    fontSize: 14,
    fontWeight: '700',
  },
  logOS: {
    color: '#888',
    fontSize: 10,
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '800',
  },
  statusConfirmed: {
    backgroundColor: '#00FFCC',
  },
  statusInvalid: {
    backgroundColor: '#FF3333',
  },
  statusPending: {
    backgroundColor: '#FFCC00',
  },
  logDetails: {
    gap: 4,
  },
  detailText: {
    color: '#666',
    fontSize: 12,
  },
  detailVal: {
    color: '#DDD',
  },
  fraudAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 51, 51, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 6,
  },
  fraudText: {
    color: '#FF3333',
    fontSize: 11,
    fontWeight: '600',
  },
  // Simulation panel styles
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  formGroup: {
    marginBottom: 16,
  },
  rowFormGroup: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  label: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
  dropdown: {
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  simCreatorPill: {
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  simCreatorPillActive: {
    backgroundColor: '#00FFCC',
  },
  simCreatorPillText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  simCreatorPillTextActive: {
    color: '#000',
  },
  osRow: {
    flexDirection: 'row',
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  osButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  osButtonActive: {
    backgroundColor: '#00FFCC',
  },
  osButtonText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  osButtonTextActive: {
    color: '#000000',
  },
  input: {
    backgroundColor: '#2A2A2A',
    color: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#333',
    fontSize: 14,
  },
  randomizeText: {
    color: '#FF00CC',
    fontSize: 12,
    fontWeight: '600',
  },
  simFlowCard: {
    backgroundColor: '#222222',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  simStepTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  simStepDesc: {
    color: '#888',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  ruleHelpItem: {
    marginBottom: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#333',
    paddingLeft: 10,
  },
  ruleHelpTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  ruleHelpDesc: {
    color: '#888',
    fontSize: 11,
    lineHeight: 16,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  createButton: {
    backgroundColor: '#FF00CC',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
