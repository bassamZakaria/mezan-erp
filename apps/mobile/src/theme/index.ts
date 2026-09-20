import { useColorScheme } from "react-native";
import { PALETTES, ThemeMode, type Palette } from "./tokens";

export { PALETTES, RADIUS, SPACE, ThemeMode, TYPE } from "./tokens";
export type { Palette } from "./tokens";

export function useTheme(): Palette {
  return PALETTES[useColorScheme() === ThemeMode.Dark ? ThemeMode.Dark : ThemeMode.Light];
}
