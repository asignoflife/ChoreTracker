import { Link } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
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
import { supabase } from '../../lib/supabase';
import {
  addDays,
  birthdayOccurrences,
  CalendarEvent,
  dayKey,
  expandEvents,
  FamilyPerson,
  formatTime,
  startOfDay,
} from '../lib/calendar';

type HubProfile = FamilyPerson & {
  family_code: string;
  avatar_url: string | null;
  hub_pin_set_at: string | null;
};

type Chore = {
  id: number;
  title: string;
  points: number;
  base_points: number | null;
  due_at: string | null;
  submitted_at: string | null;
  is_completed: boolean;
  status: 'pending' | 'submitted' | 'approved' | 'denied';
  assigned_to: string;
  assigned_to_id: string | null;
};

type Reward = {
  id: number;
  title: string;
  point_cost: number;
};

type PinResult = {
  ok?: boolean;
  message?: string;
  kid_name?: string;
};

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

// Older chores can predate the status column; the rest of the app treats
// those as pending unless they were already completed.
function choreStatus(chore: Chore) {
  return chore.status || (chore.is_completed ? 'approved' : 'pending');
}

function pointsFor(chore: Chore) {
  if (choreStatus(chore) === 'approved') return chore.points;
  const full = chore.base_points ?? chore.points;
  const late =
    !!chore.due_at &&
    !!chore.submitted_at &&
    new Date(chore.submitted_at).getTime() > new Date(chore.due_at).getTime();
  return late ? Math.floor(full / 2) : full;
}

function dueCopy(chore: Chore, now: Date) {
  if (!chore.due_at) return { text: 'No due time', overdue: false };
  const due = new Date(chore.due_at);
  if (Number.isNaN(due.getTime())) return { text: 'No due time', overdue: false };
  return {
    text: `Due ${formatTime(due)}`,
    overdue: choreStatus(chore) === 'pending' && !chore.is_completed && due.getTime() < now.getTime(),
  };
}

