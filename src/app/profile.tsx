import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/app-header';
import { DatePicker } from '../components/date-picker';
import { toDateInput } from '../lib/calendar';
import { supabase } from '../../lib/supabase';

type MyProfile = {
  id: string;
  full_name: string;
  role: 'parent' | 'kid';
  family_code: string;
  birthday: string | null;
  avatar_url: string | null;
};

// Everyone's own corner: photo, name, birthday, and the two things that change
// how they sign in. Email and password are handled by Supabase Auth; the rest
// goes through update_my_profile(), which can only touch the caller's row.
export default function ProfileScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState<Date | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState('');
  const [nameError, setNameError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const [email, setEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        setLoading(false);
        return;
      }
      setSession(currentSession);
      setEmail(currentSession.user.email ?? '');

      // select('*') rather than naming avatar_url, so the page still loads for
      // families that have not applied the profile database update yet.
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentSession.user.id)
        .single();

      if (cancelled) return;
      if (error || !data) {
        setLoadError('Your profile could not be loaded. Check your connection and try again.');
      } else {
        const loaded = { ...(data as MyProfile), avatar_url: (data as MyProfile).avatar_url ?? null };
        setProfile(loaded);
        setName(loaded.full_name);
        setBirthday(loaded.birthday ? new Date(`${loaded.birthday}T00:00:00`) : null);
      }
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  async function saveProfile(next: { full_name?: string; birthday?: Date | null; avatar_url?: string | null }) {
    if (!profile) return { error: 'Your profile is still loading.' };
    const { error } = await supabase.rpc('update_my_profile', {
      new_full_name: next.full_name ?? profile.full_name,
      new_birthday: next.birthday === undefined
        ? profile.birthday
        : next.birthday
          ? toDateInput(next.birthday)
          : null,
      new_avatar_url: next.avatar_url === undefined ? profile.avatar_url : next.avatar_url,
    });

    if (error) {
      return {
        error: ['PGRST202', '42883'].includes(error.code ?? '')
          ? 'Profile editing needs the profile self-service database update applied first.'
          : error.message,
      };
    }
    return { error: null };
  }

  async function handleSaveName() {
    if (!profile) return;
    if (!name.trim()) { setNameError('Enter your name.'); setNameMessage(''); return; }
    setNameBusy(true);
    setNameError('');
    setNameMessage('');
    const { error } = await saveProfile({ full_name: name.trim() });
    if (error) setNameError(error);
    else {
      setProfile({ ...profile, full_name: name.trim() });
      setNameMessage('Name saved.');
    }
    setNameBusy(false);
  }

  async function handleSaveBirthday(date: Date | null) {
    if (!profile) return;
    setNameBusy(true);
    setNameError('');
    setNameMessage('');
    const { error } = await saveProfile({ birthday: date });
    if (error) setNameError(error);
    else {
      setProfile({ ...profile, birthday: date ? toDateInput(date) : null });
      setBirthday(date);
      setNameMessage('Birthday saved.');
    }
    setNameBusy(false);
  }

  async function handlePhoto(source: 'camera' | 'library') {
    if (!profile) return;
    setPhotoError('');

    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPhotoError('Allow camera access to take a profile photo.');
        return;
      }
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5 });

    if (result.canceled || !result.assets[0]) return;

    setPhotoBusy(true);
    try {
      const photo = result.assets[0];
      const extension = photo.uri.split('.').pop() || 'jpg';
      const fileName = `avatars/${profile.id}-${Date.now()}.${extension}`;
      const response = await fetch(photo.uri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('chore-photos')
        .upload(fileName, arrayBuffer, { contentType: photo.mimeType || 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('chore-photos').getPublicUrl(fileName);
      const { error } = await saveProfile({ avatar_url: urlData.publicUrl });
      if (error) { setPhotoError(error); return; }

      setProfile({ ...profile, avatar_url: urlData.publicUrl });
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'That photo could not be uploaded.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleChangeEmail() {
    if (!session) return;
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail || nextEmail === (session.user.email ?? '').toLowerCase()) {
      setEmailError('Enter a different email address first.');
      setEmailMessage('');
      return;
    }
    setEmailBusy(true);
    setEmailError('');
    setEmailMessage('');
    const { error } = await supabase.auth.updateUser({ email: nextEmail });
    if (error) setEmailError(error.message);
    else setEmailMessage(`Check ${nextEmail} for a confirmation link. Your sign-in email changes once you confirm it.`);
    setEmailBusy(false);
  }

  async function handleChangePassword() {
    if (!session?.user.email) return;
    if (!currentPassword) { setPasswordError('Enter your current password.'); setPasswordMessage(''); return; }
    if (newPassword.length < 6) { setPasswordError('Choose a new password of at least 6 characters.'); setPasswordMessage(''); return; }
    if (newPassword !== confirmPassword) { setPasswordError('The new passwords do not match.'); setPasswordMessage(''); return; }

    setPasswordBusy(true);
    setPasswordError('');
    setPasswordMessage('');

    // Checking the old password also refreshes the session, which Supabase
    // requires before it will accept a password change.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword,
    });
    if (verifyError) {
      setPasswordError('That current password is not right.');
      setPasswordBusy(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setPasswordError(error.message);
    else {
      setPasswordMessage('Password changed. Use it the next time you sign in.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setPasswordBusy(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#2A9D8F" />
      </SafeAreaView>
    );
  }

  if (!session || !profile) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.message}>{loadError || 'Sign in to see your profile.'}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/')}>
          <Text style={styles.primaryBtnText}>Back to the app</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const initials = profile.full_name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppHeader fullName={profile.full_name} role={profile.role} section="profile" />

        <View style={styles.card}>
          <View style={styles.photoRow}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{initials}</Text>
              </View>
            )}
            <View style={styles.photoActions}>
              <Text style={styles.name}>{profile.full_name}</Text>
              <Text style={styles.caption}>{profile.role === 'parent' ? 'Parent' : 'Kid'} • Family {profile.family_code.slice(0, 6)}</Text>
              <View style={styles.photoButtons}>
                <TouchableOpacity style={styles.smallBtn} onPress={() => handlePhoto('camera')} disabled={photoBusy}>
                  <Text style={styles.smallBtnText}>Take photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallBtn} onPress={() => handlePhoto('library')} disabled={photoBusy}>
                  <Text style={styles.smallBtnText}>Choose photo</Text>
                </TouchableOpacity>
              </View>
              {photoBusy && <Text style={styles.caption}>Uploading photo…</Text>}
              {!!photoError && <Text style={styles.error}>{photoError}</Text>}
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#7E979E"
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveName} disabled={nameBusy}>
            {nameBusy ? <ActivityIndicator color="#0C2127" /> : <Text style={styles.primaryBtnText}>Save name</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Birthday</Text>
          <Text style={styles.caption}>Birthdays show up on the family calendar every year.</Text>
          <DatePicker
            label="My birthday"
            value={birthday}
            onChange={handleSaveBirthday}
            onClear={birthday ? () => handleSaveBirthday(null) : undefined}
          />
          {!!nameMessage && <Text style={styles.message}>{nameMessage}</Text>}
          {!!nameError && <Text style={styles.error}>{nameError}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign-in email</Text>
          <Text style={styles.caption}>Currently {session.user.email}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor="#7E979E"
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleChangeEmail} disabled={emailBusy}>
            {emailBusy ? <ActivityIndicator color="#0C2127" /> : <Text style={styles.primaryBtnText}>Change email</Text>}
          </TouchableOpacity>
          {!!emailMessage && <Text style={styles.message}>{emailMessage}</Text>}
          {!!emailError && <Text style={styles.error}>{emailError}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Password</Text>
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            placeholder="Current password"
            placeholderTextColor="#7E979E"
          />
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            placeholder="New password (6+ characters)"
            placeholderTextColor="#7E979E"
          />
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Repeat the new password"
            placeholderTextColor="#7E979E"
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleChangePassword} disabled={passwordBusy}>
            {passwordBusy ? <ActivityIndicator color="#0C2127" /> : <Text style={styles.primaryBtnText}>Change password</Text>}
          </TouchableOpacity>
          {!!passwordMessage && <Text style={styles.message}>{passwordMessage}</Text>}
          {!!passwordError && <Text style={styles.error}>{passwordError}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14232A' },
  center: { flex: 1, backgroundColor: '#14232A', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 56 },
  card: { backgroundColor: '#1E3139', borderWidth: 1, borderColor: '#2E4750', borderRadius: 18, padding: 20, marginTop: 16 },
  cardTitle: { color: '#EAF2F2', fontSize: 17, fontWeight: '800', marginBottom: 10 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 18 },
  avatar: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#0F1E25' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2E4750' },
  avatarInitial: { color: '#5FC7BA', fontSize: 40, fontWeight: '800' },
  photoActions: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  name: { color: '#EAF2F2', fontSize: 22, fontWeight: '800' },
  caption: { color: '#A9C0C6', fontSize: 12, lineHeight: 18, marginTop: 4 },
  photoButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  smallBtn: { backgroundColor: '#20343C', borderWidth: 1, borderColor: '#2E4750', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10 },
  smallBtnText: { color: '#EAF2F2', fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: '#172A31', borderWidth: 1, borderColor: '#2E4750', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 10, color: '#EAF2F2', minHeight: 46 },
  primaryBtn: { backgroundColor: '#2A9D8F', borderRadius: 11, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#0C2127', fontSize: 13, fontWeight: '800' },
  message: { color: '#5FC7BA', fontSize: 13, lineHeight: 19, marginTop: 12 },
  error: { color: '#F08A72', fontSize: 13, lineHeight: 19, marginTop: 12 },
});
