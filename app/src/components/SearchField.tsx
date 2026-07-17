/**
 * SearchField (ux-audit F4) — debounced text search with a clear button.
 * The input is uncontrolled-ish: local echo state updates per keystroke, the
 * committed value fires through `onSearch` after 300 ms of quiet (or instantly
 * on clear), so the bank query runs once per settled burst, not per key.
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { STR } from "../lib/labels";
import { makeStyles, radius, space, typeScale, useColors } from "../theme";

const DEBOUNCE_MS = 300;

export function SearchField({
  value,
  onSearch,
  placeholder,
}: {
  /** The committed (context) value — resyncs the input when changed externally. */
  value: string;
  onSearch: (term: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(value);

  // External change (e.g. "clear all filters") → resync the echo state.
  useEffect(() => {
    committed.current = value;
    setText(value);
  }, [value]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function commit(term: string): void {
    if (timer.current) clearTimeout(timer.current);
    if (term === committed.current) return;
    committed.current = term;
    onSearch(term);
  }

  function onChange(next: string): void {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  }

  function onClear(): void {
    setText("");
    commit("");
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>🔍</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={onChange}
        onSubmitEditing={() => commit(text)}
        placeholder={placeholder ?? STR.qbSearchPlaceholder}
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder ?? STR.qbSearchPlaceholder}
      />
      {text !== "" ? (
        <Pressable
          onPress={onClear}
          style={styles.clear}
          accessibilityRole="button"
          accessibilityLabel={STR.clear}
          hitSlop={8}
        >
          <Text style={styles.clearGlyph}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3),
    gap: space(2),
  },
  icon: { ...typeScale.body, color: colors.textSecondary },
  input: {
    flex: 1,
    ...typeScale.body,
    color: colors.textPrimary,
    paddingVertical: space(2),
    // RN web renders a UA outline on focus inside custom wrappers; the wrapper
    // border is the affordance here.
    ...({ outlineStyle: "none" } as object),
  },
  clear: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  clearGlyph: { ...typeScale.body, color: colors.textSecondary },
}));
