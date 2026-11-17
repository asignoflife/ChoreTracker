import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/app-header';
import { MonthView, WeekView } from '../components/calendar-grid';
import { DatePicker } from '../components/date-picker';
import { supabase } from '../../lib/supabase';
import {
  addDays,
  addMonths,
  birthdayOccurrences,
  CalendarEvent,
  combineDateAndTime,
  dayKey,
  describeRecurrence,
  EventRecurrence,
  expandEvents,
  formatDayHeading,
  formatEventTime,
  formatMonthLabel,
  FamilyPerson,
  formatWeekLabel,
  Occurrence,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDateInput,
  toTimeInput,
} from '../lib/calendar';

type Profile = {
  id: string;
  full_name: string;
  role: 'parent' | 'kid';
  family_code: string;
};

type ViewMode = 'month' | 'week' | 'day';
type Visibility = 'family' | 'parents';

const RECURRENCES: { key: EventRecurrence; label: string }[] = [
  { key: 'none', label: 'Once' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
];

export default function CalendarScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [people, setPeople] = useState<FamilyPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [composerOpen, setComposerOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [eventDate, setEventDate] = useState(() => startOfDay(new Date()));
  const [timeInput, setTimeInput] = useState(() => toTimeInput(new Date()));
  const [endTimeInput, setEndTimeInput] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [recurrence, setRecurrence] = useState<EventRecurrence>('none');
  const [intervalInput, setIntervalInput] = useState('1');
  const [untilDate, setUntilDate] = useState<Date | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('family');

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (!session) {
        setError('Please sign in to view the family calendar.');
        setLoading(false);
        return;
      }
      const { data: userProfile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      if (!active) return;
      if (profileError || !userProfile) {
        setError('Could not load your family profile.');
        setLoading(false);
        return;
      }
      setProfile(userProfile as Profile);
      const { data: familyPeople } = await supabase
        .from('profiles')
        .select('id, full_name, role, birthday')
        .order('full_name', { ascending: true });
      if (!active) return;
      setPeople((familyPeople ?? []) as FamilyPerson[]);
      const { data, error: eventsError } = await supabase
        .from('calendar_events')
        .select('*')
        .order('starts_at', { ascending: true });
      if (!active) return;
      if (eventsError) {
        setError(
          ['PGRST202', 'PGRST205', '42P01'].includes(eventsError.code ?? '')
            ? 'The family calendar database update has not been applied yet.'
            : 'Could not load the family calendar. Please try again.'
        );
      } else {
        setEvents((data ?? []) as CalendarEvent[]);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function reloadEvents() {
    const { data, error: eventsError } = await supabase
      .from('calendar_events')
      .select('*')
      .order('starts_at', { ascending: true });
    if (eventsError) {
      setError('Could not refresh the calendar.');
      return;
    }
    setEvents((data ?? []) as CalendarEvent[]);
    setError('');
  }

  const range = useMemo(() => {
    if (view === 'month') {
      const start = startOfWeek(startOfMonth(cursor));
      return { start, end: addDays(start, 42) };
    }
    if (view === 'week') {
      const start = startOfWeek(cursor);
      return { start, end: addDays(start, 7) };
    }
    const start = startOfDay(cursor);
    return { start, end: addDays(start, 1) };
  }, [view, cursor]);

  const occurrences = useMemo(
    () =>
      [...expandEvents(events, range.start, range.end), ...birthdayOccurrences(people, range.start, range.end)].sort(
        (a, b) => a.start.getTime() - b.start.getTime()
      ),
    [events, people, range.start, range.end]
  );
  const dayItems = useMemo(
    () => (view === 'day' ? occurrences.filter((occurrence) => dayKey(occurrence.start) === dayKey(cursor)) : []),
    [occurrences, view, cursor]
  );
  const suggestions = events.filter((event) => event.status === 'suggested');
  const isParent = profile?.role === 'parent';

  function shift(direction: number) {
    if (view === 'month') setCursor((current) => addMonths(startOfMonth(current), direction));
    else if (view === 'week') setCursor((current) => addDays(current, direction * 7));
    else setCursor((current) => addDays(current, direction));
  }

  function openDay(day: Date) {
    setCursor(startOfDay(day));
    setView('day');
  }

  function rangeLabel() {
    if (view === 'month') return formatMonthLabel(cursor);
    if (view === 'week') return formatWeekLabel(startOfWeek(cursor));
    return formatDayHeading(cursor);
  }

  function resetForm(day?: Date) {
    setTitle('');
    setLocation('');
    setEventDate(startOfDay(day ?? cursor));
    setTimeInput(toTimeInput(new Date()));
    setEndTimeInput('');
    setAllDay(false);
    setRecurrence('none');
    setIntervalInput('1');
    setUntilDate(null);
    setVisibility('family');
  }

  async function handleSubmit() {
    if (!profile) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Give the event a name first.');
      return;
    }
    if (trimmedTitle.length > 120) {
      setError('Keep the event name under 120 characters.');
      return;
    }
    const start = combineDateAndTime(eventDate, allDay ? '' : timeInput);
    if (!start) {
      setError('Enter the start time as HH:MM.');
      return;
    }
    let end: Date | null = null;
    if (!allDay && endTimeInput.trim()) {
      end = combineDateAndTime(eventDate, endTimeInput);
      if (!end) {
        setError('Enter the end time as HH:MM.');
        return;
      }
      if (end.getTime() <= start.getTime()) {
        setError('The end time needs to be after the start time.');
        return;
      }
    }
    const interval = Number(intervalInput);
    if (recurrence !== 'none' && (!Number.isInteger(interval) || interval < 1 || interval > 12)) {
      setError('Repeat interval must be a whole number from 1 to 12.');
      return;
    }
    if (recurrence !== 'none' && untilDate && untilDate.getTime() < startOfDay(eventDate).getTime()) {
      setError('The repeat end date cannot be before the event.');
      return;
    }

    setBusyKey('submit');
    setError('');
    const { error: insertError } = await supabase.from('calendar_events').insert({
      family_code: profile.family_code,
      title: trimmedTitle,
      starts_at: start.toISOString(),
      ...(location.trim() ? { location: location.trim() } : {}),
      ends_at: end ? end.toISOString() : null,
      all_day: allDay,
      visibility: isParent ? visibility : 'family',
      status: isParent ? 'approved' : 'suggested',
      recurrence,
      recurrence_interval: recurrence === 'none' ? 1 : interval,
      recurrence_until: recurrence !== 'none' && untilDate ? toDateInput(untilDate) : null,
    });
    setBusyKey(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    resetForm();
    setComposerOpen(false);
    await reloadEvents();
  }

  async function updateStatus(event: CalendarEvent, status: 'approved' | 'declined') {
    setBusyKey(`status-${event.id}`);
    const { error: updateError } = await supabase.from('calendar_events').update({ status }).eq('id', event.id);
    setBusyKey(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await reloadEvents();
  }

  async function removeEvent(event: CalendarEvent) {
    setBusyKey(`delete-${event.id}`);
    const { error: deleteError } = await supabase.from('calendar_events').delete().eq('id', event.id);
    setBusyKey(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await reloadEvents();
  }

  function confirmRemove(event: CalendarEvent) {
    const message = `Remove “${event.title}” from the family calendar?`;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(message)) removeEvent(event);
      return;
    }
    Alert.alert('Remove event', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeEvent(event) },
    ]);
  }

  function renderEventCard(occurrence: Occurrence) {
    const { event } = occurrence;
    const isBirthday = occurrence.kind === 'birthday';
    const canRemove =
      !isBirthday && (isParent || (event.status === 'suggested' && event.suggested_by === profile?.id));
    return (
      <View key={occurrence.key} style={styles.eventCard}>
        <View style={styles.eventTopRow}>
          <Text style={styles.eventTime}>{isBirthday ? 'All day' : formatEventTime(occurrence)}</Text>
          <View style={styles.badgeRow}>
            {isBirthday && <Text style={styles.badgeBirthday}>Birthday</Text>}
            {event.visibility === 'parents' && <Text style={styles.badgeParents}>Parents only</Text>}
            {describeRecurrence(event) && <Text style={styles.badgeRepeat}>{describeRecurrence(event)}</Text>}
            {event.status === 'suggested' && <Text style={styles.badgeSuggested}>Suggested</Text>}
            {event.status === 'declined' && <Text style={styles.badgeDeclined}>Declined</Text>}
          </View>
        </View>
        <Text style={styles.eventTitle}>{event.title}</Text>
        {!!event.location && <Text style={styles.eventLocation}>📍 {event.location}</Text>}
        {isBirthday && !!event.notes && <Text style={styles.eventLocation}>{event.notes}</Text>}
        {canRemove && (
          <TouchableOpacity
            style={styles.removeLink}
            disabled={busyKey === `delete-${event.id}`}
            onPress={() => confirmRemove(event)}>
            <Text style={styles.removeLinkText}>
              {busyKey === `delete-${event.id}` ? 'Removing…' : event.status === 'suggested' ? 'Withdraw' : 'Remove'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {profile && <AppHeader fullName={profile.full_name} role={profile.role} section="calendar" />}

        {loading ? (
          <ActivityIndicator color="#2A9D8F" style={styles.loading} />
        ) : !profile ? (
          <Text style={styles.emptyText}>{error || 'Please sign in to view the family calendar.'}</Text>
        ) : (
          <>
            <View style={styles.viewBar}>
              {VIEWS.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.viewTab, view === option.key && styles.viewTabActive]}
                  onPress={() => {
                    if (option.key === 'month') setCursor(startOfMonth(cursor));
                    setView(option.key);
                  }}>
                  <Text style={[styles.viewTabText, view === option.key && styles.viewTabTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.monthBar}>
              <TouchableOpacity style={styles.monthButton} onPress={() => shift(-1)}>
                <Text style={styles.monthButtonText}>←</Text>
              </TouchableOpacity>
              <View style={styles.monthLabelWrap}>
                <Text style={styles.monthLabel}>{rangeLabel()}</Text>
                <TouchableOpacity onPress={() => setCursor(startOfDay(new Date()))}>
                  <Text style={styles.todayLink}>Back to today</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.monthButton} onPress={() => shift(1)}>
                <Text style={styles.monthButtonText}>→</Text>
              </TouchableOpacity>
            </View>

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            {isParent && suggestions.length > 0 && (
              <View style={styles.suggestionBox}>
                <Text style={styles.sectionKicker}>WAITING FOR YOU</Text>
                <Text style={styles.sectionTitle}>
                  {suggestions.length} calendar {suggestions.length === 1 ? 'suggestion' : 'suggestions'}
                </Text>
                {suggestions.map((event) => (
                  <View key={event.id} style={styles.suggestionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionTitle}>{event.title}</Text>
                      <Text style={styles.suggestionWhen}>
                        {formatDayHeading(new Date(event.starts_at))}
                        {event.all_day
                          ? ' · All day'
                          : ` · ${new Date(event.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.approveBtn}
                      disabled={busyKey === `status-${event.id}`}
                      onPress={() => updateStatus(event, 'approved')}>
                      <Text style={styles.approveBtnText}>Add</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineBtn}
                      disabled={busyKey === `status-${event.id}`}
                      onPress={() => updateStatus(event, 'declined')}>
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.agendaHeader}>
              <Text style={styles.sectionTitle}>{view === 'day' ? 'Day plan' : view === 'week' ? 'This week' : 'This month'}</Text>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => {
                  const next = !composerOpen;
                  setComposerOpen(next);
                  if (next) resetForm(cursor);
                }}>
                <Text style={styles.addButtonText}>{composerOpen ? 'Close' : isParent ? '+ Add event' : '+ Suggest event'}</Text>
              </TouchableOpacity>
            </View>

            {composerOpen && (
              <View style={styles.composer}>
                <Text style={styles.label}>Event name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Dentist appointment"
                  placeholderTextColor="#7E979E"
                  value={title}
                  onChangeText={setTitle}
                />

                <Text style={styles.label}>Location (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 12 Oak Street"
                  placeholderTextColor="#7E979E"
                  value={location}
                  onChangeText={setLocation}
                />

                <DatePicker label="Date" value={eventDate} onChange={setEventDate} />

                <View style={styles.fieldRow}>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.label}>All day?</Text>
                    <TouchableOpacity
                      style={[styles.toggle, allDay && styles.toggleOn]}
                      onPress={() => setAllDay((value) => !value)}>
                      <Text style={[styles.toggleText, allDay && styles.toggleTextOn]}>{allDay ? 'Yes' : 'No'}</Text>
                    </TouchableOpacity>
                  </View>
                  {!allDay && (
                    <View style={styles.fieldHalf}>
                      <Text style={styles.label}>Starts (HH:MM)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="09:00"
                        placeholderTextColor="#7E979E"
                        value={timeInput}
                        onChangeText={setTimeInput}
                      />
                    </View>
                  )}
                  {!allDay && (
                    <View style={styles.fieldHalf}>
                      <Text style={styles.label}>Ends (optional)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="10:00"
                        placeholderTextColor="#7E979E"
                        value={endTimeInput}
                        onChangeText={setEndTimeInput}
                      />
                    </View>
                  )}
                </View>

                <Text style={styles.label}>Repeats</Text>
                <View style={styles.chipRow}>
                  {RECURRENCES.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.chip, recurrence === option.key && styles.chipActive]}
                      onPress={() => setRecurrence(option.key)}>
                      <Text style={[styles.chipText, recurrence === option.key && styles.chipTextActive]}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {recurrence !== 'none' && (
                  <>
                    <View style={styles.fieldRow}>
                      <View style={styles.fieldHalf}>
                        <Text style={styles.label}>Every</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="1"
                          placeholderTextColor="#7E979E"
                          keyboardType="numeric"
                          value={intervalInput}
                          onChangeText={setIntervalInput}
                        />
                      </View>
                    </View>
                    <DatePicker
                      label="Repeat until (optional)"
                      value={untilDate}
                      onChange={setUntilDate}
                      minimum={eventDate}
                      onClear={() => setUntilDate(null)}
                    />
                  </>
                )}

                {isParent ? (
                  <>
                    <Text style={styles.label}>Who can see it?</Text>
                    <View style={styles.chipRow}>
                      <TouchableOpacity
                        style={[styles.chip, visibility === 'family' && styles.chipActive]}
                        onPress={() => setVisibility('family')}>
                        <Text style={[styles.chipText, visibility === 'family' && styles.chipTextActive]}>Everyone</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.chip, visibility === 'parents' && styles.chipActive]}
                        onPress={() => setVisibility('parents')}>
                        <Text style={[styles.chipText, visibility === 'parents' && styles.chipTextActive]}>Parents only</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <Text style={styles.helper}>
                    Suggestions are visible to parents first. Once a parent adds it, the whole family sees it.
                  </Text>
                )}

                <TouchableOpacity style={styles.submitBtn} disabled={busyKey === 'submit'} onPress={handleSubmit}>
                  <Text style={styles.submitBtnText}>
                    {busyKey === 'submit' ? 'Saving…' : isParent ? 'Add to calendar' : 'Send suggestion'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {view === 'month' && <MonthView month={cursor} occurrences={occurrences} onPressDay={openDay} />}

            {view === 'week' && <WeekView weekStart={startOfWeek(cursor)} occurrences={occurrences} onPressDay={openDay} />}

            {view === 'day' && (
              <View>
                {dayItems.length === 0 ? (
                  <Text style={styles.emptyText}>Nothing planned for {formatDayHeading(cursor)} yet.</Text>
                ) : (
                  dayItems.map(renderEventCard)
                )}
              </View>
            )}

            <View style={styles.legend}>
              <View style={styles.legendItem}><View style={[styles.legendDot, styles.legendFamily]} /><Text style={styles.legendText}>Family</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, styles.legendParents]} /><Text style={styles.legendText}>Parents only</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, styles.legendSuggested]} /><Text style={styles.legendText}>Suggestion</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, styles.legendBirthday]} /><Text style={styles.legendText}>Birthday</Text></View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14232A' },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 56 },
  loading: { marginTop: 40 },
  viewBar: { flexDirection: 'row', gap: 4, backgroundColor: '#20343C', borderRadius: 12, padding: 4, marginBottom: 12 },
  viewTab: { flexGrow: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  viewTabActive: { backgroundColor: '#2A9D8F' },
  viewTabText: { color: '#A9C0C6', fontSize: 12, fontWeight: '700' },
  viewTabTextActive: { color: '#0C2127' },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1E3139', borderWidth: 1, borderColor: '#2E4750', borderRadius: 16, padding: 12, gap: 10 },
  monthButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#172A31', alignItems: 'center', justifyContent: 'center' },
  monthButtonText: { color: '#EAF2F2', fontSize: 18, fontWeight: '800' },
  monthLabelWrap: { flex: 1, alignItems: 'center' },
  monthLabel: { color: '#EAF2F2', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  todayLink: { color: '#5FC7BA', fontSize: 11, fontWeight: '700', marginTop: 4 },
  errorText: { color: '#F08A72', marginTop: 14, lineHeight: 20 },
  suggestionBox: { backgroundColor: '#22343A', borderWidth: 1, borderColor: '#3A4F57', borderRadius: 16, padding: 16, marginTop: 18 },
  sectionKicker: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  sectionTitle: { color: '#EAF2F2', fontSize: 19, fontWeight: '800' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#172A31', borderRadius: 12, padding: 12, marginTop: 10 },
  suggestionTitle: { color: '#EAF2F2', fontSize: 14, fontWeight: '700' },
  suggestionWhen: { color: '#A9C0C6', fontSize: 12, marginTop: 4 },
  approveBtn: { backgroundColor: '#2A9D8F', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9 },
  approveBtnText: { color: '#0C2127', fontWeight: '800', fontSize: 12 },
  declineBtn: { backgroundColor: '#3B2724', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9 },
  declineBtnText: { color: '#F08A72', fontWeight: '700', fontSize: 12 },
  agendaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 14, gap: 10 },
  addButton: { backgroundColor: '#2A9D8F', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10 },
  addButtonText: { color: '#0C2127', fontWeight: '800', fontSize: 13 },
  composer: { backgroundColor: '#1E3139', borderWidth: 1, borderColor: '#2E4750', borderRadius: 16, padding: 16, marginBottom: 20 },
  label: { color: '#A9C0C6', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#172A31', borderWidth: 1, borderColor: '#2E4750', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, color: '#EAF2F2', minHeight: 44 },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldHalf: { flexGrow: 1, flexBasis: 130 },
  toggle: { backgroundColor: '#172A31', borderWidth: 1, borderColor: '#2E4750', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, minHeight: 44, justifyContent: 'center' },
  toggleOn: { backgroundColor: '#1B3A3A', borderColor: '#2A9D8F' },
  toggleText: { color: '#A9C0C6', fontWeight: '700' },
  toggleTextOn: { color: '#5FC7BA' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#2E4750', backgroundColor: '#172A31' },
  chipActive: { backgroundColor: '#1B3A3A', borderColor: '#2A9D8F' },
  chipText: { color: '#A9C0C6', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#5FC7BA' },
  helper: { color: '#7E979E', fontSize: 12, lineHeight: 19, marginTop: 14 },
  submitBtn: { backgroundColor: '#2A9D8F', padding: 14, borderRadius: 11, alignItems: 'center', marginTop: 18 },
  submitBtnText: { color: '#0C2127', fontWeight: '800', fontSize: 13 },
  eventCard: { backgroundColor: '#1E3139', borderWidth: 1, borderColor: '#2E4750', borderRadius: 14, padding: 14, marginBottom: 10 },
  eventTopRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eventTime: { color: '#A9C0C6', fontSize: 12, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badgeParents: { backgroundColor: '#3A3324', color: '#E9C46A', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  badgeRepeat: { backgroundColor: '#1B3A3A', color: '#5FC7BA', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  badgeSuggested: { backgroundColor: '#3A2C20', color: '#F4A261', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  badgeDeclined: { backgroundColor: '#3B2724', color: '#F08A72', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  badgeBirthday: { backgroundColor: '#33263A', color: '#D9B8F0', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  eventLocation: { color: '#A9C0C6', fontSize: 12, marginTop: 6 },
  eventTitle: { color: '#EAF2F2', fontSize: 16, fontWeight: '800', marginTop: 8 },
  removeLink: { alignSelf: 'flex-start', marginTop: 10 },
  removeLinkText: { color: '#F08A72', fontSize: 12, fontWeight: '700' },
  emptyText: { color: '#A9C0C6', textAlign: 'center', marginTop: 24, padding: 24, backgroundColor: '#1E3139', borderRadius: 14, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendFamily: { backgroundColor: '#5FC7BA' },
  legendParents: { backgroundColor: '#E9C46A' },
  legendSuggested: { backgroundColor: '#F4A261' },
  legendBirthday: { backgroundColor: '#D9B8F0' },
  legendText: { color: '#7E979E', fontSize: 11, fontWeight: '700' },
});
