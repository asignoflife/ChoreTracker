import { Link } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

type ChildStats = {
  child_id: string;
  child_name: string;
  completed_chores: number;
  points_earned: number;
  points_adjusted: number | null;
  points_spent: number | null;
  points_available: number | null;
};

type StatsPageData = {
  role: 'parent' | 'kid';
  userId: string;
  children: ChildStats[];
};

export default function FamilyStatsScreen() {
  const [data, setData] = useState<StatsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStats(sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>) {
    try {
      const { data: { session }, error: sessionError } = sessionResult;
      if (sessionError) throw sessionError;
      if (!session) throw new Error('Please sign in to see your family’s stats.');

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile || (profile.role !== 'parent' && profile.role !== 'kid')) {
        throw new Error('A family profile is required to view these stats.');
      }

      const { data: children, error: statsError } = await supabase.rpc('get_family_child_stats');
      if (statsError) {
        if (statsError.code === 'PGRST202' || statsError.code === '42883') {
          throw new Error('Family stats need to be set up in Supabase before they can be displayed.');
        }
        throw statsError;
      }
      setData({ role: profile.role, userId: session.user.id, children: (children ?? []) as ChildStats[] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load family stats. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(loadStats);
  }, []);

  function retry() {
    setLoading(true);
    setError(null);
    setData(null);
    supabase.auth.getSession().then(loadStats);
  }

  const isParent = data?.role === 'parent';
  const ranked = [...(data?.children ?? [])].sort((a, b) =>
    b.points_earned - a.points_earned || a.child_name.localeCompare(b.child_name)
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Link href="/" asChild>
            <TouchableOpacity style={styles.back}><Text style={styles.backText}>← Dashboard</Text></TouchableOpacity>
          </Link>
        </View>
        <Text style={styles.eyebrow}>YOUR FAMILY</Text>
        <Text style={styles.heading}>{isParent ? 'Child stats' : 'Family leaderboard'}</Text>
        <Text style={styles.description}>
          {isParent
            ? 'A rundown of approved chores and points for each child visible to your account.'
            : 'Ranked by points earned from approved chores visible to your account. Spending points won’t change your rank.'}
        </Text>

        {loading ? (
          <ActivityIndicator color="#2A9D8F" style={styles.loading} />
        ) : error ? (
          <View style={styles.messageCard}>
            <Text style={styles.message}>{error}</Text>
            <TouchableOpacity onPress={retry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
          </View>
        ) : ranked.length === 0 ? (
          <Text style={styles.messageCard}>No children in your family yet.</Text>
        ) : isParent ? (
          ranked.map((child) => (
            <View key={child.child_id} style={styles.card}>
              <Text style={styles.name}>{child.child_name}</Text>
              <View style={styles.statsGrid}>
                <Stat label="CHORES COMPLETED" value={child.completed_chores} />
                <Stat label="POINTS EARNED" value={child.points_earned} />
                <Stat label="BONUSES / PENALTIES" value={child.points_adjusted} />
                <Stat label="POINTS SPENT" value={child.points_spent} />
                <Stat label="POINTS AVAILABLE" value={child.points_available} />
              </View>
            </View>
          ))
        ) : (
          ranked.map((child) => {
            const rank = ranked.findIndex((other) => other.points_earned === child.points_earned) + 1;
            return (
              <View key={child.child_id} style={styles.leaderRow}>
                <View style={styles.rank}><Text style={styles.rankText}>{rank}</Text></View>
                <View style={styles.leaderName}>
                  <Text style={styles.name}>{child.child_name}{child.child_id === data?.userId ? ' (you)' : ''}</Text>
                  <Text style={styles.leaderDetails}>{child.completed_chores} approved {child.completed_chores === 1 ? 'chore' : 'chores'}</Text>
                </View>
                <View style={styles.pointBadge}><Text style={styles.pointText}>{child.points_earned} pts</Text></View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14232A' },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 56 },
  topBar: { paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: '#2E4750', marginBottom: 30 },
  back: { alignSelf: 'flex-start', backgroundColor: '#1E3139', borderColor: '#2E4750', borderWidth: 1, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10 },
  backText: { color: '#EAF2F2', fontSize: 12, fontWeight: '700' },
  eyebrow: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  heading: { color: '#EAF2F2', fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  description: { color: '#A9C0C6', fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 24 },
  loading: { marginTop: 30 },
  messageCard: { padding: 20, borderRadius: 16, backgroundColor: '#1E3139', color: '#A9C0C6' },
  message: { color: '#A9C0C6', lineHeight: 20 },
  retry: { alignSelf: 'flex-start', marginTop: 14, backgroundColor: '#2A9D8F', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#0C2127', fontWeight: '700' },
  card: { backgroundColor: '#1E3139', borderRadius: 17, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#2E4750' },
  name: { color: '#EAF2F2', fontWeight: '800', fontSize: 17 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  stat: { flexGrow: 1, flexBasis: 130, padding: 14, borderRadius: 12, backgroundColor: '#172A31' },
  statValue: { color: '#5FC7BA', fontWeight: '800', fontSize: 24 },
  statLabel: { color: '#A9C0C6', fontWeight: '700', fontSize: 10, letterSpacing: 0.4, marginTop: 5 },
  leaderRow: { backgroundColor: '#1E3139', borderRadius: 17, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2E4750', flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#1B3A3A', alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#5FC7BA', fontSize: 16, fontWeight: '800' },
  leaderName: { flex: 1 },
  leaderDetails: { color: '#A9C0C6', fontSize: 12, marginTop: 4 },
  pointBadge: { backgroundColor: '#1B3A3A', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  pointText: { color: '#5FC7BA', fontWeight: '800', fontSize: 12 },
});
