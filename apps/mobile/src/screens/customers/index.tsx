import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SplitPlaceholder, SplitView } from "@/components/split-view";
import { TextField } from "@/components/text-field";
import { describeApiError } from "@/api/errors";
import { useCustomers } from "@/api/queries";
import { useStrings } from "@/i18n";
import { useIsSplit, useSafeHorizontalPadding } from "@/layout";
import { formatAmountWithCurrency } from "@/money";
import { Customer } from "@/screens/customer";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export function Customers() {
  const strings = useStrings();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sidePadding = useSafeHorizontalPadding();
  const split = useIsSplit();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const customers = useCustomers(search);

  const open = (id: string) => {
    if (split) setSelectedId(id);
    else router.push({ pathname: "/customer/[id]", params: { id } });
  };

  const list = (
    <View style={styles.flex}>
      <View style={styles.searchWrap}>
        <TextField label={strings.tabs.customers} onChangeText={setSearch} placeholder={strings.common.search} value={search} />
      </View>

      {customers.isError ? (
        <Text style={[styles.notice, { color: theme.negative }]}>{describeApiError(customers.error, strings)}</Text>
      ) : null}

      <FlatList
        contentContainerStyle={styles.list}
        data={customers.data ?? []}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={
          customers.isLoading ? null : <Text style={[styles.notice, { color: theme.textMuted }]}>{strings.common.empty}</Text>
        }
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              void customers.refetch();
            }}
            refreshing={customers.isRefetching}
            tintColor={theme.brand}
          />
        }
        renderItem={({ item }) => {
          const selected = split && item.id === selectedId;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => open(item.id)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: selected ? theme.surfaceMuted : theme.surface,
                  borderColor: selected ? theme.brand : theme.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={styles.rowMain}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                  {item.nameAr}
                </Text>
                <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
                  {item.code}
                  {item.phone === null ? "" : ` · ${item.phone}`}
                </Text>
              </View>
              <Text style={[styles.owed, { color: theme.text }]} numberOfLines={1}>
                {item.owed === null || item.owed === undefined ? "—" : formatAmountWithCurrency(item.owed)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );

  return (
    <View
      style={[
        styles.flex,
        { backgroundColor: theme.background, paddingTop: insets.top + SPACE.md, paddingHorizontal: sidePadding },
      ]}
    >
      {split ? (
        <SplitView
          detail={selectedId === null ? <SplitPlaceholder label={strings.common.selectCustomerToView} /> : <Customer id={selectedId} />}
          list={list}
        />
      ) : (
        list
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchWrap: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.md },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xxl, gap: SPACE.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.md,
    minHeight: 64,
  },
  rowMain: { flex: 1, gap: 2 },
  name: { fontSize: TYPE.body, fontWeight: "600" },
  meta: { fontSize: TYPE.caption },
  owed: { fontSize: TYPE.label, fontWeight: "700" },
  notice: { fontSize: TYPE.label, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
});
