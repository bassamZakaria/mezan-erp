import { CameraView, type BarcodeScanningResult, type BarcodeType } from "expo-camera";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ItemDTO } from "@mezan/contracts";
import { Button, ButtonTone } from "@/components/button";
import { Card } from "@/components/card";
import { CameraAccess, CameraPermissionPrompt, useCameraAccess } from "@/components/camera-permission";
import { TextField } from "@/components/text-field";
import { describeApiError } from "@/api/errors";
import { useItemSearch, useItemStock, useWarehouses } from "@/api/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useStrings } from "@/i18n";
import { formatMoney } from "@/money";
import { STOCK_BARCODE_TYPES } from "@/domain/barcode";
import { useSession } from "@/session/SessionProvider";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export function Stock() {
  const strings = useStrings();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { can } = useSession();
  const canSearch = can("inventory.item.view");
  const canSeeStock = can("inventory.stock.view");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [scannerOpen, setScannerOpen] = useState(false);
  const camera = useCameraAccess();
  const [selectedItem, setSelectedItem] = useState<ItemDTO | null>(null);

  const itemsQuery = useItemSearch(debouncedSearch, canSearch && debouncedSearch.trim().length >= 2);
  const warehousesQuery = useWarehouses();
  const stockQuery = useItemStock(canSeeStock ? (selectedItem?.id ?? null) : null);

  const warehouseNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const warehouse of warehousesQuery.data ?? []) map.set(warehouse.id, warehouse.name);
    return map;
  }, [warehousesQuery.data]);

  function onScanned(result: BarcodeScanningResult) {
    setScannerOpen(false);
    setSearch(result.data);
    setSelectedItem(null);
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.background, paddingTop: insets.top + SPACE.md }]}>
      <Text style={[styles.title, { color: theme.text }]}>{strings.stock.title}</Text>

      {canSearch ? null : (
        <View style={styles.padded}>
          <Card>
            <Text style={[styles.notice, { color: theme.negative }]}>{strings.stock.noPermission}</Text>
          </Card>
        </View>
      )}

      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <TextField label={strings.stock.search} onChangeText={setSearch} placeholder={strings.stock.search} value={search} />
        </View>
        <Button
          disabled={!canSearch}
          label={strings.stock.scan}
          onPress={() => setScannerOpen(true)}
          style={styles.scanButton}
          tone={ButtonTone.Quiet}
        />
      </View>

      {selectedItem === null ? (
        <FlatList
          contentContainerStyle={styles.list}
          data={itemsQuery.data ?? []}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            itemsQuery.isLoading ? null : (
              <Text style={[styles.empty, { color: theme.textMuted }]}>
                {debouncedSearch.trim().length < 2 ? strings.stock.searchHint : strings.stock.noResults}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelectedItem(item)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>
                {item.nameAr}
              </Text>
              <Text style={[styles.rowSublabel, { color: theme.textMuted }]} numberOfLines={1}>
                {item.code}
              </Text>
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.detail}>
          <Card>
            <View style={styles.detailHeader}>
              <Text style={[styles.rowLabel, { color: theme.text }]}>{selectedItem.nameAr}</Text>
              <Button label={strings.common.cancel} onPress={() => setSelectedItem(null)} tone={ButtonTone.Quiet} />
            </View>
            <Text style={[styles.rowSublabel, { color: theme.textMuted }]}>{selectedItem.code}</Text>
          </Card>

          {canSeeStock ? (
            stockQuery.isError ? (
              <Text style={[styles.notice, { color: theme.negative }]}>{describeApiError(stockQuery.error, strings)}</Text>
            ) : (
              (stockQuery.data?.positions ?? []).map((position) => (
                <Card key={position.warehouseId} title={warehouseNames.get(position.warehouseId) ?? position.warehouseId}>
                  <View style={styles.stockRow}>
                    <StockFigure label={strings.stock.onHand} value={position.onHand} />
                    <StockFigure label={strings.stock.reserved} value={position.reserved} />
                    <StockFigure label={strings.stock.available} value={position.available} />
                  </View>
                </Card>
              ))
            )
          ) : (
            <Text style={[styles.notice, { color: theme.negative }]}>{strings.stock.noPermission}</Text>
          )}
        </View>
      )}

      <Modal animationType="slide" onRequestClose={() => setScannerOpen(false)} visible={scannerOpen}>
        <View style={styles.scannerWrap}>
          {camera.access === CameraAccess.Granted ? (
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: STOCK_BARCODE_TYPES as unknown as BarcodeType[] }}
              onBarcodeScanned={onScanned}
              style={styles.camera}
            />
          ) : (
            <CameraPermissionPrompt access={camera.access} reason={strings.stock.cameraPermission} request={camera.request} />
          )}
          <Button label={strings.stock.closeScan} onPress={() => setScannerOpen(false)} tone={ButtonTone.Quiet} />
        </View>
      </Modal>
    </View>
  );
}

function StockFigure({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.figureValue, { color: theme.text }]}>{formatMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { paddingHorizontal: SPACE.lg },
  title: { fontSize: TYPE.display, fontWeight: "800", paddingHorizontal: SPACE.lg, marginBottom: SPACE.sm },
  searchRow: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingBottom: SPACE.md },
  searchField: { flex: 1 },
  scanButton: { minHeight: 48 },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xxl, gap: SPACE.sm },
  row: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.md, gap: 2, minHeight: 56 },
  rowLabel: { fontSize: TYPE.body, fontWeight: "600" },
  rowSublabel: { fontSize: TYPE.caption },
  empty: { fontSize: TYPE.label, textAlign: "auto", paddingTop: SPACE.xl },
  notice: { fontSize: TYPE.label, fontWeight: "600" },
  detail: { paddingHorizontal: SPACE.lg, gap: SPACE.md, paddingBottom: SPACE.xxl },
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stockRow: { flexDirection: "row", gap: SPACE.lg },
  figure: { gap: 2 },
  figureLabel: { fontSize: TYPE.caption },
  figureValue: { fontSize: TYPE.body, fontWeight: "700" },
  scannerWrap: { flex: 1, backgroundColor: "#000000" },
  camera: { flex: 1 },
});
