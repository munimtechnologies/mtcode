import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  saveMobileVoiceTranscriptionApiKey,
  useMobileVoiceTranscriptionSettings,
} from "../voice-dictation/voiceTranscriptionSettings";
import { SettingsSection } from "./components/SettingsSection";

export function SettingsVoiceDictationRouteScreen() {
  const insets = useSafeAreaInsets();
  const settings = useMobileVoiceTranscriptionSettings();
  const [draftApiKey, setDraftApiKey] = useState("");
  const [draftInitialized, setDraftInitialized] = useState(false);
  const foreground = useThemeColor("--color-foreground");
  const placeholder = useThemeColor("--color-foreground-muted");

  useEffect(() => {
    if (!settings.loaded || draftInitialized) return;
    setDraftApiKey(settings.apiKey);
    setDraftInitialized(true);
  }, [draftInitialized, settings.apiKey, settings.loaded]);

  const save = async () => {
    try {
      await saveMobileVoiceTranscriptionApiKey(draftApiKey);
      Alert.alert(
        draftApiKey.trim() ? "Voice dictation enabled" : "Voice dictation disabled",
        draftApiKey.trim()
          ? "The microphone is now available in the message composer."
          : "The saved API key was removed.",
      );
    } catch (cause) {
      Alert.alert("Could not save API key", cause instanceof Error ? cause.message : "Try again.");
    }
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="OpenAI API key">
          <View className="gap-3 p-4">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={settings.loaded && !settings.saving}
              placeholder="sk-…"
              placeholderTextColor={placeholder}
              secureTextEntry
              value={draftApiKey}
              onChangeText={setDraftApiKey}
              className="rounded-xl bg-subtle px-4 py-3 text-base"
              style={{ color: foreground }}
              accessibilityLabel="OpenAI API key for voice dictation"
            />
            <Pressable
              accessibilityRole="button"
              disabled={!settings.loaded || settings.saving}
              onPress={() => void save()}
              className="h-11 items-center justify-center rounded-full bg-primary disabled:opacity-50"
            >
              {settings.saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text className="font-t3-bold text-primary-foreground">Save</Text>
              )}
            </Pressable>
          </View>
        </SettingsSection>
        <Text className="px-2 text-sm leading-5 text-foreground-muted">
          The key stays in the iPhone secure store. Once it is saved, a microphone appears in the
          composer. Audio is sent directly to OpenAI using gpt-4o-mini-transcribe.
        </Text>
        {settings.error ? (
          <Text className="px-2 text-sm text-danger-foreground">{settings.error}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
