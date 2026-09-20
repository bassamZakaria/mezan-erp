import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextField } from "@/components/text-field";
import { describeApiError } from "@/api/errors";
import { useCustomers } from "@/api/queries";
import { useStrings } from "@/i18n";
import { formatAmountWithCurrency } from "@/money";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export function Customers() {
  const strings = useStrings();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const customers = useCustomers(search);

  return (
    <View style={[styles.flex, { backgroundColor: theme.background, paddingTop: insets.top + SPACE.md }]}>
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
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push({ pathname: "/customer/[id]", params: { id: item.id } });
            }}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
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
        )}
      />
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