// A wall display for the family tablet. It is read-mostly: today's chores by
// kid, the week ahead, and the reward menu. The tablet stays signed in as a
// parent, and a kid marks their own chore done by typing their hub PIN.
export default function HomeHubScreen() {
  const [profile, setProfile] = useState<HubProfile | null>(null);
  const [people, setPeople] = useState<HubProfile[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [choreError, setChoreError] = useState('');
  const [rewardsError, setRewardsError] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState('');

  const [pinTarget, setPinTarget] = useState<Chore | null>(null);
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (!session) {
        setLoading(false);
        return;
      }

      const { data: me, error: meError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      if (!active) return;
      if (meError || !me) {
        setError('Could not load your family profile. Check the connection and refresh the hub.');
        setLoading(false);
        return;
      }
      const hubProfile = me as HubProfile;
      setProfile(hubProfile);

      const [peopleResult, choresResult, rewardsResult, eventsResult] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('chores').select('*').eq('family_code', hubProfile.family_code),
        supabase.from('rewards').select('*').eq('family_code', hubProfile.family_code).order('point_cost'),
        supabase
          .from('calendar_events')
          .select('*')
          .eq('family_code', hubProfile.family_code)
          .eq('visibility', 'family')
          .eq('status', 'approved')
          .order('starts_at'),
      ]);
      if (!active) return;

      if (peopleResult.data) setPeople(peopleResult.data as HubProfile[]);
      if (peopleResult.error) setError('Family members could not be loaded. Refresh the hub to try again.');
      if (choresResult.error) {
        setChoreError(
          ['PGRST202', 'PGRST205', '42P01'].includes(choresResult.error.code ?? '')
            ? 'Chores could not be loaded. The database update may not be applied yet.'
            : 'Chores could not be loaded.'
        );
      } else {
        setChores((choresResult.data ?? []) as Chore[]);
      }
      if (rewardsResult.error) setRewardsError('Rewards could not be loaded.');
      else setRewards((rewardsResult.data ?? []) as Reward[]);
      if (eventsResult.error) {
        setCalendarError(
          ['PGRST202', 'PGRST205', '42P01'].includes(eventsResult.error.code ?? '')
            ? 'The calendar database update has not been applied yet.'
            : 'The calendar could not be loaded.'
        );
      } else {
        setEvents((eventsResult.data ?? []) as CalendarEvent[]);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Keep the wall display current while it sits open all day.
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(clock);
  }, []);

  // A shared screen should not keep showing the family's day after the
  // parent signs out in another tab.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) return;
      setProfile(null);
      setPeople([]);
      setChores([]);
      setRewards([]);
      setEvents([]);
      setPinTarget(null);
      setPin('');
      setPinError('');
      setNotice('');
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!profile) return;
    const refresh = setInterval(async () => {
      const [choresResult, peopleResult, rewardsResult, eventsResult] = await Promise.all([
        supabase.from('chores').select('*').eq('family_code', profile.family_code),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('rewards').select('*').eq('family_code', profile.family_code).order('point_cost'),
        supabase
          .from('calendar_events')
          .select('*')
          .eq('family_code', profile.family_code)
          .eq('visibility', 'family')
          .eq('status', 'approved')
          .order('starts_at'),
      ]);
      if (choresResult.data) setChores(choresResult.data as Chore[]);
      if (peopleResult.data) setPeople(peopleResult.data as HubProfile[]);
      if (rewardsResult.data) setRewards(rewardsResult.data as Reward[]);
      if (eventsResult.data) setEvents(eventsResult.data as CalendarEvent[]);
      setNow(new Date());
    }, 60 * 1000);
    return () => clearInterval(refresh);
  }, [profile]);

  const today = useMemo(() => startOfDay(now), [now]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(today, index)), [today]);

  const todaysChores = useMemo(() => {
    const start = today.getTime();
    const end = addDays(today, 1).getTime();
    return chores
      .filter((chore) => {
        if (!chore.due_at) return false;
        const due = new Date(chore.due_at).getTime();
        return due >= start && due < end;
      })
      .sort((a, b) => new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime());
  }, [chores, today]);

  const kidGroups = useMemo(
    () =>
      people
        .filter((person) => person.role === 'kid')
        .map((kid) => ({ kid, chores: todaysChores.filter((chore) => chore.assigned_to_id === kid.id) }))
        .filter((group) => group.chores.length > 0),
    [people, todaysChores]
  );

  const remainingToday = todaysChores.filter((chore) => choreStatus(chore) === 'pending' && !chore.is_completed).length;

  const weekOccurrences = useMemo(() => {
    // The hub is a shared screen in the middle of the home. Keep parents-only
    // events off it even when the tablet is signed in as a parent, and do not
    // present suggested or declined events as real plans.
    const sharedEvents = events.filter(
      (event) => event.visibility === 'family' && event.status === 'approved'
    );
    return [
      ...expandEvents(sharedEvents, today, addDays(today, 7)),
      ...birthdayOccurrences(people, today, addDays(today, 7)),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, people, today]);

  function openPin(chore: Chore) {
    setPinTarget(chore);
    setPin('');
    setPinError('');
    setNotice('');
  }

  function closePin() {
    if (pinBusy) return;
    setPinTarget(null);
    setPin('');
    setPinError('');
  }

  async function submitPin() {
    if (!pinTarget || !profile) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setPinError('Enter the 4–6 digit PIN.');
      return;
    }
    setPinBusy(true);
    setPinError('');
    const { data, error: pinFailure } = await supabase.rpc('complete_chore_with_hub_pin', {
      p_chore_id: pinTarget.id,
      p_pin: pin,
    });

    if (pinFailure) {
      setPinBusy(false);
      setPinError(
        ['PGRST202', 'PGRST205', '42883', '42P01'].includes(pinFailure.code ?? '')
          ? 'Home hub PINs need the home hub database update applied first.'
          : pinFailure.message
      );
      return;
    }

    const payload = Array.isArray(data) ? data[0] : data;
    const result = (payload ?? {}) as PinResult;
    if (!result.ok) {
      setPinBusy(false);
      setPinError(result.message || 'That PIN is not right.');
      setPin('');
      return;
    }

    setPinBusy(false);
    setPinTarget(null);
    setPin('');
    setNotice(result.message || 'Chore marked done.');
    setNow(new Date());
    const { data: fresh } = await supabase
      .from('chores')
      .select('*')
      .eq('family_code', profile.family_code);
    if (fresh) setChores(fresh as Chore[]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#2A9D8F" />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.center}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>✓</Text></View>
        <Text style={styles.emptyTitle}>Family home hub</Text>
        <Text style={styles.emptyText}>{error || 'Sign in on this device to turn it into the family hub.'}</Text>
        <Link href="/" asChild>
          <TouchableOpacity style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Go to sign in</Text>
          </TouchableOpacity>
        </Link>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>✓</Text></View>
            <View>
              <Text style={styles.kicker}>FAMILY HOME HUB</Text>
              <Text style={styles.title}>Today at a glance</Text>
            </View>
          </View>
          <View style={styles.clockBlock}>
            <Text style={styles.clock}>{formatTime(now)}</Text>
            <Text style={styles.clockDate}>
              {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </Text>
          </View>
          <Link href="/" asChild>
            <TouchableOpacity style={styles.appLink}>
              <Text style={styles.appLinkText}>Open family app</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}
        {profile.role === 'kid' && (
          <Text style={styles.sessionHint}>
            Signed in as {profile.full_name}. A kid account sees only that kid’s chores — sign in with a parent
            account for the whole family.
          </Text>
        )}
        {!!notice && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        <View style={styles.columns}>
          <View style={styles.mainColumn}>
            <View style={styles.panel}>
              <View style={styles.panelHead}>
                <View>
                  <Text style={styles.panelKicker}>TODAY</Text>
                  <Text style={styles.panelTitle}>Chores</Text>
                </View>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{remainingToday} left</Text>
                </View>
              </View>

              {choreError ? (
                <Text style={styles.panelError}>{choreError}</Text>
              ) : kidGroups.length === 0 ? (
                <Text style={styles.empty}>Nothing on the list today. Enjoy the free time.</Text>
              ) : (
                kidGroups.map(({ kid, chores: kidChores }) => {
                  const done = kidChores.filter((chore) =>
                    ['approved', 'submitted'].includes(choreStatus(chore))
                  ).length;
                  return (
                    <View key={kid.id} style={styles.kidGroup}>
                      <View style={styles.kidHeader}>
                        {kid.avatar_url ? (
                          <Image source={{ uri: kid.avatar_url }} style={styles.kidAvatar} />
                        ) : (
                          <View style={[styles.kidAvatar, styles.kidAvatarFallback]}>
                            <Text style={styles.kidInitial}>{initials(kid.full_name)}</Text>
                          </View>
                        )}
                        <Text style={styles.kidName}>{kid.full_name}</Text>
                        <Text style={styles.kidProgress}>{done}/{kidChores.length} done</Text>
                      </View>
                      {!kid.hub_pin_set_at && (
                        <Text style={styles.pinMissing}>
                          No hub PIN yet. {kid.full_name} can set one on their profile page.
                        </Text>
                      )}

                      {kidChores.map((chore) => {
                        const due = dueCopy(chore, now);
                        const points = pointsFor(chore);
                        const status = choreStatus(chore);
                        return (
                          <View key={chore.id}>
                            <View style={styles.choreRow}>
                              <View style={styles.choreCopy}>
                                <Text style={[styles.choreTitle, status === 'approved' && styles.choreTitleDone]}>
                                  {chore.title}
                                </Text>
                                <Text style={[styles.choreMeta, due.overdue && styles.overdueText]}>
                                  {due.overdue ? 'Overdue · ' : ''}{due.text} · {points} pts
                                </Text>
                              </View>
                              {status === 'pending' && !chore.is_completed ? (
                                <TouchableOpacity
                                  style={styles.doneBtn}
                                  onPress={() => openPin(chore)}
                                  accessibilityLabel={`Mark ${chore.title} done`}>
                                  <Text style={styles.doneBtnText}>Mark done</Text>
                                </TouchableOpacity>
                              ) : status === 'submitted' ? (
                                <View style={styles.waitingPill}>
                                  <Text style={styles.waitingPillText}>Waiting for a parent</Text>
                                </View>
                              ) : status === 'approved' ? (
                                <Text style={styles.approvedText}>Approved ✓</Text>
                              ) : (
                                <Text style={styles.deniedText}>Not approved</Text>
                              )}
                            </View>

                            {pinTarget?.id === chore.id && (
                              <View style={styles.pinBox}>
                                {!kid.hub_pin_set_at ? (
                                  <>
                                    <Text style={styles.pinHelper}>
                                      {kid.full_name} needs to create a home hub PIN on their profile before chores can be
                                      marked done here.
                                    </Text>
                                    <TouchableOpacity style={styles.pinCancel} onPress={closePin}>
                                      <Text style={styles.pinCancelText}>Close</Text>
                                    </TouchableOpacity>
                                  </>
                                ) : (
                                  <>
                                    <Text style={styles.pinLabel}>Enter {kid.full_name}’s PIN</Text>
                                    <View style={styles.pinControls}>
                                      <TextInput
                                        style={styles.pinInput}
                                        value={pin}
                                        onChangeText={(value) => {
                                          setPin(value.replace(/[^0-9]/g, ''));
                                          setPinError('');
                                        }}
                                        keyboardType="number-pad"
                                        secureTextEntry
                                        autoComplete="off"
                                        textContentType="none"
                                        maxLength={6}
                                        autoFocus
                                        placeholder="4–6 digits"
                                        placeholderTextColor="#7E979E"
                                        onSubmitEditing={submitPin}
                                        returnKeyType="done"
                                      />
                                      <TouchableOpacity
                                        style={[styles.pinConfirm, pinBusy && styles.btnDisabled]}
                                        onPress={submitPin}
                                        disabled={pinBusy}>
                                        <Text style={styles.pinConfirmText}>
                                          {pinBusy ? 'Checking…' : 'Done'}
                                        </Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={styles.pinCancel}
                                        onPress={closePin}
                                        disabled={pinBusy}>
                                        <Text style={styles.pinCancelText}>Cancel</Text>
                                      </TouchableOpacity>
                                    </View>
                                    {!!pinError && <Text style={styles.pinError}>{pinError}</Text>}
                                  </>
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </View>
          </View>

          <View style={styles.sideColumn}>
            <View style={styles.panel}>
              <View style={styles.panelHead}>
                <View>
                  <Text style={styles.panelKicker}>NEXT 7 DAYS</Text>
                  <Text style={styles.panelTitle}>Calendar</Text>
                </View>
                <Link href="/calendar" asChild>
                  <TouchableOpacity>
                    <Text style={styles.panelLink}>Full calendar →</Text>
                  </TouchableOpacity>
                </Link>
              </View>

              {calendarError ? (
                <Text style={styles.panelError}>{calendarError}</Text>
              ) : (
                weekDays.map((day) => {
                  const items = weekOccurrences.filter((occurrence) => dayKey(occurrence.start) === dayKey(day));
                  const isToday = dayKey(day) === dayKey(today);
                  return (
                    <View key={dayKey(day)} style={[styles.dayRow, isToday && styles.dayRowToday]}>
                      <View style={styles.dayDate}>
                        <Text style={[styles.dayWeekday, isToday && styles.dayTodayText]}>
                          {day.toLocaleDateString('en-US', { weekday: 'short' })}
                        </Text>
                        <Text style={[styles.dayNumber, isToday && styles.dayTodayText]}>{day.getDate()}</Text>
                      </View>
                      <View style={styles.dayEvents}>
                        {items.length === 0 ? (
                          <Text style={styles.dayEmpty}>—</Text>
                        ) : (
                          items.map((occurrence) => (
                            <View key={occurrence.key} style={styles.eventRow}>
                              <Text style={styles.eventTitle}>{occurrence.event.title}</Text>
                              <Text style={styles.eventMeta}>
                                {occurrence.kind === 'birthday'
                                  ? 'Birthday'
                                  : occurrence.event.all_day
                                    ? 'All day'
                                    : formatTime(occurrence.start)}
                                {occurrence.event.location ? ` · ${occurrence.event.location}` : ''}
                              </Text>
                            </View>
                          ))
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHead}>
                <View>
                  <Text style={styles.panelKicker}>POINTS MENU</Text>
                  <Text style={styles.panelTitle}>Rewards</Text>
                </View>
                <Text style={styles.panelMeta}>{rewards.length}</Text>
              </View>

              {rewardsError ? (
                <Text style={styles.panelError}>{rewardsError}</Text>
              ) : rewards.length === 0 ? (
                <Text style={styles.empty}>No rewards yet. A parent can add them in Family setup.</Text>
              ) : (
                rewards.map((reward) => (
                  <View key={reward.id} style={styles.rewardRow}>
                    <Text style={styles.rewardTitle}>{reward.title}</Text>
                    <View style={styles.rewardCost}>
                      <Text style={styles.rewardCostText}>{reward.point_cost} pts</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14232A' },
  center: { flex: 1, backgroundColor: '#14232A', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  content: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingHorizontal: 22, paddingVertical: 20, paddingBottom: 56 },
  topBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#0F1E25', justifyContent: 'center', alignItems: 'center' },
  brandMarkText: { color: '#E9C46A', fontSize: 23, fontWeight: '800' },
  kicker: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: '#EAF2F2', fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -1, marginTop: 3 },
  clockBlock: { alignItems: 'flex-end' },
  clock: { color: '#E9C46A', fontSize: 32, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  clockDate: { color: '#A9C0C6', fontSize: 12, marginTop: 2 },
  appLink: { borderWidth: 1, borderColor: '#2E4750', backgroundColor: '#1E3139', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  appLinkText: { color: '#EAF2F2', fontSize: 12, fontWeight: '800' },
  errorText: { color: '#F08A72', fontSize: 13, marginTop: 16 },
  sessionHint: { color: '#F4A261', fontSize: 12, lineHeight: 18, marginTop: 12 },
  notice: { backgroundColor: '#1B3A3A', borderWidth: 1, borderColor: '#2A9D8F', borderRadius: 12, padding: 14, marginTop: 16 },
  noticeText: { color: '#5FC7BA', fontSize: 13, fontWeight: '700' },
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16, marginTop: 20 },
  mainColumn: { flexGrow: 2, flexShrink: 1, flexBasis: 580, minWidth: 300 },
  sideColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 330, minWidth: 280, gap: 16 },
  panel: { backgroundColor: '#1A2D34', borderRadius: 18, borderWidth: 1, borderColor: '#2E4750', padding: 18 },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  panelKicker: { color: '#7E979E', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  panelTitle: { color: '#EAF2F2', fontSize: 21, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },
  panelLink: { color: '#5FC7BA', fontSize: 11, fontWeight: '800', paddingTop: 4 },
  panelMeta: { color: '#7E979E', fontSize: 12, fontWeight: '800', paddingTop: 4 },
  panelError: { color: '#F08A72', fontSize: 12, lineHeight: 18 },
  countPill: { backgroundColor: '#1B3A3A', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  countPillText: { color: '#5FC7BA', fontSize: 11, fontWeight: '800' },
  empty: { color: '#7E979E', fontSize: 13, lineHeight: 19, paddingVertical: 8 },
  kidGroup: { borderTopWidth: 1, borderTopColor: '#2E4750', paddingTop: 14, marginTop: 4 },
  kidHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  kidAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0F1E25' },
  kidAvatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2E4750' },
  kidInitial: { color: '#5FC7BA', fontSize: 15, fontWeight: '800' },
  kidName: { flex: 1, color: '#EAF2F2', fontSize: 16, fontWeight: '800' },
  kidProgress: { color: '#7E979E', fontSize: 11, fontWeight: '700' },
  pinMissing: { color: '#F4A261', fontSize: 11, lineHeight: 17, marginBottom: 4 },
  choreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#243B43' },
  choreCopy: { flex: 1, minWidth: 0 },
  choreTitle: { color: '#EAF2F2', fontSize: 15, fontWeight: '700' },
  choreTitleDone: { color: '#A9C0C6' },
  choreMeta: { color: '#7E979E', fontSize: 11, marginTop: 4 },
  overdueText: { color: '#F08A72', fontWeight: '700' },
  doneBtn: { backgroundColor: '#2A9D8F', borderRadius: 11, paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  doneBtnText: { color: '#0C2127', fontSize: 12, fontWeight: '800' },
  waitingPill: { backgroundColor: '#3A2E24', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 },
  waitingPillText: { color: '#F4A261', fontSize: 10, fontWeight: '800' },
  approvedText: { color: '#5FC7BA', fontSize: 12, fontWeight: '800' },
  deniedText: { color: '#F08A72', fontSize: 12, fontWeight: '800' },
  pinBox: { backgroundColor: '#14232A', borderWidth: 1, borderColor: '#2A9D8F', borderRadius: 12, padding: 13, marginBottom: 10 },
  pinLabel: { color: '#EAF2F2', fontSize: 13, fontWeight: '700', marginBottom: 9 },
  pinHelper: { color: '#F4A261', fontSize: 12, lineHeight: 18 },
  pinControls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pinInput: { flexGrow: 1, flexBasis: 150, backgroundColor: '#172A31', borderWidth: 1, borderColor: '#2E4750', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, color: '#EAF2F2', minHeight: 46, letterSpacing: 3 },
  pinConfirm: { backgroundColor: '#2A9D8F', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 13, minHeight: 46, justifyContent: 'center' },
  pinConfirmText: { color: '#0C2127', fontSize: 12, fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },
  pinCancel: { paddingHorizontal: 8, paddingVertical: 12 },
  pinCancelText: { color: '#A9C0C6', fontSize: 12, fontWeight: '700' },
  pinError: { color: '#F08A72', fontSize: 12, marginTop: 9 },
  dayRow: { flexDirection: 'row', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#243B43' },
  dayRowToday: { backgroundColor: '#1B3A3A', borderRadius: 10, paddingHorizontal: 9, borderTopColor: 'transparent' },
  dayDate: { width: 42, alignItems: 'center' },
  dayWeekday: { color: '#7E979E', fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  dayNumber: { color: '#EAF2F2', fontSize: 17, fontWeight: '800', marginTop: 1 },
  dayTodayText: { color: '#E9C46A' },
  dayEvents: { flex: 1, gap: 6 },
  dayEmpty: { color: '#3A4F57', fontSize: 13 },
  eventRow: { gap: 1 },
  eventTitle: { color: '#EAF2F2', fontSize: 12, fontWeight: '700' },
  eventMeta: { color: '#7E979E', fontSize: 10 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#243B43' },
  rewardTitle: { flex: 1, color: '#EAF2F2', fontSize: 13, fontWeight: '700' },
  rewardCost: { backgroundColor: '#3A3324', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  rewardCostText: { color: '#E9C46A', fontSize: 11, fontWeight: '800' },
  emptyTitle: { color: '#EAF2F2', fontSize: 24, fontWeight: '800' },
  emptyText: { color: '#A9C0C6', fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 420 },
  primaryBtn: { backgroundColor: '#2A9D8F', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 14, marginTop: 4 },
  primaryBtnText: { color: '#0C2127', fontSize: 13, fontWeight: '800' },
});
