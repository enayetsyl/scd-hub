/**
 * Icon — the shared vector-icon wrapper (ux-audit F7 seed for the F19 emoji
 * sweep, ui-guidelines §6.4): ONE outline set (lucide), 24dp default, stroke
 * 1.75, colored by text tokens — never emoji in controls or navigation.
 *
 * The name→component MAP holds only the icons in use; extend it as screens
 * are swept (F19). Kebab-case names match the lucide catalogue so future
 * additions are mechanical.
 *
 * Accessibility (F8 rule): pass `label` (Bangla) when the icon carries
 * meaning on its own; omit it for decorative icons sitting next to text —
 * they are hidden from the accessibility tree so TalkBack reads the text
 * once, not "icon, text".
 */
import React from "react";
import { View } from "react-native";
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckSquare,
  ChevronRight,
  ClipboardList,
  Clock,
  FlaskConical,
  GraduationCap,
  Hand,
  SquarePen,
  Star,
} from "lucide-react-native";
import { useColors } from "../theme";

const MAP = {
  "alert-triangle": AlertTriangle,
  "book-open": BookOpen,
  calendar: Calendar,
  "check-square": CheckSquare,
  "chevron-right": ChevronRight,
  "clipboard-list": ClipboardList,
  clock: Clock,
  "flask-conical": FlaskConical,
  "graduation-cap": GraduationCap,
  hand: Hand,
  "square-pen": SquarePen,
  star: Star,
} as const;

export type IconName = keyof typeof MAP;

export function Icon({
  name,
  size = 24,
  color,
  strokeWidth = 1.75,
  label,
}: {
  name: IconName;
  size?: number;
  /** Defaults to the primary text token. */
  color?: string;
  strokeWidth?: number;
  /** Bangla accessibility label; omit for decorative icons (hidden from a11y). */
  label?: string;
}): React.ReactElement {
  const colors = useColors();
  const Glyph = MAP[name];
  const decorative = !label;
  return (
    <View
      accessible={!decorative}
      accessibilityLabel={label}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
    >
      <Glyph size={size} color={color ?? colors.textPrimary} strokeWidth={strokeWidth} />
    </View>
  );
}
