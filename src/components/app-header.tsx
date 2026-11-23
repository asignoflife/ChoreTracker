import { Link, router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export type AppSection = 'dashboard' | 'hub' | 'chores' | 'prizes' | 'calendar' | 'setup' | 'profile';

const COPY: Record<AppSection, { eyebrow: string; title: string; subtitle: string }> = {
  dashboard: { eyebrow: 'YOUR FAMILY DASHBOARD', title: '', subtitle: 'Here’s what’s happening at home.' },
  hub: { eyebrow: 'FAMILY HOME HUB', title: 'Home hub', subtitle: 'A shared view for the family tablet.' },
  chores: { eyebrow: 'CHORETRACKER / CHORES', title: 'Chore board', subtitle: 'Keep the household moving, one chore at a time.' },
  prizes: { eyebrow: 'CHORETRACKER / PRIZES', title: 'Prizes', subtitle: 'See what everyone is working toward.' },
  calendar: { eyebrow: 'CHORETRACKER / CALENDAR', title: 'Family calendar', subtitle: 'Plans, appointments, and everything in between.' },
  setup: { eyebrow: 'FAMILY SETTINGS', title: 'Family setup', subtitle: 'Manage the people and defaults behind your family.' },
  profile: { eyebrow: 'CHORETRACKER / PROFILE', title: 'Your profile', subtitle: 'Your photo, your birthday, and how you sign in.' },
};

export function AppHeader({
  fullName,
  role,
  section,
}: {
  fullName: string;
  role: 'parent' | 'kid';
  section: AppSection;
}) {
  const items: { key: AppSection; label: string; href: '/' | '/hub' | '/calendar' | '/profile' | `/?section=${string}` }[] = [
    { key: 'dashboard', label: 'Overview', href: '/' },
    { key: 'hub', label: 'Home hub', href: '/hub' },
    { key: 'chores', label: 'Chores', href: '/?section=chores' },
    { key: 'prizes', label: 'Prizes', href: '/?section=prizes' },
    { key: 'calendar', label: 'Calendar', href: '/calendar' },
    ...(role === 'parent' ? [{ key: 'setup' as const, label: 'Family setup', href: '/?section=setup' as const }] : []),
    { key: 'profile', label: 'Profile', href: '/profile' },
  ];
  const copy = COPY[section];

  return (
    <>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>✓</Text></View>
        <Text style={styles.brandName}>chore<Text style={styles.brandAccent}>tracker</Text></Text>
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={async () => {
            await supabase.auth.signOut();
            router.replace('/');
          }}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.mainNav}>
        {items.map((item) => (
          <Link key={item.key} href={item.href} asChild>
            <TouchableOpacity
              accessibilityRole="link"
              style={StyleSheet.flatten([styles.mainNavItem, section === item.key && styles.mainNavItemActive])}>
              <Text style={[styles.mainNavText, section === item.key && styles.mainNavTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          </Link>
        ))}
      </View>
      <View style={styles.topBar}>
        <View style={styles.greeting}>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text style={styles.header}>{section === 'dashboard' ? `Hey, ${fullName}` : copy.title}</Text>
          <Text style={styles.headerSub}>{copy.subtitle}</Text>
        </View>
        <View style={styles.familyPill}>
          <Text style={styles.familyTag}>{role === 'parent' ? 'PARENT' : 'KID'}</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: '#2E4750' },
  brandMark: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#0F1E25', justifyContent: 'center', alignItems: 'center', marginRight: 9 },
  brandMarkText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  brandName: { flex: 1, color: '#EAF2F2', fontSize: 21, fontWeight: '800', letterSpacing: -1 },
  brandAccent: { color: '#E76F51' },
  signOutBtn: { borderWidth: 1, borderColor: '#2E4750', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#1E3139' },
  signOutText: { color: '#EAF2F2', fontWeight: '700', fontSize: 12 },
  mainNav: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 16 },
  mainNavItem: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  mainNavItemActive: { backgroundColor: '#1B3A3A' },
  mainNavText: { color: '#A9C0C6', fontSize: 13, fontWeight: '700' },
  mainNavTextActive: { color: '#EAF2F2' },
  topBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingVertical: 30 },
  greeting: { flexGrow: 1, flexShrink: 1 },
  eyebrow: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  header: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1, color: '#EAF2F2' },
  headerSub: { fontSize: 14, color: '#A9C0C6', marginTop: 5 },
  familyPill: { backgroundColor: '#20343C', borderRadius: 30, paddingHorizontal: 14, paddingVertical: 9 },
  familyTag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: '#A9C0C6' },
});
