import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

export default function AuthScreen({ onProfileCreated }: { onProfileCreated?: () => void }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'parent' | 'kid'>('parent');
  const [familyCode, setFamilyCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAuth() {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter an email and password.');
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        if (!fullName || !familyCode) {
          Alert.alert('Missing info', 'Please enter your name and a Family Code.');
          setLoading(false);
          return;
        }

        // 1. Create the Auth user
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        // 2. Create their profile row with role ('parent' or 'kid') and family_code
        if (data.user) {
          const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            full_name: fullName.trim(),
            role,
            family_code: familyCode.trim().toUpperCase(),
          });
          if (profileError) throw profileError;
        }
                if (onProfileCreated) {
          onProfileCreated();
        }

      } else {
        // Sign in existing user
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      Alert.alert('Authentication Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{isSignUp ? 'Create Family Account' : 'Family Chore Login'}</Text>

      {isSignUp && (
        <>
          <TextInput
            style={styles.input}
            placeholder="First Name (e.g., Mom, Dad, Leo)"
            value={fullName}
            onChangeText={setFullName}
          />

          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[styles.roleBtn, role === 'parent' && styles.roleBtnActive]}
              onPress={() => setRole('parent')}
            >
              <Text style={[styles.roleText, role === 'parent' && styles.roleTextActive]}>
                I am a Parent
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleBtn, role === 'kid' && styles.roleBtnActive]}
              onPress={() => setRole('kid')}
            >
              <Text style={[styles.roleText, role === 'kid' && styles.roleTextActive]}>
                I am a Kid
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Family Code (e.g., SMITH123)"
            autoCapitalize="characters"
            value={familyCode}
            onChangeText={setFamilyCode}
          />
        </>
      )}

      <TextInput
        style={styles.input}
        placeholder="Email (e.g., leo@family.com)"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input}
        placeholder="Password (min 6 characters)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.submitBtn} onPress={handleAuth} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.submitText}>{isSignUp ? 'Sign Up' : 'Sign In'}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)}>
        <Text style={styles.switchText}>
          {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F5F7FA' },
  title: { fontSize: 26, fontWeight: 'bold', marginBottom: 24, textAlign: 'center', color: '#1A1A1A' },
  input: {
    backgroundColor: '#FFF',
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#D0D7DE',
  },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  roleBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  roleBtnActive: { backgroundColor: '#007AFF' },
  roleText: { color: '#007AFF', fontWeight: '600' },
  roleTextActive: { color: '#FFF' },
  submitBtn: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  submitText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  switchText: { color: '#007AFF', textAlign: 'center', marginTop: 18, fontWeight: '600' },
});
