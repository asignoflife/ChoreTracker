import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  addMonths,
  eachDay,
  formatDateLabel,
  formatMonthLabel,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  endOfMonth,
} from '../lib/calendar';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Inline calendar used in place of typing dates, so a date can never be
// mistyped or fall outside a real calendar.
export function DatePicker({
  label,
  value,
  onChange,
  minimum,
  onClear,
}: {
  label: string;
  value: Date | null;
  onChange: (date: Date) => void;
  minimum?: Date;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => startOfMonth(value ?? new Date()));
  const today = startOfDay(new Date());
  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridEnd = endOfWeek(endOfMonth(cursor));
  const days = eachDay(gridStart, gridEnd);
  const earliest = minimum ? startOfDay(minimum) : null;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldRow}>
        <TouchableOpacity style={styles.field} onPress={() => setOpen((current) => !current)}>
          <Text style={value ? styles.fieldValue : styles.fieldPlaceholder}>
            {value ? formatDateLabel(value) : 'Choose a date'}
          </Text>
          <Text style={styles.fieldChevron}>{open ? '▴' : '▾'}</Text>
        </TouchableOpacity>
        {onClear && value && (
          <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {open && (
        <View style={styles.picker}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity style={styles.navBtn} onPress={() => setCursor(addMonths(cursor, -1))}>
              <Text style={styles.navText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.monthText}>{formatMonthLabel(cursor)}</Text>
            <TouchableOpacity style={styles.navBtn} onPress={() => setCursor(addMonths(cursor, 1))}>
              <Text style={styles.navText}>→</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((day, index) => (
              <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {days.map((day) => {
              const outside = day.getMonth() !== cursor.getMonth();
              const disabled = !!earliest && day.getTime() < earliest.getTime();
              const selected = !!value && isSameDay(day, value);
              return (
                <TouchableOpacity
                  key={day.toISOString()}
                  disabled={disabled}
                  style={[styles.cell, selected && styles.cellSelected]}
                  onPress={() => {
                    onChange(startOfDay(day));
                    setOpen(false);
                  }}>
                  <Text
                    style={[
                      styles.cellText,
                      outside && styles.cellTextOutside,
                      isSameDay(day, today) && styles.cellTextToday,
                      selected && styles.cellTextSelected,
                      disabled && styles.cellTextDisabled,
                    ]}>
                    {day.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: '#A9C0C6', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#172A31', borderWidth: 1, borderColor: '#2E4750', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, minHeight: 44 },
  fieldValue: { color: '#EAF2F2', fontSize: 14 },
  fieldPlaceholder: { color: '#7E979E', fontSize: 14 },
  fieldChevron: { color: '#A9C0C6', fontSize: 12 },
  clearBtn: { backgroundColor: '#20343C', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10 },
  clearText: { color: '#A9C0C6', fontSize: 12, fontWeight: '700' },
  picker: { marginTop: 8, backgroundColor: '#172A31', borderWidth: 1, borderColor: '#2E4750', borderRadius: 12, padding: 10 },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#20343C', alignItems: 'center', justifyContent: 'center' },
  navText: { color: '#EAF2F2', fontWeight: '800' },
  monthText: { color: '#EAF2F2', fontSize: 13, fontWeight: '800' },
  weekRow: { flexDirection: 'row' },
  weekday: { flexBasis: '14.2857%', textAlign: 'center', color: '#7E979E', fontSize: 10, fontWeight: '800', paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexBasis: '14.2857%', height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  cellSelected: { backgroundColor: '#2A9D8F' },
  cellText: { color: '#EAF2F2', fontSize: 12, fontWeight: '600' },
  cellTextOutside: { color: '#4F6670' },
  cellTextToday: { color: '#E9C46A', fontWeight: '800' },
  cellTextSelected: { color: '#0C2127', fontWeight: '800' },
  cellTextDisabled: { color: '#3A4F57' },
});
