import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Shown right after a chore is assigned, so a parent sees clearly that it
// went through instead of guessing whether the form submitted.
export default function ChoreAssignedScreen() {
  const { chore, kid, points, due } = useLocalSearchParams<{
    chore?: string;
    kid?: string;
    points?: string;
    due?: string;
  }>();

  const fullPoints = Number(points);
  const hasPoints = !!points && !Number.isNaN(fullPoints);
  const halfPoints = hasPoints ? Math.floor(fullPoints / 2) : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>✓</Text></View>
          <Text style={styles.brandName}>chore<Text style={styles.brandAccent}>tracker</Text></Text>
        </View>

        <View style={styles.card}>
          <View style={styles.checkCircle}><Text style={styles.checkMark}>✓</Text></View>
          <Text style={styles.heading}>Chore assigned</Text>
          <Text style={styles.subheading}>
            {kid ? `${kid} has it on their list now.` : 'It is on the chore list now.'}
          </Text>

          <View style={styles.details}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>CHORE</Text>
              <Text style={styles.rowValue}>{chore || 'Chore'}</Text>
            </View>
            {!!kid && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>ASSIGNED TO</Text>
                <Text style={styles.rowValue}>{kid}</Text>
              </View>
            )}
            {hasPoints && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>POINTS</Text>
                <Text style={styles.rowValue}>{fullPoints}</Text>
              </View>
            )}
            {!!due && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>DUE</Text>
                <Text style={styles.rowValue}>{due}</Text>
              </View>
            )}
          </View>

          {!!due && hasPoints && (
            <Text style={styles.note}>
              Finished by the due time it earns {fullPoints} points. Finished after it, {halfPoints}.
            </Text>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/?section=chores')}>
            <Text style={styles.primaryBtnText}>Back to the chore board</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Assign another chore</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14232A' },
  content: { width: '100%', maxWidth: 700, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 56, flexGrow: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: '#2E4750' },
  brandMark: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#0F1E25', justifyContent: 'center', alignItems: 'center', marginRight: 9 },
  brandMarkText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  brandName: { flex: 1, color: '#EAF2F2', fontSize: 21, fontWeight: '800', letterSpacing: -1 },
  brandAccent: { color: '#E76F51' },
  card: { backgroundColor: '#0F1E25', borderRadius: 22, padding: 26, marginTop: 26, alignItems: 'center' },
  checkCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#2A9D8F', alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#0C2127', fontSize: 36, fontWeight: '800' },
  heading: { color: '#EAF2F2', fontSize: 26, fontWeight: '800', marginTop: 18 },
  subheading: { color: '#A9C0C6', fontSize: 14, marginTop: 7, textAlign: 'center' },
  details: { alignSelf: 'stretch', backgroundColor: '#172A31', borderRadius: 14, padding: 16, marginTop: 22, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  rowLabel: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  rowValue: { flexShrink: 1, color: '#EAF2F2', fontSize: 15, fontWeight: '700', textAlign: 'right' },
  note: { color: '#A9C0C6', fontSize: 12, lineHeight: 18, marginTop: 16, textAlign: 'center' },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: '#2A9D8F', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryBtnText: { color: '#0C2127', fontSize: 15, fontWeight: '800' },
  secondaryBtn: { alignSelf: 'stretch', borderWidth: 1, borderColor: '#2E4750', backgroundColor: '#1E3139', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: '#EAF2F2', fontSize: 13, fontWeight: '700' },
});
