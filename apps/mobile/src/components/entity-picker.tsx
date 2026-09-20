import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { PickerOption } from "@/domain/picker-options";
import { TextField } from "./text-field";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export { filterPickerOptions, type PickerOption } from "@/domain/picker-options";

interface EntityPickerProps {
  readonly label: string;
  readonly placeholder: string;
  readonly value: PickerOption | null;
  readonly options: readonly PickerOption[];
  readonly onSelect: (option: PickerOption) => void;
  readonly query: string;
  readonly onQueryChange: (text: string) => void;
  readonly searchLabel: string;
  readonly emptyLabel: string;
  readonly loading?: boolean;
  readonly disabled?: boolean;
}

/**
 * The one way any screen names a domain entity: it opens this over the
 * entity's own endpoint and the caller stores `option.id`, never the label
 * typed to find it.
 */
export function EntityPicker({
  label,
  placeholder,
  value,
  options,
  onSelect,
  query,
  onQueryChange,
  searchLabel,
  emptyLabel,
  loading = false,
  disabled = false,
}: EntityPickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border, opacity: disabled ? 0.55 : 1 }]}
      >
        <Text style={[styles.fieldText, { color: value ? theme.text : theme.textMuted }]} numberOfLines={1}>
          {value ? value.label : placeholder}
        </Text>
      </Pressable>

      <Modal animationType="slide" onRequestClose={() => setOpen(false)} presentationStyle="pageSheet" visible={open}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={styles.modalSearch}>
            <TextField label={searchLabel} onChangeText={onQueryChange} placeholder={searchLabel} value={query} />
          </View>
          <FlatList
            contentContainerStyle={styles.modalList}
            data={options}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              loading ? null : <Text style={[styles.empty, { color: theme.textMuted }]}>{emptyLabel}</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onSelect(item);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.sublabel ? (
                  <Text style={[styles.rowSublabel, { color: theme.textMuted }]} numberOfLines={1}>
                    {item.sublabel}
                  </Text>
                ) : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE.xs },
  label: { fontSize: TYPE.label, fontWeight: "600" },
  field: {
    minHeight: 48,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
  },
  fieldText: { fontSize: TYPE.body },
  modal: { flex: 1, paddingTop: SPACE.xl },
  modalSearch: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.md },
  modalList: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xxl, gap: SPACE.sm },
  row: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.md, gap: 2 },
  rowLabel: { fontSize: TYPE.body, fontWeight: "600" },
  rowSublabel: { fontSize: TYPE.caption },
  empty: { fontSize: TYPE.label, textAlign: "auto", paddingTop: SPACE.xl },
});
