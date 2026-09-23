import { useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACE } from "@/theme";
import { FORM_MAX_WIDTH, SizeClass, TILE_BASIS, isSplit, sizeClassFor } from "./breakpoints";

export { FORM_MAX_WIDTH, SIZE_CLASS_MIN_WIDTH, SPLIT_LIST_MAX_WIDTH, SizeClass, TILE_BASIS, isSplit, sizeClassFor } from "./breakpoints";

export function useSizeClass(): SizeClass {
  return sizeClassFor(useWindowDimensions().width);
}

export function useIsSplit(): boolean {
  return isSplit(useSizeClass());
}

/**
 * A form's readable column, expressed as PADDING rather than a width plus
 * `alignSelf: "center"`: a ScrollView positions its content container itself
 * instead of laying it out with flexbox, so `alignSelf` is ignored there and
 * the form lands against the start edge — the right-hand edge in Arabic.
 * Measured on an iPad before it was padding.
 *
 * Only for a screen that fills the window. Inside a split pane the window is
 * wider than the pane, and this would eat the pane.
 */
export function useFormPadding(): ViewStyle {
  const { width } = useWindowDimensions();
  const gutter = SPACE.lg + useSafeHorizontalPadding();
  return { paddingHorizontal: Math.max(gutter, (width - FORM_MAX_WIDTH) / 2) };
}

export function useTileBasis(): ViewStyle["flexBasis"] {
  return TILE_BASIS[useSizeClass()];
}

/**
 * The notch and the home indicator move to a SIDE in landscape, and which side
 * depends on which way the device was turned — not on the writing direction.
 * Padding both edges by the larger inset is the only value that is right in
 * both rotations and in both locales; `paddingStart` would follow the locale
 * and leave content under the sensor housing half the time.
 */
export function useSafeHorizontalPadding(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.left, insets.right);
}
