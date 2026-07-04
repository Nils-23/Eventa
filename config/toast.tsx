import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BaseToastProps } from 'react-native-toast-message';
import { AlertCircle, CheckCircle, Info } from 'lucide-react-native';

const ToastBase = ({
  text1,
  text2,
  icon,
  iconColor,
  borderColor,
}: BaseToastProps & { icon: React.ReactNode; iconColor: string; borderColor: string }) => (
  <View style={[styles.container, { borderColor }]}>
    <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
      {icon}
    </View>
    <View style={styles.textContainer}>
      {!!text1 && <Text style={styles.title}>{text1}</Text>}
      {!!text2 && <Text style={styles.message}>{text2}</Text>}
    </View>
  </View>
);

export const toastConfig = {
  success: (props: BaseToastProps) => (
    <ToastBase
      {...props}
      icon={<CheckCircle color="#00FFCC" size={24} />}
      iconColor="#00FFCC"
      borderColor="#00FFCC"
    />
  ),
  error: (props: BaseToastProps) => (
    <ToastBase
      {...props}
      icon={<AlertCircle color="#FF0055" size={24} />}
      iconColor="#FF0055"
      borderColor="#FF0055"
    />
  ),
  info: (props: BaseToastProps) => (
    <ToastBase
      {...props}
      icon={<Info color="#4169E1" size={24} />}
      iconColor="#4169E1"
      borderColor="#4169E1"
    />
  ),
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    padding: 16,
    borderRadius: 16,
    width: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    color: '#A0A0A0',
  },
});
