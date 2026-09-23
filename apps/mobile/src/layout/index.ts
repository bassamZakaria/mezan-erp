import { useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FORM_MAX_WIDTH, SizeClass, TILE_BASIS, isSplit, sizeClassFor } from "./breakpoints";

export { FORM_MAX_WIDTH, SIZE_CLASS_MIN_WIDTH, SPLIT_LIST_MAX_WIDTH, SizeClass, TILE_BASIS, isSplit, sizeClassFor } from "./breakpoints";

export function useSizeClass(): SizeClass {
  return sizeClassFor(useWindowDimensions().width);
}

export function useIsSplit(): boolean {
  return isSplit(useSizeClass());
}

/** Caps a form's line length so a field is not a metre wide on an iPad. */
export function useFormWidth(): ViewStyle {
  return { width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center" };
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
