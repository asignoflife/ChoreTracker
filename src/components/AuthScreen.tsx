import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

type AuthMode = 'sign_in' | 'create_family' | 'join_family';

export default function AuthScreen({ onSignedIn }: { onSignedIn?: () => void }) {
  const [mode, setMode] = useState<AuthMode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  function chooseMode(next: AuthMode) {
    setMode(next);
    setMessage('');
    setErrorMessage('');
  }

  async function handleAuth() {
    setMessage('');
    setErrorMessage('');
    if (!email.trim() || !password) {
      setErrorMessage('Please enter an email and password.');
      return;
    }
    if (mode !== 'sign_in' && !fullName.trim()) {
      setErrorMessage('Please enter your name.');
      return;
    }
    if (mode === 'join_family' && !invitationCode.trim()) {
      setErrorMessage('Please enter the invitation code from your family parent.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onSignedIn?.();
      } else {
        const { data: version, error: setupError } = await supabase.rpc('family_signup_version');
        if (setupError || version !== 1) {
          throw new Error('Family signup is not configured yet. Ask your administrator to install the family invitations migration.');
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              signup_mode: mode,
              full_name: fullName.trim(),
              ...(mode === 'join_family' ? { invitation_code: invitationCode.trim() } : {}),
            },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage('If signup was successful, check your email to confirm your account, then sign in.');
          setMode('sign_in');
          setInvitationCode('');
        } else {
          onSignedIn?.();
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.authContent}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>✓</Text></View>
            <Text style={styles.brandName}>chore<Text style={styles.brandAccent}>tracker</Text></Text>
          </View>
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>A LITTLE HELP GOES A LONG WAY</Text>
            <Text style={styles.heroTitle}>A happier home,{'\n'}together.</Text>
            <Text style={styles.heroText}>Make room for teamwork, celebrate the little wins, and keep everyone on the same page.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardKicker}>WELCOME TO CHORETRACKER</Text>
            <Text style={styles.title}>{mode === 'sign_in' ? 'Welcome back' : mode === 'create_family' ? 'Create your family' : 'Join your family'}</Text>
            <Text style={styles.description}>{mode === 'sign_in' ? 'Sign in to see what your family is up to.' : mode === 'create_family' ? 'You’ll be the first parent and can invite your family afterward.' : 'Enter the invitation code provided by a parent.'}</Text>
            {mode !== 'sign_in' && (
              <>
                <Text style={styles.label}>YOUR NAME</Text>
                <TextInput style={styles.input} placeholder="e.g. Mom, Dad, Leo" value={fullName} onChangeText={setFullName} />
              </>
            )}
            {mode === 'join_family' && (
              <>
                <Text style={styles.label}>INVITATION CODE</Text>
                <TextInput style={styles.input} placeholder="Paste the code from your parent" autoCapitalize="none" autoCorrect={false} value={invitationCode} onChangeText={setInvitationCode} />
              </>
            )}
            <Text style={styles.label}>EMAIL ADDRESS</Text>
            <TextInput style={styles.input} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput style={styles.input} placeholder="At least 6 characters" secureTextEntry value={password} onChangeText={setPassword} />
            {!!errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
            {!!message && <Text style={styles.message}>{message}</Text>}
            <TouchableOpacity style={styles.submitBtn} onPress={handleAuth} disabled={loading}>
              {loading ? <ActivityIndicator color="#0C2127" /> : <Text style={styles.submitText}>{mode === 'sign_in' ? 'Sign In' : mode === 'create_family' ? 'Create Family' : 'Join Family'}</Text>}
            </TouchableOpacity>
            {mode === 'sign_in' ? (
              <View style={styles.switchRow}>
                <TouchableOpacity onPress={() => chooseMode('create_family')}><Text style={styles.switchText}>Create a family</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => chooseMode('join_family')}><Text style={styles.switchText}>I have an invitation</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => chooseMode('sign_in')}><Text style={styles.switchText}>Already have an account? Sign in</Text></TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14232A' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  authContent: { width: '100%', maxWidth: 900, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 28 },
  brandRow: { width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  brandMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#2A9D8F', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  brandMarkText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  brandName: { color: '#EAF2F2', fontSize: 22, fontWeight: '800', letterSpacing: -1 },
  brandAccent: { color: '#E76F51' },
  intro: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 0, maxWidth: 420, paddingVertical: 10 },
  eyebrow: { color: '#7E979E', fontSize: 10, letterSpacing: 1.5, fontWeight: '800', marginBottom: 14 },
  heroTitle: { color: '#EAF2F2', fontSize: 38, lineHeight: 46, fontWeight: '800', letterSpacing: -1.3 },
  heroText: { color: '#A9C0C6', fontSize: 15, lineHeight: 24, marginTop: 14, maxWidth: 320 },
  card: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0, maxWidth: 420, backgroundColor: '#1E3139', borderRadius: 22, padding: 24, borderWidth: 1, borderColor: '#2E4750' },
  cardKicker: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  title: { fontSize: 25, fontWeight: '800', color: '#EAF2F2', letterSpacing: -0.5 },
  description: { color: '#7E979E', fontSize: 13, marginTop: 6, marginBottom: 22 },
  label: { color: '#A9C0C6', fontSize: 10, fontWeight: '800', letterSpacing: 0.7, marginBottom: 7 },
  input: { backgroundColor: '#172A31', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 11, marginBottom: 16, borderWidth: 1, borderColor: '#2E4750', color: '#EAF2F2', minHeight: 48 },
  error: { color: '#F08A72', marginBottom: 12, lineHeight: 20 },
  message: { color: '#5FC7BA', marginBottom: 12, lineHeight: 20 },
  submitBtn: { backgroundColor: '#2A9D8F', padding: 15, borderRadius: 11, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#0C2127', fontWeight: '800', fontSize: 14 },
  switchRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 },
  switchText: { color: '#5FC7BA', textAlign: 'center', marginTop: 20, fontWeight: '700', fontSize: 13 },
});
