import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  addDays,
  dayKey,
  eachDay,
  endOfMonth,
  endOfWeek,
  formatTime,
  isSameDay,
  Occurrence,
  startOfMonth,
  startOfWeek,
} from '../lib/calendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function groupOccurrences(occurrences: Occurrence[]) {
  const map = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = dayKey(occurrence.start);
    const list = map.get(key);
    if (list) list.push(occurrence);
    else map.set(key, [occurrence]);
  }
  return map;
}

function chipStyle(occurrence: Occurrence) {
  if (occurrence.kind === 'birthday') return styles.chipBirthday;
  if (occurrence.event.visibility === 'parents') return styles.chipParents;
  if (occurrence.event.status === 'suggested') return styles.chipSuggested;
  return styles.chipFamily;
}

function chipTextStyle(occurrence: Occurrence) {
  if (occurrence.kind === 'birthday') return styles.chipTextBirthday;
  if (occurrence.event.visibility === 'parents') return styles.chipTextParents;
  if (occurrence.event.status === 'suggested') return styles.chipTextSuggested;
  return styles.chipTextFamily;
}

export function MonthView({
  month,
  occurrences,
  onPressDay,
}: {
  month: Date;
  occurrences: Occurrence[];
  onPressDay: (day: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDay(gridStart, gridEnd);
  const byDay = groupOccurrences(occurrences);
  const today = new Date();
  const weeks: Date[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return (
    <View style={styles.monthCard}>
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={styles.weekdayLabel}>{day}</Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].toISOString()} style={styles.weekColumns}>
          {week.map((day) => {
            const items = byDay.get(dayKey(day)) ?? [];
            const outside = day.getMonth() !== month.getMonth();
            const isToday = isSameDay(day, today);
            const visible = items.slice(0, 2);
            return (
              <TouchableOpacity
                key={day.toISOString()}
                style={[styles.dayCell, outside && styles.dayCellOutside, isToday && styles.dayCellToday]}
                onPress={() => onPressDay(day)}>
                <Text style={[styles.dayNumber, outside && styles.dayNumberOutside, isToday && styles.dayNumberToday]}>
                  {day.getDate()}
                </Text>
                {visible.map((occurrence) => (
                  <View key={occurrence.key} style={[styles.chip, chipStyle(occurrence)]}>
                    <Text numberOfLines={1} style={[styles.chipText, chipTextStyle(occurrence)]}>
                      {occurrence.event.title}
                    </Text>
                  </View>
                ))}
                {items.length > visible.length && (
                  <Text style={styles.moreText}>+{items.length - visible.length} more</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function WeekView({
  weekStart,
  occurrences,
  onPressDay,
}: {
  weekStart: Date;
  occurrences: Occurrence[];
  onPressDay: (day: Date) => void;
}) {
  const byDay = groupOccurrences(occurrences);
  const days = eachDay(weekStart, addDays(weekStart, 6));
  const today = new Date();

  return (
    <View style={styles.weekCard}>
      {days.map((day) => {
        const items = byDay.get(dayKey(day)) ?? [];
        const isToday = isSameDay(day, today);
        return (
          <TouchableOpacity key={day.toISOString()} style={styles.weekRow} onPress={() => onPressDay(day)}>
            <View style={[styles.weekDayLabel, isToday && styles.weekDayLabelToday]}>
              <Text style={styles.weekDayName}>{WEEKDAYS[day.getDay()]}</Text>
              <Text style={[styles.weekDayNumber, isToday && styles.weekDayNumberToday]}>{day.getDate()}</Text>
            </View>
            <View style={styles.weekEvents}>
              {items.length === 0 ? (
                <Text style={styles.weekEmpty}>No plans</Text>
              ) : (
                items.map((occurrence) => (
                  <View key={occurrence.key} style={[styles.chip, chipStyle(occurrence)]}>
                    <Text numberOfLines={1} style={[styles.chipText, chipTextStyle(occurrence)]}>
                      {occurrence.event.all_day ? '' : `${formatTime(occurrence.start)} · `}
                      {occurrence.event.title}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  monthCard: { backgroundColor: '#1E3139', borderWidth: 1, borderColor: '#2E4750', borderRadius: 16, padding: 8 },
  weekdayRow: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#2E4750' },
  weekdayLabel: { flexBasis: '14.2857%', textAlign: 'center', color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  weekColumns: { flexDirection: 'row' },
  dayCell: { flexBasis: '14.2857%', minHeight: 84, padding: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#243A42', gap: 3 },
  dayCellOutside: { opacity: 0.45 },
  dayCellToday: { backgroundColor: '#1B3A3A' },
  dayNumber: { color: '#EAF2F2', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  dayNumberOutside: { color: '#7E979E' },
  dayNumberToday: { color: '#E9C46A', fontWeight: '800' },
  chip: { borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 },
  chipFamily: { backgroundColor: '#1B3A3A' },
  chipParents: { backgroundColor: '#3A3324' },
  chipSuggested: { backgroundColor: '#3A2C20' },
  chipBirthday: { backgroundColor: '#33263A' },
  chipText: { fontSize: 9, fontWeight: '700' },
  chipTextFamily: { color: '#5FC7BA' },
  chipTextParents: { color: '#E9C46A' },
  chipTextSuggested: { color: '#F4A261' },
  chipTextBirthday: { color: '#D9B8F0' },
  moreText: { color: '#7E979E', fontSize: 9, fontWeight: '700' },
  weekCard: { backgroundColor: '#1E3139', borderWidth: 1, borderColor: '#2E4750', borderRadius: 16, overflow: 'hidden' },
  weekRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderBottomWidth: 1, borderBottomColor: '#243A42' },
  weekDayLabel: { width: 56, alignItems: 'center', borderRadius: 10, paddingVertical: 4, backgroundColor: '#172A31' },
  weekDayLabelToday: { backgroundColor: '#1B3A3A' },
  weekDayName: { color: '#7E979E', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  weekDayNumber: { color: '#EAF2F2', fontSize: 18, fontWeight: '800' },
  weekDayNumberToday: { color: '#E9C46A' },
  weekEvents: { flex: 1, gap: 4, paddingTop: 2 },
  weekEmpty: { color: '#5F767E', fontSize: 12 },
});
