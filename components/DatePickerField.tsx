import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react-native';

// Pure-JS date picker (no native module) so it can ship via OTA updates.
// Value is a 'YYYY-MM-DD' string to stay compatible with existing form state.

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parseDateStr = (s: string): Date | null => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};

const formatDisplay = (s: string): string => {
  const d = parseDateStr(s);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface DatePickerFieldProps {
  label: string;
  value: string; // 'YYYY-MM-DD' or ''
  onChange: (value: string) => void;
  placeholder?: string;
  minDate?: string; // 'YYYY-MM-DD'; days before this are disabled
  clearable?: boolean;
}

export const DatePickerField = ({
  label,
  value,
  onChange,
  placeholder = 'Tap to pick a date',
  minDate,
  clearable = true,
}: DatePickerFieldProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = parseDateStr(value);
  const [viewDate, setViewDate] = useState<Date>(selectedDate || new Date());

  const openPicker = () => {
    setViewDate(parseDateStr(value) || new Date());
    setIsOpen(true);
  };

  const selectDay = (day: Date) => {
    onChange(toDateStr(day));
    setIsOpen(false);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDateObj = parseDateStr(minDate || '');

  const quickOptions: { label: string; date: Date }[] = [];
  const addQuickOption = (label: string, date: Date) => {
    if (!minDateObj || date >= minDateObj) {
      quickOptions.push({ label, date });
    }
  };
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  addQuickOption('Today', today);
  addQuickOption('Tomorrow', tomorrow);
  addQuickOption('+1 week', nextWeek);

  const changeMonth = (delta: number) => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  // Build the day grid for the currently viewed month
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (Date | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      new Date(viewDate.getFullYear(), viewDate.getMonth(), i + 1)
    ),
  ];

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldRow}>
        <TouchableOpacity style={styles.field} onPress={openPicker} activeOpacity={0.7}>
          <Calendar color={value ? '#00FFCC' : '#666'} size={18} />
          <Text style={[styles.fieldText, !value && styles.fieldPlaceholder]}>
            {value ? formatDisplay(value) : placeholder}
          </Text>
        </TouchableOpacity>
        {clearable && !!value && (
          <TouchableOpacity style={styles.clearButton} onPress={() => onChange('')}>
            <X color="#888" size={16} />
          </TouchableOpacity>
        )}
      </View>

      <Modal
        visible={isOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsOpen(false)}
        statusBarTranslucent={true}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.pickerCard}>
            <View style={styles.quickRow}>
              {quickOptions.map(opt => (
                <TouchableOpacity
                  key={opt.label}
                  style={styles.quickChip}
                  onPress={() => selectDay(opt.date)}
                >
                  <Text style={styles.quickChipText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.monthHeader}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthArrow}>
                <ChevronLeft color="#FFF" size={20} />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
              </Text>
              <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthArrow}>
                <ChevronRight color="#FFF" size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map((d, i) => (
                <Text key={i} style={styles.weekdayText}>{d}</Text>
              ))}
            </View>

            <View style={styles.dayGrid}>
              {cells.map((day, i) => {
                if (!day) return <View key={`blank_${i}`} style={styles.dayCell} />;
                const dayStr = toDateStr(day);
                const isSelected = dayStr === value;
                const isToday = dayStr === toDateStr(today);
                const isDisabled = !!minDateObj && day < minDateObj;
                return (
                  <TouchableOpacity
                    key={dayStr}
                    style={styles.dayCell}
                    disabled={isDisabled}
                    onPress={() => selectDay(day)}
                  >
                    <View style={[
                      styles.dayInner,
                      isToday && !isSelected && styles.dayToday,
                      isSelected && styles.daySelected,
                    ]}>
                      <Text style={[
                        styles.dayText,
                        isDisabled && styles.dayTextDisabled,
                        isSelected && styles.dayTextSelected,
                      ]}>
                        {day.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  label: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  fieldText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  fieldPlaceholder: {
    color: '#666',
  },
  clearButton: {
    padding: 10,
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  quickChip: {
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderColor: '#00FFCC',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  quickChipText: {
    color: '#00FFCC',
    fontSize: 13,
    fontWeight: '600',
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthArrow: {
    padding: 8,
  },
  monthTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekdayText: {
    width: '14.28%',
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    alignItems: 'center',
    paddingVertical: 3,
  },
  dayInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayToday: {
    borderWidth: 1,
    borderColor: '#00FFCC',
  },
  daySelected: {
    backgroundColor: '#FF00CC',
  },
  dayText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  dayTextDisabled: {
    color: '#444',
  },
  dayTextSelected: {
    fontWeight: '700',
  },
});
